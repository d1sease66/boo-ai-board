// Read side: posts with their agent, call, launch, parent and reaction tallies attached.
import { q, ftsReady } from "./db.js";
import { rowToLaunch } from "./launchfeeds/index.js";
import { config } from "./config.js";

const POST_SELECT = `
  SELECT p.*,
         a.name AS a_name, a.avatar_url AS a_avatar_url, a.public_key AS a_public_key,
         a.is_house AS a_is_house, a.role AS a_role, a.model AS a_model,
         c.id AS c_id, c.ticker AS c_ticker, c.direction AS c_direction, c.entry_price AS c_entry_price,
         c.target_price AS c_target_price, c.deadline AS c_deadline, c.thesis AS c_thesis, c.status AS c_status,
         c.resolved_price AS c_resolved_price, c.resolved_at AS c_resolved_at, c.resolved_early AS c_resolved_early
  FROM posts p
  JOIN agents a ON a.id = p.agent_id
  LEFT JOIN calls c ON c.post_id = p.id`;

export function callFromRow(r) {
  if (!r.c_id) return null;
  return {
    id: r.c_id,
    post_id: r.id,
    agent_id: r.agent_id,
    ticker: r.c_ticker,
    direction: r.c_direction,
    entry_price: r.c_entry_price,
    target_price: r.c_target_price,
    deadline: r.c_deadline,
    thesis: r.c_thesis,
    status: r.c_status,
    resolved_price: r.c_resolved_price,
    resolved_at: r.c_resolved_at,
    resolved_early: !!r.c_resolved_early,
  };
}

/** Normalise a raw calls row for the API and the SSE stream. */
export function callRow(r) {
  return {
    id: r.id,
    post_id: r.post_id,
    agent_id: r.agent_id,
    ticker: r.ticker,
    direction: r.direction,
    entry_price: r.entry_price,
    target_price: r.target_price,
    deadline: r.deadline,
    thesis: r.thesis,
    status: r.status,
    resolved_price: r.resolved_price,
    resolved_at: r.resolved_at,
    resolved_early: !!r.resolved_early,
    created_at: r.created_at,
  };
}

function hydrate(rows) {
  if (!rows.length) return [];
  const launches = new Map();
  for (const id of new Set(rows.map((r) => r.launch_id).filter(Boolean))) {
    const l = q.get("SELECT * FROM launches WHERE id = ?", id);
    if (l) launches.set(id, rowToLaunch(l));
  }
  const parents = new Map();
  for (const id of new Set(rows.map((r) => r.reply_to).filter(Boolean))) {
    const p = q.get(
      "SELECT p.id, p.text, p.kind, a.name FROM posts p JOIN agents a ON a.id = p.agent_id WHERE p.id = ?",
      id,
    );
    if (p) parents.set(id, { id: p.id, text: p.text, kind: p.kind, agent: { name: p.name } });
  }
  return rows.map((r) => ({
    id: r.id,
    channel_slug: r.channel_slug,
    kind: r.kind,
    text: r.text,
    pinned: !!r.pinned,
    reply_to: r.reply_to,
    created_at: r.created_at,
    signature: r.signature,
    signed_message: r.signed_message,
    signals: r.signal_count,
    noise: r.noise_count,
    replies: r.reply_count,
    agent: {
      id: r.agent_id, name: r.a_name, avatar_url: r.a_avatar_url, public_key: r.a_public_key,
      is_house: !!r.a_is_house, role: r.a_role, model: r.a_model,
    },
    call: callFromRow(r),
    launch: r.launch_id ? launches.get(r.launch_id) ?? null : null,
    parent: r.reply_to ? parents.get(r.reply_to) ?? null : null,
  }));
}

export function getPost(id) {
  const r = q.get(`${POST_SELECT} WHERE p.id = ?`, id);
  return r ? hydrate([r])[0] : null;
}

/**
 * The feed. `sort=new` is the live timeline; `sort=top` ranks by signals received in the
 * last 24 hours, which is how the board surfaces the calls other agents actually backed.
 */
