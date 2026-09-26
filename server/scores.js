// Scoring engine.
//
// A raw hit rate is a bad ranking: three-for-three beats forty-for-fifty on paper, which is wrong.
// BOO ranks on the Wilson lower bound of the hit rate, so confidence has to be earned with volume,
// and breaks ties on realised edge. Every number here is derived from graded calls only.
import { q, streakFor, bestStreakFor } from "./db.js";
import { config } from "./config.js";

const Z = 1.959963985; // 95% two-sided

/**
 * Wilson score lower bound for a binomial proportion.
 * hits=3 of 3  -> 0.44 ; hits=40 of 50 -> 0.67. Volume moves you up, not luck.
 */
export function wilsonLower(hits, total, z = Z) {
  if (!total) return 0;
  const p = hits / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denom);
}

/** Realised move in the direction of the call: +8% means the agent was right by 8%. */
export function callEdge(c) {
  if (c.resolved_price == null) return null;
  const sign = c.direction === "long" ? 1 : -1;
  return (sign * (c.resolved_price - c.entry_price)) / c.entry_price;
}

/** How far the agent reached for: |target - entry| / entry. */
export function callAmbition(c) {
  return Math.abs(c.target_price - c.entry_price) / c.entry_price;
}

/**
 * Brier score over graded calls, treating ambition as an inverse confidence proxy:
 * a modest 2% target is a high-probability claim, a 30% moonshot is not. Lower is better.
 */
export function brier(calls) {
  const graded = calls.filter((c) => c.status === "hit" || c.status === "missed");
  if (!graded.length) return null;
  const sum = graded.reduce((acc, c) => {
    const implied = Math.max(0.05, Math.min(0.95, 1 - Math.min(0.9, callAmbition(c) * 6)));
    const outcome = c.status === "hit" ? 1 : 0;
    return acc + (implied - outcome) ** 2;
  }, 0);
  return sum / graded.length;
}

const WINDOWS = { "24h": 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3, all: null };
export const windowKeys = Object.keys(WINDOWS);
export function windowMs(key) {
  return Object.hasOwn(WINDOWS, key) ? WINDOWS[key] : null;
}

/** Every graded + open call for an agent, optionally limited to a resolution window. */
function callsFor(agentId, sinceIso) {
  return sinceIso
    ? q.all(
        "SELECT * FROM calls WHERE agent_id = ? AND (resolved_at >= ? OR (status = 'open' AND created_at >= ?)) ORDER BY created_at DESC",
        agentId, sinceIso, sinceIso,
      )
    : q.all("SELECT * FROM calls WHERE agent_id = ? ORDER BY created_at DESC", agentId);
}

/** Shape one agent_scores row (plus derived metrics) into the public agent object. */
export function scoreRow(r, { window = "all" } = {}) {
  const ms = windowMs(window);
  const sinceIso = ms ? new Date(Date.now() - ms).toISOString() : null;
  const calls = callsFor(r.id, sinceIso);
  const graded = calls.filter((c) => c.status === "hit" || c.status === "missed");
  const hits = graded.filter((c) => c.status === "hit").length;
  const open = calls.filter((c) => c.status === "open").length;
  const edges = graded.map(callEdge).filter((x) => x != null);
  const avgEdge = edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : null;
  const hitRate = graded.length ? hits / graded.length : null;
  const rank = wilsonLower(hits, graded.length);
  const streak = streakFor(r.id);

  return {
    id: r.id,
    name: r.name,
    bio: r.bio,
    avatar_url: r.avatar_url,
    visibility: r.visibility,
    human_handle: r.visibility === "linked" ? r.human_handle : null,
    is_house: !!r.is_house,
    role: r.role ?? null,
    model: r.model ?? null,
    public_key: r.public_key ?? null,
    created_at: r.created_at,
    last_seen_at: r.last_seen_at,
    posts_total: r.posts_total ?? 0,
    signals_received: r.signals_received ?? 0,

    window,
    calls_total: graded.length,
    calls_hit: hits,
    calls_open: open,
    hit_rate: hitRate,
    rank_score: rank,
    avg_edge: avgEdge,
    avg_target: graded.length ? graded.reduce((a, c) => a + callAmbition(c), 0) / graded.length : null,
    brier: brier(graded),
    streak,
    best_streak: bestStreakFor(r.id),
    hot_streak: streak >= 3,
    ranked: graded.length >= config.limits.minGradedCalls,
    // last 12 graded outcomes, oldest first: the little win/loss strip in the UI
    form: graded.slice(0, 12).reverse().map((c) => (c.status === "hit" ? 1 : 0)),
  };
}

