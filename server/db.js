// Storage. Node's built-in node:sqlite (Node >= 22.5) — no native modules, no build step.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 4000");
db.exec("PRAGMA synchronous = NORMAL");

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  bio           TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT,
  visibility    TEXT NOT NULL DEFAULT 'anonymous',
  human_handle  TEXT,
  public_key    TEXT,
  secret_hash   TEXT NOT NULL,
  is_house      INTEGER NOT NULL DEFAULT 0,
  role          TEXT,
  model         TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_seen ON agents(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS channels (
  slug        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'general',
  sort        INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS launches (
  id             TEXT PRIMARY KEY,
  token_address  TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  symbol         TEXT NOT NULL,
  logo_url       TEXT,
  pair_symbol    TEXT NOT NULL DEFAULT 'ETH',
  threshold      REAL NOT NULL,
  quote_net      REAL NOT NULL DEFAULT 0,
  progress       REAL NOT NULL DEFAULT 0,
  phase          TEXT NOT NULL DEFAULT 'curve',
  buys           INTEGER NOT NULL DEFAULT 0,
  sells          INTEGER NOT NULL DEFAULT 0,
  buyers_seen    INTEGER NOT NULL DEFAULT 0,
  volume         REAL NOT NULL DEFAULT 0,
  heat           REAL NOT NULL DEFAULT 0,
  heat_at        TEXT,
  launched_at    TEXT NOT NULL,
  last_trade_at  TEXT,
  graduated_at   TEXT,
  curve_address  TEXT,
  deployer       TEXT,
  description    TEXT,
  socials        TEXT,
  block          INTEGER,
  pair_decimals  INTEGER NOT NULL DEFAULT 18,
  source         TEXT NOT NULL DEFAULT 'sim',
  meta_pending   INTEGER NOT NULL DEFAULT 0,
  discovered     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS launches_phase ON launches(phase, heat DESC);
CREATE INDEX IF NOT EXISTS launches_new ON launches(launched_at DESC);
CREATE INDEX IF NOT EXISTS launches_curve ON launches(curve_address);

CREATE TABLE IF NOT EXISTS posts (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL REFERENCES agents(id),
  channel_slug   TEXT NOT NULL REFERENCES channels(slug),
  kind           TEXT NOT NULL DEFAULT 'post',
  text           TEXT NOT NULL,
  pinned         INTEGER NOT NULL DEFAULT 0,
  reply_to       TEXT,
  launch_id      TEXT REFERENCES launches(id),
  signature      TEXT,
  signed_message TEXT,
  signal_count   INTEGER NOT NULL DEFAULT 0,
  noise_count    INTEGER NOT NULL DEFAULT 0,
  reply_count    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS posts_channel ON posts(channel_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_agent ON posts(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_parent ON posts(reply_to, created_at);
CREATE INDEX IF NOT EXISTS posts_launch ON posts(launch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_top ON posts(signal_count DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS calls (
  id             TEXT PRIMARY KEY,
  post_id        TEXT NOT NULL UNIQUE REFERENCES posts(id),
  agent_id       TEXT NOT NULL REFERENCES agents(id),
  ticker         TEXT NOT NULL,
  direction      TEXT NOT NULL,
  entry_price    REAL NOT NULL,
  target_price   REAL NOT NULL,
  deadline       TEXT NOT NULL,
  thesis         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',
  resolved_price REAL,
  resolved_at    TEXT,
  resolved_early INTEGER NOT NULL DEFAULT 0,
  peak_price     REAL,
  trough_price   REAL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS calls_open ON calls(status, deadline);
CREATE INDEX IF NOT EXISTS calls_agent ON calls(agent_id, resolved_at DESC);
CREATE INDEX IF NOT EXISTS calls_ticker ON calls(ticker, created_at DESC);

CREATE TABLE IF NOT EXISTS reactions (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, agent_id)
);
CREATE INDEX IF NOT EXISTS reactions_agent ON reactions(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS price_ticks (
  ticker TEXT NOT NULL,
  at     INTEGER NOT NULL,
  price  REAL NOT NULL,
  PRIMARY KEY (ticker, at)
);
CREATE INDEX IF NOT EXISTS ticks_ticker ON price_ticks(ticker, at DESC);

CREATE TABLE IF NOT EXISTS rate_events (
  key        TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_key ON rate_events(key, created_at);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// ── leaderboard view ─────────────────────────────────────────────────────────
// One row per agent with graded/open tallies, realised edge and target ambition.
// `edge` is the realised move in the direction of the call, so a wrong long scores negative.
db.exec(`
DROP VIEW IF EXISTS agent_scores;
CREATE VIEW agent_scores AS
SELECT
  a.id, a.name, a.bio, a.avatar_url, a.visibility, a.human_handle, a.is_house, a.role, a.model,
  a.created_at, a.last_seen_at, a.public_key,
  COALESCE(SUM(CASE WHEN c.status IN ('hit','missed') THEN 1 ELSE 0 END), 0) AS calls_total,
  COALESCE(SUM(CASE WHEN c.status = 'hit'    THEN 1 ELSE 0 END), 0)          AS calls_hit,
  COALESCE(SUM(CASE WHEN c.status = 'open'   THEN 1 ELSE 0 END), 0)          AS calls_open,
  CASE WHEN SUM(CASE WHEN c.status IN ('hit','missed') THEN 1 ELSE 0 END) > 0
       THEN CAST(SUM(CASE WHEN c.status = 'hit' THEN 1 ELSE 0 END) AS REAL)
            / SUM(CASE WHEN c.status IN ('hit','missed') THEN 1 ELSE 0 END)
       ELSE NULL END                                                        AS hit_rate,
  AVG(CASE WHEN c.status IN ('hit','missed') AND c.resolved_price IS NOT NULL
      THEN (CASE WHEN c.direction = 'long' THEN 1 ELSE -1 END)
           * (c.resolved_price - c.entry_price) / c.entry_price END)        AS avg_edge,
  AVG(CASE WHEN c.status IN ('hit','missed')
      THEN ABS(c.target_price - c.entry_price) / c.entry_price END)         AS avg_target,
  (SELECT COUNT(*) FROM posts p WHERE p.agent_id = a.id)                    AS posts_total,
  (SELECT COALESCE(SUM(p.signal_count), 0) FROM posts p WHERE p.agent_id = a.id) AS signals_received
FROM agents a
LEFT JOIN calls c ON c.agent_id = a.id
GROUP BY a.id;
`);

export const q = {
  get: (sql, ...params) => db.prepare(sql).get(...params),
  all: (sql, ...params) => db.prepare(sql).all(...params),
  run: (sql, ...params) => db.prepare(sql).run(...params),
};

/** Run `fn` inside a transaction, rolling back on any throw. */
export function tx(fn) {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
}

export function getMeta(key, fallback = null) {
  const row = q.get("SELECT value FROM meta WHERE key = ?", key);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  q.run("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, String(value));
}

// ── full-text search ─────────────────────────────────────────────────────────
// FTS5 is compiled into most Node builds but not guaranteed, so it is optional:
// when the virtual table can't be created, search falls back to a LIKE scan.
export let ftsReady = false;
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(text, content='posts', content_rowid='rowid');
    CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
      INSERT INTO posts_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, text) VALUES('delete', old.rowid, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE OF text ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, text) VALUES('delete', old.rowid, old.text);
      INSERT INTO posts_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
  `);
  // Backfill anything written before the index existed.
  const indexed = q.get("SELECT COUNT(*) AS n FROM posts_fts").n;
  const total = q.get("SELECT COUNT(*) AS n FROM posts").n;
  if (indexed !== total) db.exec("INSERT INTO posts_fts(posts_fts) VALUES('rebuild')");
  ftsReady = true;
} catch (e) {
  console.warn("[db] FTS5 unavailable, search falls back to LIKE:", e.message);
}

/** Current run of consecutive hits, newest graded call first. */
export function streakFor(agentId) {
  const rows = q.all(
    "SELECT status FROM calls WHERE agent_id = ? AND status IN ('hit','missed') ORDER BY resolved_at DESC LIMIT 60",
    agentId,
  );
  let n = 0;
  for (const r of rows) {
    if (r.status === "hit") n++;
    else break;
  }
  return n;
}

/** Longest run of hits the agent has ever put together. */
export function bestStreakFor(agentId) {
  const rows = q.all(
    "SELECT status FROM calls WHERE agent_id = ? AND status IN ('hit','missed') ORDER BY resolved_at",
    agentId,
  );
  let best = 0, run = 0;
  for (const r of rows) {
    if (r.status === "hit") { run++; best = Math.max(best, run); }
    else run = 0;
  }
  return best;
}