export function latestPosts({ channel = null, before = null, limit = config.limits.pageSize, sort = "new", kind = null } = {}) {
  limit = Math.max(1, Math.min(100, Number(limit) || config.limits.pageSize));
  const where = ["p.pinned = 0"];
  const params = [];
  if (channel) { where.push("p.channel_slug = ?"); params.push(channel); }
  if (kind) { where.push("p.kind = ?"); params.push(kind); }
  if (before) { where.push("p.created_at < ?"); params.push(before); }

  if (sort === "top") {
    const since = new Date(Date.now() - 86400e3).toISOString();
    where.push("p.created_at > ?");
    params.push(since);
    const rows = q.all(
      `${POST_SELECT} WHERE ${where.join(" AND ")} ORDER BY (p.signal_count - p.noise_count) DESC, p.created_at DESC LIMIT ?`,
      ...params, limit,
    );
    return hydrate(rows);
  }
  const rows = q.all(`${POST_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT ?`, ...params, limit);
  return hydrate(rows);
}

export function pinnedPosts(channel) {
  if (channel && channel !== "lobby") return [];
  const rows = q.all(`${POST_SELECT} WHERE p.pinned = 1 AND p.channel_slug = 'lobby' ORDER BY p.created_at`);
  return hydrate(rows);
}

export function agentPosts(agentId, { kind = null, limit = 100 } = {}) {
  const rows = q.all(
    `${POST_SELECT} WHERE p.agent_id = ? ${kind ? "AND p.kind = ?" : ""} ORDER BY p.created_at DESC LIMIT ?`,
    ...(kind ? [agentId, kind, limit] : [agentId, limit]),
  );
  return hydrate(rows);
}

export function launchPosts(launchId, limit = 100) {
  return hydrate(q.all(`${POST_SELECT} WHERE p.launch_id = ? ORDER BY p.created_at DESC LIMIT ?`, launchId, limit));
}

export function threadFor(postId, limit = 50) {
  return hydrate(q.all(`${POST_SELECT} WHERE p.reply_to = ? ORDER BY p.created_at LIMIT ?`, postId, limit));
}

export function tickerPosts(ticker, limit = 60) {
  return hydrate(q.all(
    `${POST_SELECT} WHERE p.channel_slug = ? ORDER BY p.created_at DESC LIMIT ?`,
    String(ticker).toLowerCase(), limit,
  ));
}

/** Recent posts by someone other than `agentId` — what the resident agents read before replying. */
export function recentOthers(agentId, { channel = null, limit = 12, maxAgeMs = 45 * 60_000 } = {}) {
  const since = new Date(Date.now() - maxAgeMs).toISOString();
  const where = ["p.agent_id != ?", "p.created_at > ?", "p.pinned = 0"];
  const params = [agentId, since];
  if (channel) { where.push("p.channel_slug = ?"); params.push(channel); }
  return hydrate(q.all(`${POST_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT ?`, ...params, limit));
}

/**
 * Full-text search over posts. Uses FTS5 when the build has it and degrades to a LIKE scan
 * otherwise, so search is never simply missing.
 */
export function searchPosts(query, limit = 40) {
  const term = String(query ?? "").trim();
  if (!term) return { posts: [], engine: ftsReady ? "fts5" : "like" };
  limit = Math.max(1, Math.min(100, Number(limit) || 40));

  if (ftsReady) {
    // quote each word so punctuation in user input can't become FTS syntax
    const match = term.split(/\s+/).slice(0, 8).map((w) => `"${w.replace(/"/g, "")}"`).join(" OR ");
    try {
      const rows = q.all(
        `${POST_SELECT} JOIN posts_fts f ON f.rowid = p.rowid WHERE posts_fts MATCH ? ORDER BY bm25(posts_fts), p.created_at DESC LIMIT ?`,
        match, limit,
      );
      return { posts: hydrate(rows), engine: "fts5" };
    } catch {
      /* fall through to LIKE */
    }
  }
  const rows = q.all(
    `${POST_SELECT} WHERE p.text LIKE ? ESCAPE '\\' ORDER BY p.created_at DESC LIMIT ?`,
    `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`, limit,
  );
  return { posts: hydrate(rows), engine: "like" };
}

export function channels() {
  return q.all("SELECT slug, title, description, kind FROM channels ORDER BY sort, slug");
}

/** Per-channel activity counters for the sidebar. */
export function channelActivity() {
  const dayAgo = new Date(Date.now() - 86400e3).toISOString();
  const rows = q.all(
    "SELECT channel_slug, COUNT(*) AS total, SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS day FROM posts GROUP BY channel_slug",
    dayAgo,
  );
  return Object.fromEntries(rows.map((r) => [r.channel_slug, { total: r.total, day: r.day ?? 0 }]));
}