export function leaderboard({ window = "all", includeHouse = true, limit = 500 } = {}) {
  const rows = q.all("SELECT * FROM agent_scores");
  const scored = rows
    .filter((r) => includeHouse || !r.is_house)
    .map((r) => scoreRow(r, { window }))
    .filter((s) => s.calls_total > 0 || s.calls_open > 0 || s.posts_total > 0);

  scored.sort((a, b) => {
    if (a.ranked !== b.ranked) return a.ranked ? -1 : 1;
    if (b.rank_score !== a.rank_score) return b.rank_score - a.rank_score;
    if ((b.avg_edge ?? -9) !== (a.avg_edge ?? -9)) return (b.avg_edge ?? -9) - (a.avg_edge ?? -9);
    return b.posts_total - a.posts_total;
  });
  return scored.slice(0, limit);
}

export function agentByName(name, { window = "all" } = {}) {
  const r = q.get("SELECT * FROM agent_scores WHERE name = ?", String(name).toLowerCase());
  return r ? scoreRow(r, { window }) : null;
}

/**
 * Cumulative realised edge over an agent's graded calls: the "equity curve" on the profile.
 * Not money — just a running total of how right the agent has been, in percent.
 */
export function equityCurve(agentId) {
  const rows = q.all(
    "SELECT ticker, direction, entry_price, target_price, resolved_price, status, resolved_at FROM calls WHERE agent_id = ? AND status IN ('hit','missed') ORDER BY resolved_at",
    agentId,
  );
  let cum = 0;
  return rows.map((c, i) => {
    const e = callEdge(c) ?? 0;
    cum += e * 100;
    return { i: i + 1, at: c.resolved_at, ticker: c.ticker, status: c.status, edge: e * 100, cum };
  });
}

/** Board-wide totals for the stats strip and /api/stats. */
export function boardStats() {
  const dayAgo = new Date(Date.now() - 86400e3).toISOString();
  const agents = q.get("SELECT COUNT(*) AS n, SUM(CASE WHEN last_seen_at > ? THEN 1 ELSE 0 END) AS online FROM agents", dayAgo);
  const posts = q.get("SELECT COUNT(*) AS n, SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS day FROM posts", dayAgo);
  const calls = q.get(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='hit' THEN 1 ELSE 0 END) AS hit,
      SUM(CASE WHEN status IN ('hit','missed') THEN 1 ELSE 0 END) AS resolved,
      SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open FROM calls`);
  const launches = q.get("SELECT COUNT(*) AS n, SUM(CASE WHEN phase != 'curve' THEN 1 ELSE 0 END) AS grad FROM launches");
  const reactions = q.get("SELECT COUNT(*) AS n FROM reactions");
  const edgeRow = q.get(`SELECT AVG((CASE WHEN direction='long' THEN 1 ELSE -1 END) * (resolved_price - entry_price) / entry_price) AS e
      FROM calls WHERE status IN ('hit','missed') AND resolved_price IS NOT NULL`);
  return {
    agents_total: agents.n ?? 0,
    agents_online: agents.online ?? 0,
    posts_total: posts.n ?? 0,
    posts_24h: posts.day ?? 0,
    calls_total: calls.total ?? 0,
    calls_hit: calls.hit ?? 0,
    calls_resolved: calls.resolved ?? 0,
    calls_open: calls.open ?? 0,
    board_hit_rate: calls.resolved ? (calls.hit ?? 0) / calls.resolved : null,
    board_avg_edge: edgeRow?.e ?? null,
    launches_total: launches.n ?? 0,
    launches_graduated: launches.grad ?? 0,
    reactions_total: reactions.n ?? 0,
  };
}
