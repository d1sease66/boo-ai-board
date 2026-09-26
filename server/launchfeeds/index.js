// Launchpad feed: the bonding-curve coins agents talk about in #launches.
//
// Three interchangeable sources, chosen with LAUNCH_FEED:
//   sim   – built-in curve simulator (default; the product works offline and out of the box)
//   evm   – live indexer for a pump-style factory on any EVM chain (./evm.js)
//   <URL> – poll an external indexer returning {"launches":[…]} in the /api/launches shape
import { randomUUID } from "node:crypto";
import { q, setMeta, getMeta } from "../db.js";
import { config } from "../config.js";
import { bus } from "../bus.js";

const HEAT_HALF_LIFE_S = 900; // 15 minutes

export function decayedHeat(heat, heatAt, at = Date.now()) {
  if (!heat || !heatAt) return 0;
  return heat * Math.pow(0.5, Math.max(0, at - Date.parse(heatAt)) / 1000 / HEAT_HALF_LIFE_S);
}

export function rowToLaunch(r) {
  return {
    id: r.id,
    token_address: r.token_address,
    name: r.name,
    symbol: r.symbol,
    logo_url: r.logo_url,
    pair_symbol: r.pair_symbol,
    threshold: r.threshold,
    quote_net: r.quote_net,
    progress: r.progress,
    phase: r.phase,
    buys: r.buys,
    sells: r.sells,
    buyers_seen: r.buyers_seen,
    volume: r.volume,
    heat: r.heat,
    heat_at: r.heat_at,
    launched_at: r.launched_at,
    last_trade_at: r.last_trade_at,
    graduated_at: r.graduated_at,
    curve_address: r.curve_address ?? null,
    deployer: r.deployer ?? null,
    description: r.description ?? null,
    socials: r.socials ?? null,
    block: r.block ?? null,
    pair_decimals: r.pair_decimals ?? 18,
    source: r.source ?? "sim",
    meta_pending: !!r.meta_pending,
    discovered: !!r.discovered,
  };
}

export function getLaunch(idOrAddress) {
  const key = String(idOrAddress ?? "");
  const r = q.get("SELECT * FROM launches WHERE id = ? OR token_address = ?", key, key.toLowerCase());
  return r ? rowToLaunch(r) : null;
}

export function listLaunches(sort = "hot", limit = 20) {
  limit = Math.max(1, Math.min(100, Number(limit) || 20));
  let rows;
  if (sort === "new") {
    rows = q.all("SELECT * FROM launches WHERE meta_pending = 0 AND discovered = 0 ORDER BY launched_at DESC LIMIT ?", limit);
  } else if (sort === "graduated") {
    rows = q.all(
      "SELECT * FROM launches WHERE meta_pending = 0 AND phase != 'curve' ORDER BY COALESCE(graduated_at, last_trade_at) DESC LIMIT ?",
      limit,
    );
  } else if (sort === "all") {
    rows = q.all("SELECT * FROM launches WHERE meta_pending = 0 ORDER BY COALESCE(last_trade_at, launched_at) DESC LIMIT ?", limit);
  } else {
    const t = Date.now();
    rows = q
      .all(
        "SELECT * FROM launches WHERE meta_pending = 0 AND phase = 'curve' AND last_trade_at > ? ORDER BY heat DESC LIMIT 300",
        new Date(t - 6 * 3600e3).toISOString(),
      )
      .map((r) => ({ r, h: decayedHeat(r.heat, r.heat_at, t) }))
      .sort((x, y) => y.h - x.h)
      .slice(0, limit)
      .map((x) => x.r);
  }
  return rows.map(rowToLaunch);
}

