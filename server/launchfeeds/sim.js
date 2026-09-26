// Built-in bonding-curve simulator.
//
// Coins deploy, get traded by a shifting crowd of wallets, fill their curve and graduate. Trade sizes
// follow a fat-tailed distribution and buy pressure decays with curve progress, so the shape of a
// simulated launch looks like a real one: a fast start, a grind through the middle, a scramble at the end.
import { createHash } from "node:crypto";
import { q } from "../db.js";
import { bus } from "../bus.js";
import { decayedHeat, upsertLaunch, getLaunch, markFeedUpdated, nextSimBlock, newLaunchId } from "./index.js";

const A = ["moon", "pit", "giga", "based", "turbo", "wagmi", "chad", "degen", "frog", "cat", "doge", "pixel",
  "quantum", "neon", "cyber", "meme", "sigma", "alpha", "hyper", "mega", "ghost", "lazer", "orbit", "void",
  "rocket", "pepe", "wizard", "goblin", "boo", "spectre", "phantom", "haunt", "crypt", "banshee", "wraith"];
const B = ["coin", "inu", "cat", "pepe", "ai", "bot", "punk", "wif", "hat", "fi", "swap", "dao", "x", "labs",
  "chain", "verse", "gpt", "agent", "pump", "moon", "capital", "gang", "club", "fun", "protocol", "core"];
const BLURBS = [
  "community takeover, no team allocation, locked liquidity.",
  "a coin for agents, by agents. the whitepaper is one sentence long.",
  "we have no roadmap and no shame. only vibes and a bonding curve.",
  "fair launch. deployer holds nothing. read the contract.",
  "the ticker is the thesis.",
  "third attempt, same idea, better memes.",
];

const rand = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rand(a.length)];
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const fakeAddress = (seed) => "0x" + createHash("sha256").update(seed).digest("hex").slice(0, 40);

function spawnLaunch(atMs = Date.now()) {
  const a = pick(A), b = pick(B);
  const name = `${a}${b}`;
  const symbol = (a.slice(0, 3) + b.slice(0, 2)).toUpperCase().replace(/[^A-Z]/g, "") || "BOO";
  const id = newLaunchId();
  const l = upsertLaunch({
    id,
    token_address: fakeAddress(id),
    name,
    symbol,
    logo_url: `/logo/${symbol.toLowerCase()}-${id.slice(0, 8)}.svg`,
    pair_symbol: "ETH",
    threshold: Math.round((3.2 + Math.random() * 3.6) * 100) / 100,
    launched_at: iso(atMs),
    last_trade_at: iso(atMs),
    deployer: fakeAddress("deployer:" + id),
    curve_address: fakeAddress("curve:" + id),
    description: Math.random() < 0.55 ? pick(BLURBS) : null,
    block: nextSimBlock(),
    source: "sim",
  });
  bus.emit("launch:new", l);
  return l;
}

/** One trade against a curve. Returns the updated row. */
function tradeOn(row, atMs = Date.now()) {
  const heatNow = decayedHeat(row.heat, row.heat_at, atMs);
  const progress0 = Math.min(1, row.quote_net / row.threshold);
  // buy pressure starts high and fades as the curve fills; late curves see more profit taking
  const buyBias = 0.74 - progress0 * 0.22;
  const isBuy = Math.random() < buyBias;
  // fat tail: most trades are dust, a few are whales
  const size = Math.round((0.015 + Math.random() ** 3 * 0.9) * 1000) / 1000;

  let quote = Math.max(0, row.quote_net + (isBuy ? size : -size * 0.8));
  let phase = row.phase;
  let graduated_at = row.graduated_at;
  let progress = Math.min(1, quote / row.threshold);
  if (progress >= 1 && phase === "curve") {
    phase = "graduated";
    graduated_at = iso(atMs);
    quote = row.threshold;
    progress = 1;
  }
  const updated = upsertLaunch({
    ...row,
    quote_net: quote,
    progress,
    phase,
    buys: row.buys + (isBuy ? 1 : 0),
    sells: row.sells + (isBuy ? 0 : 1),
    buyers_seen: row.buyers_seen + (isBuy && Math.random() < 0.66 ? 1 : 0),
    volume: row.volume + size,
    heat: heatNow + size / row.threshold,
    heat_at: iso(atMs),
    last_trade_at: iso(atMs),
    graduated_at,
    block: nextSimBlock(),
    source: "sim",
  });
  if (phase === "graduated" && row.phase === "curve") bus.emit("launch:graduated", updated);
  return updated;
}

function tick() {
  const active = q.all("SELECT * FROM launches WHERE phase = 'curve' AND source = 'sim' ORDER BY launched_at DESC LIMIT 40");
  if (active.length < 7 || Math.random() < 0.07) spawnLaunch();

  const t = Date.now();
  // weight trades towards hot and very young curves
  const weighted = active.map((r) => ({
    r,
    w: 0.18 + decayedHeat(r.heat, r.heat_at, t) + (1 - Math.min(1, (t - Date.parse(r.launched_at)) / 3600e3)) * 0.8,
  }));
  const total = weighted.reduce((s, x) => s + x.w, 0);
  const trades = 1 + rand(3);
  for (let i = 0; i < trades && total > 0; i++) {
    let x = Math.random() * total;
    for (const w of weighted) {
      x -= w.w;
      if (x <= 0) {
        const fresh = q.get("SELECT * FROM launches WHERE id = ?", w.r.id);
        if (fresh && fresh.phase === "curve") tradeOn(fresh, t);
        break;
      }
    }
  }
  markFeedUpdated(nextSimBlock());
}

/** Fill a brand-new database with coins at believable stages so the board is never empty. */
function warmStart() {
  if (q.get("SELECT 1 FROM launches LIMIT 1")) return;
  for (let i = 0; i < 11; i++) {
    const agoMs = Date.now() - rand(5 * 3600e3);
    const l = spawnLaunch(agoMs);
    let row = q.get("SELECT * FROM launches WHERE id = ?", l.id);
    const trades = 4 + rand(70);
    for (let k = 0; k < trades && row.phase === "curve"; k++) {
      // spread the synthetic trades across the coin's lifetime
      const at = agoMs + Math.floor(((k + 1) / trades) * (Date.now() - agoMs));
      row = q.get("SELECT * FROM launches WHERE id = ?", tradeOn(row, at).id);
    }
    q.run("UPDATE launches SET launched_at = ? WHERE id = ?", iso(agoMs), l.id);
  }
}

export function startSim() {
  warmStart();
  tick();
  setInterval(tick, 3500 + rand(2500));
  console.log("[launches] simulator running");
}

export { spawnLaunch, tradeOn };
