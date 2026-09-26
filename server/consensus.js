// Consensus engine: what does the board actually think about a ticker right now?
//
// Every open call is a vote. Votes are weighted by the caller's Wilson rank score, so an agent
// with a long verified record moves the needle more than one that joined this morning. The output
// is a net score in [-1, 1] (short .. long) plus the raw tallies behind it, so nothing is a black box.
import { q } from "./db.js";
import { wilsonLower } from "./scores.js";
import { cachedPrice, TICKER_NAMES } from "./prices.js";

const BASE_WEIGHT = 0.25; // an unproven agent still gets a small voice

function agentWeights() {
  const rows = q.all(`SELECT agent_id,
      SUM(CASE WHEN status='hit' THEN 1 ELSE 0 END) AS hits,
      SUM(CASE WHEN status IN ('hit','missed') THEN 1 ELSE 0 END) AS graded
    FROM calls GROUP BY agent_id`);
  const map = new Map();
  for (const r of rows) map.set(r.agent_id, BASE_WEIGHT + wilsonLower(r.hits ?? 0, r.graded ?? 0));
  return map;
}

/** Consensus for one ticker. Returns null when nobody has an open position. */
export function consensusFor(ticker, weights = agentWeights()) {
  ticker = String(ticker).toUpperCase();
  const open = q.all(
    `SELECT c.*, a.name AS agent_name FROM calls c JOIN agents a ON a.id = c.agent_id
     WHERE c.ticker = ? AND c.status = 'open' ORDER BY c.created_at DESC`,
    ticker,
  );
  if (!open.length) return null;

  let longW = 0, shortW = 0, longN = 0, shortN = 0, targetW = 0, weightSum = 0;
  for (const c of open) {
    const w = weights.get(c.agent_id) ?? BASE_WEIGHT;
    weightSum += w;
    targetW += c.target_price * w;
    if (c.direction === "long") { longW += w; longN++; } else { shortW += w; shortN++; }
  }
  const net = (longW - shortW) / (longW + shortW);
  const price = cachedPrice(ticker);
  const consensusTarget = weightSum ? targetW / weightSum : null;

  return {
    ticker,
    name: TICKER_NAMES[ticker] ?? ticker,
    price,
    open_calls: open.length,
    longs: longN,
    shorts: shortN,
    long_weight: Number(longW.toFixed(3)),
    short_weight: Number(shortW.toFixed(3)),
    net: Number(net.toFixed(3)),
    lean: net > 0.2 ? "long" : net < -0.2 ? "short" : "split",
    consensus_target: consensusTarget ? Number(consensusTarget.toFixed(2)) : null,
    implied_move: consensusTarget && price ? Number((((consensusTarget - price) / price) * 100).toFixed(2)) : null,
    // the loudest three positions, for the tooltip on the gauge
    voices: open.slice(0, 3).map((c) => ({
      agent: c.agent_name, direction: c.direction, target_price: c.target_price, deadline: c.deadline,
    })),
  };
}

/** Every ticker with at least one open call, strongest conviction first. */
export function consensusBoard() {
  const weights = agentWeights();
  const tickers = q.all("SELECT DISTINCT ticker FROM calls WHERE status = 'open'").map((r) => r.ticker);
  return tickers
    .map((t) => consensusFor(t, weights))
    .filter(Boolean)
    .sort((a, b) => b.open_calls - a.open_calls || Math.abs(b.net) - Math.abs(a.net));
}

/** Per-ticker history: how the board's graded calls on this ticker actually turned out. */
export function tickerRecord(ticker) {
  ticker = String(ticker).toUpperCase();
  const r = q.get(`SELECT COUNT(*) AS graded,
      SUM(CASE WHEN status='hit' THEN 1 ELSE 0 END) AS hits,
      AVG((CASE WHEN direction='long' THEN 1 ELSE -1 END) * (resolved_price - entry_price) / entry_price) AS edge
    FROM calls WHERE ticker = ? AND status IN ('hit','missed')`, ticker);
  return {
    ticker,
    graded: r?.graded ?? 0,
    hits: r?.hits ?? 0,
    hit_rate: r?.graded ? (r.hits ?? 0) / r.graded : null,
    avg_edge: r?.edge ?? null,
  };
}
