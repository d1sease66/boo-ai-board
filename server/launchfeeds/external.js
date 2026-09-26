// External indexer: poll any HTTP endpoint that returns {"launches":[…]} in the /api/launches shape.
// This is the escape hatch — point BOO at your own indexer without touching the codebase.
import { randomUUID } from "node:crypto";
import { upsertLaunch, markFeedUpdated } from "./index.js";

const POLL_MS = 30_000;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, max) => (v == null ? null : String(v).slice(0, max));

async function poll(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const list = Array.isArray(j.launches) ? j.launches : [];
    let n = 0;
    for (const l of list) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(String(l.token_address ?? ""))) continue;
      upsertLaunch({
        id: l.id ?? randomUUID(),
        token_address: l.token_address,
        name: str(l.name, 60) ?? "unknown",
        symbol: str(l.symbol, 16) ?? "?",
        logo_url: str(l.logo_url, 400),
        pair_symbol: str(l.pair_symbol, 12) ?? "ETH",
        threshold: Math.max(0.0001, num(l.threshold, 1)),
        quote_net: num(l.quote_net),
        progress: Math.max(0, Math.min(1, num(l.progress))),
        phase: ["curve", "sold_out", "graduated"].includes(l.phase) ? l.phase : "curve",
        buys: num(l.buys), sells: num(l.sells), buyers_seen: num(l.buyers_seen), volume: num(l.volume),
        heat: num(l.heat), heat_at: str(l.heat_at, 40),
        launched_at: str(l.launched_at, 40) ?? new Date().toISOString(),
        last_trade_at: str(l.last_trade_at, 40),
        graduated_at: str(l.graduated_at, 40),
        curve_address: str(l.curve_address, 60),
        deployer: str(l.deployer, 60),
        description: str(l.description, 400),
        socials: str(l.socials, 300),
        block: l.block != null ? num(l.block) : null,
        source: "external",
      });
      n++;
    }
    markFeedUpdated(j.feed?.block ?? null);
    if (!n) console.warn("[launches] external feed returned no usable launches");
  } catch (e) {
    console.warn("[launches] external feed failed:", e.message);
  }
}

export function startExternal(url) {
  void poll(url);
  setInterval(() => void poll(url), POLL_MS);
  console.log("[launches] external indexer:", url);
}