export function launchpadStats() {
  const dayAgo = new Date(Date.now() - 86400e3).toISOString();
  const r = q.get(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN phase = 'curve' THEN 1 ELSE 0 END) AS on_curve,
      SUM(CASE WHEN phase != 'curve' THEN 1 ELSE 0 END) AS graduated,
      SUM(CASE WHEN launched_at > ? THEN 1 ELSE 0 END) AS new_24h,
      SUM(volume) AS volume, SUM(buys) AS buys, SUM(sells) AS sells
    FROM launches WHERE meta_pending = 0`, dayAgo);
  return {
    total: r?.total ?? 0,
    on_curve: r?.on_curve ?? 0,
    graduated: r?.graduated ?? 0,
    new_24h: r?.new_24h ?? 0,
    volume: r?.volume ?? 0,
    buys: r?.buys ?? 0,
    sells: r?.sells ?? 0,
    graduation_rate: r?.total ? (r.graduated ?? 0) / r.total : null,
  };
}

export function feedStatus() {
  const updated = getMeta("feed_updated_at");
  const block = Number(getMeta("feed_block", "0"));
  const fresh = !!updated && Date.now() - Date.parse(updated) < 3 * 60_000;
  const source = config.launchFeed === "sim" ? "sim" : config.launchFeed === "evm" ? "evm" : "external";
  return {
    source,
    chain: config.chainName,
    launchpad: config.launchpadName,
    launchpad_url: config.launchpadUrl || null,
    explorer_url: config.explorerUrl || null,
    updated_at: updated,
    block,
    state: fresh ? "live" : "unavailable",
  };
}

const UPSERT_KEYS = [
  "id", "token_address", "name", "symbol", "logo_url", "pair_symbol", "threshold", "quote_net", "progress",
  "phase", "buys", "sells", "buyers_seen", "volume", "heat", "heat_at", "launched_at", "last_trade_at",
  "graduated_at", "curve_address", "deployer", "description", "socials", "block", "source", "meta_pending", "discovered",
];

/** Insert or update one launch and broadcast it. Token address is the natural key. */
export function upsertLaunch(input) {
  const defaults = {
    source: config.launchFeed === "sim" ? "sim" : config.launchFeed === "evm" ? "evm" : "external",
    meta_pending: 0, discovered: 0, pair_symbol: "ETH", quote_net: 0, progress: 0, phase: "curve",
    buys: 0, sells: 0, buyers_seen: 0, volume: 0, heat: 0,
  };
  const l = {};
  for (const k of UPSERT_KEYS) l[k] = input[k] ?? defaults[k] ?? null;
  l.token_address = String(l.token_address).toLowerCase();
  l.meta_pending = l.meta_pending ? 1 : 0;
  l.discovered = l.discovered ? 1 : 0;

  q.run(
    `INSERT INTO launches (id, token_address, name, symbol, logo_url, pair_symbol, threshold, quote_net, progress, phase,
        buys, sells, buyers_seen, volume, heat, heat_at, launched_at, last_trade_at, graduated_at,
        curve_address, deployer, description, socials, block, source, meta_pending, discovered)
     VALUES (@id,@token_address,@name,@symbol,@logo_url,@pair_symbol,@threshold,@quote_net,@progress,@phase,
        @buys,@sells,@buyers_seen,@volume,@heat,@heat_at,@launched_at,@last_trade_at,@graduated_at,
        @curve_address,@deployer,@description,@socials,@block,@source,@meta_pending,@discovered)
     ON CONFLICT(token_address) DO UPDATE SET
       name=excluded.name, symbol=excluded.symbol, logo_url=COALESCE(excluded.logo_url, launches.logo_url),
       quote_net=excluded.quote_net, progress=excluded.progress, phase=excluded.phase,
       buys=excluded.buys, sells=excluded.sells, buyers_seen=excluded.buyers_seen, volume=excluded.volume,
       heat=excluded.heat, heat_at=excluded.heat_at, last_trade_at=excluded.last_trade_at,
       graduated_at=excluded.graduated_at, curve_address=COALESCE(excluded.curve_address, launches.curve_address),
       deployer=COALESCE(excluded.deployer, launches.deployer),
       description=COALESCE(excluded.description, launches.description),
       socials=COALESCE(excluded.socials, launches.socials), block=excluded.block,
       source=excluded.source, meta_pending=excluded.meta_pending`,
    l,
  );
  const fresh = getLaunch(l.token_address);
  bus.emit("launch", fresh);
  return fresh;
}

export function markFeedUpdated(block) {
  setMeta("feed_updated_at", new Date().toISOString());
  if (block != null) setMeta("feed_block", block);
}

export function nextSimBlock() {
  const n = Number(getMeta("feed_block", "4810000")) + 1 + Math.floor(Math.random() * 3);
  return n;
}

export function newLaunchId() {
  return randomUUID();
}

/** Start whichever feed the configuration asks for. */
export async function startLaunchFeed() {
  if (config.launchFeed !== "sim") {
    // Simulated coins (and the house posts about them) must never mix with real launches.
    const fake = q.all("SELECT id FROM launches WHERE source = 'sim'").map((r) => r.id);
    if (fake.length) {
      for (const id of fake) q.run("DELETE FROM posts WHERE launch_id = ?", id);
      q.run("DELETE FROM launches WHERE source = 'sim'");
      console.log(`[launches] removed ${fake.length} simulated launches and their posts`);
    }
  }
  if (config.launchFeed === "sim") {
    const { startSim } = await import("./sim.js");
    return startSim();
  }
  if (config.launchFeed === "evm") {
    const { startEvm } = await import("./evm.js");
    return startEvm();
  }
  const { startExternal } = await import("./external.js");
  return startExternal(config.launchFeed);
}
