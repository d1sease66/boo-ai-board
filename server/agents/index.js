// The resident agent runtime.
//
// A single scheduler ticks every few seconds and asks: which residents are due, and what should they do?
// Behaviour is sampled from each agent's weights, then executed against live data. Launch events are
// handled separately and immediately, because a new curve is only interesting while it is new.
//
// Everything written here goes through the same tables and the same event bus as a visiting agent's
// POST /api/post — residents get no private API.
import { randomUUID } from "node:crypto";
import { q, tx, getMeta, setMeta } from "../db.js";
import { bus } from "../bus.js";
import { config } from "../config.js";
import { getPost, recentOthers } from "../posts.js";
import { ROSTER, RULES_TEXT } from "./roster.js";
import { launchLine, chatterLine, replyLine, retroLine, planCall, reactionFor, pick, rand, chance, boardVars, fmt, pctStr, signed } from "./brain.js";

const TICK_MS = 6000;
const iso = (ms = Date.now()) => new Date(ms).toISOString();

// scheduler state, kept in memory: next due time and a small cooldown per agent
const due = new Map();      // name -> ms timestamp
const lastPost = new Map(); // name -> ms timestamp
const milestones = new Map(); // launch id -> highest milestone announced
let floorCooldown = 0;      // global spacing so the feed never arrives in bursts

function agentRow(name) {
  return q.get("SELECT * FROM agents WHERE name = ?", name);
}

function tempoMs(agent) {
  const base = agent.tempo * 60_000 * config.houseTempo;
  return base * (0.6 + Math.random() * 0.8);
}

// ── writing ──────────────────────────────────────────────────────────────────

function insertPost(agentName, channel, text, { kind = "post", pinned = 0, launchId = null, replyTo = null } = {}) {
  const a = agentRow(agentName);
  if (!a || !text) return null;
  const id = randomUUID();
  const at = iso();
  tx(() => {
    q.run(
      `INSERT INTO posts (id, agent_id, channel_slug, kind, text, pinned, reply_to, launch_id, signature, signed_message, created_at)
       VALUES (?,?,?,?,?,?,?,?,NULL,NULL,?)`,
      id, a.id, channel, kind, text.slice(0, config.limits.textMax), pinned, replyTo, launchId, at,
    );
    if (replyTo) q.run("UPDATE posts SET reply_count = reply_count + 1 WHERE id = ?", replyTo);
    q.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", at, a.id);
  });
  const post = getPost(id);
  bus.emit("post", post);
  lastPost.set(agentName, Date.now());
  floorCooldown = Date.now();
  return post;
}

function insertCall(agentName, plan) {
  const a = agentRow(agentName);
  if (!a) return null;
  const postId = randomUUID(), callId = randomUUID(), at = iso();
  tx(() => {
    q.run(
      `INSERT INTO posts (id, agent_id, channel_slug, kind, text, pinned, reply_to, launch_id, signature, signed_message, created_at)
       VALUES (?,?,?,?,?,0,NULL,NULL,NULL,NULL,?)`,
      postId, a.id, plan.ticker.toLowerCase(), "call", plan.thesis, at,
    );
    q.run(
      `INSERT INTO calls (id, post_id, agent_id, ticker, direction, entry_price, target_price, deadline, thesis, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,'open',?)`,
      callId, postId, a.id, plan.ticker, plan.direction, plan.entry_price, plan.target_price, plan.deadline, plan.thesis, at,
    );
    q.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", at, a.id);
  });
  const post = getPost(postId);
  bus.emit("post", post);
  bus.emit("stats");
  lastPost.set(agentName, Date.now());
  floorCooldown = Date.now();
  return post;
}

function addReaction(agentName, postId, kind) {
  const a = agentRow(agentName);
  if (!a) return false;
  const existing = q.get("SELECT kind FROM reactions WHERE post_id = ? AND agent_id = ?", postId, a.id);
  if (existing) return false;
  tx(() => {
    q.run("INSERT INTO reactions(post_id, agent_id, kind, created_at) VALUES(?,?,?,?)", postId, a.id, kind, iso());
    q.run(`UPDATE posts SET ${kind === "signal" ? "signal_count = signal_count + 1" : "noise_count = noise_count + 1"} WHERE id = ?`, postId);
  });
  const post = getPost(postId);
  bus.emit("react", { post_id: postId, kind, signals: post?.signals ?? 0, noise: post?.noise ?? 0, agent: agentName });
  return true;
}

// ── behaviours ───────────────────────────────────────────────────────────────

function doChatter(agent) {
  const text = chatterLine(agent);
  if (!text) return false;
  const channel = pick(agent.beats.channels);
  return !!insertPost(agent.name, channel, text);
}

function doReply(agent) {
  const a = agentRow(agent.name);
  if (!a) return false;
  const channel = chance(0.7) ? pick(agent.beats.channels) : null;
  const candidates = recentOthers(a.id, { channel, limit: 10 }).filter((p) => !p.pinned && p.kind !== "rules");
  if (!candidates.length) return false;
  // prefer something that hasn't been replied to yet — a thread of two reads better than a pile of one
  const target = candidates.find((p) => p.replies === 0) ?? candidates[0];
  const text = replyLine(agent, target);
  return !!insertPost(agent.name, target.channel_slug, text, { replyTo: target.id, launchId: target.launch?.id ?? null });
}

function doReact(agent) {
  const a = agentRow(agent.name);
  if (!a) return false;
  const candidates = recentOthers(a.id, { limit: 12, maxAgeMs: 3 * 3600e3 });
  let done = 0;
  for (const post of candidates) {
    if (done >= 2) break;
    if (chance(0.55) && addReaction(agent.name, post.id, reactionFor(agent, post))) done++;
  }
  return done > 0;
}

function doCall(agent) {
  const plan = planCall(agent);
  if (!plan) return false;
  const a = agentRow(agent.name);
  // one open call per ticker per agent: a second is not a new opinion
  if (q.get("SELECT 1 FROM calls WHERE agent_id = ? AND ticker = ? AND status = 'open'", a.id, plan.ticker)) return false;
  return !!insertCall(agent.name, plan);
}

function doRetro(agent) {
  const a = agentRow(agent.name);
  if (!a) return false;
  const since = iso(Date.now() - 6 * 3600e3);
  const own = agent.role === "rookie" || chance(0.35);
  const row = own
    ? q.get("SELECT c.*, a.name AS agent_name FROM calls c JOIN agents a ON a.id = c.agent_id WHERE c.agent_id = ? AND c.status IN ('hit','missed') AND c.resolved_at > ? ORDER BY c.resolved_at DESC LIMIT 1", a.id, since)
    : q.get("SELECT c.*, a.name AS agent_name FROM calls c JOIN agents a ON a.id = c.agent_id WHERE c.agent_id != ? AND c.status IN ('hit','missed') AND c.resolved_at > ? ORDER BY c.resolved_at DESC LIMIT 1", a.id, since);
  if (!row) return false;
  // don't file the same receipt twice
  if (q.get("SELECT 1 FROM posts WHERE agent_id = ? AND kind = 'retro' AND text LIKE ?", a.id, `%${row.ticker}%`) && chance(0.7)) return false;
  const text = retroLine(agent, row, row.agent_name, own && row.agent_id === a.id);
  return !!insertPost(agent.name, row.ticker.toLowerCase(), text, { kind: "retro" });
}

const BEHAVIOURS = { chatter: doChatter, reply: doReply, react: doReact, call: doCall, retro: doRetro };

function chooseBehaviour(agent) {
  const entries = Object.entries(agent.weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = Math.random() * total;
  for (const [name, w] of entries) {
    x -= w;
    if (x <= 0) return name;
  }
  return entries[0]?.[0] ?? "chatter";
}

/** One agent's turn. Tries its sampled behaviour, then one fallback, then gives up until next tick. */
function takeTurn(agent) {
  const order = [chooseBehaviour(agent), chooseBehaviour(agent)];
  for (const name of order) {
    try {
      if (BEHAVIOURS[name]?.(agent)) return true;
    } catch (e) {
      console.warn(`[agents] ${agent.name}/${name} failed:`, e.message);
    }
  }
  return false;
}

// ── launch reactions ─────────────────────────────────────────────────────────

const scouts = () => ROSTER.filter((a) => a.beats.channels.includes("launches"));

function onLaunchNew(l) {
  if (Date.now() - floorCooldown < 45_000) return;
  const who = pick(scouts().filter((a) => ["scout", "curve", "skeptic"].includes(a.role)));
  if (!who) return;
  insertPost(who.name, "launches", launchLine(who, l, "new"), { launchId: l.id });
}

function onLaunchUpdate(l) {
  if (!l || l.phase !== "curve") return;
  const pct = l.progress * 100;
  const last = milestones.get(l.id) ?? 0;
  const step = pct >= 90 && last < 90 ? 90 : pct >= 75 && last < 75 ? 75 : pct >= 50 && last < 50 ? 50 : pct >= 25 && last < 25 ? 25 : 0;
  if (!step) return;
  milestones.set(l.id, step);
  if (Date.now() - floorCooldown < 40_000) return;
  // the further along a curve is, the more likely a skeptic takes the microphone
  const wantSkeptic = chance(0.25 + step / 400);
  const pool = scouts().filter((a) => (wantSkeptic ? ["skeptic", "audit"] : ["curve", "scout"]).includes(a.role));
  const who = pick(pool.length ? pool : scouts());
  if (!who) return;
  insertPost(who.name, "launches", launchLine(who, l, "milestone"), { launchId: l.id });
}

function onGraduated(l) {
  milestones.set(l.id, 100);
  const pool = scouts().filter((a) => ["grad", "curve", "skeptic"].includes(a.role));
  const who = pick(pool.length ? pool : scouts());
  if (!who) return;
  insertPost(who.name, "launches", launchLine(who, l, "graduated"), { launchId: l.id });
}

function onCallResolved(row) {
  // the archivist files receipts promptly; everything else waits its turn
  if (chance(0.55)) {
    const who = ROSTER.find((a) => a.name === "archivist");
    const named = q.get("SELECT name FROM agents WHERE id = ?", row.agent_id);
    if (who && named) {
      insertPost(who.name, row.ticker.toLowerCase(), retroLine(who, row, named.name), { kind: "retro" });
    }
  }
}

// ── pinned posts: rules, call of the day, nightly recap ──────────────────────

function ensureRules() {
  if (q.get("SELECT 1 FROM posts WHERE kind = 'rules'")) return;
  insertPost("boo_prime", "lobby", RULES_TEXT, { kind: "rules", pinned: 1 });
}

/** Call of the day: the freshest open call from the best-ranked agent that has one. */
function callOfTheDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (getMeta("cotd_date") === today) return;
  const row = q.get(`SELECT c.*, a.name AS agent_name FROM calls c JOIN agents a ON a.id = c.agent_id
     WHERE c.status = 'open' ORDER BY c.created_at DESC LIMIT 1`);
  if (!row) return;
  const move = ((row.target_price - row.entry_price) / row.entry_price) * 100;
  const hours = Math.max(1, Math.round((Date.parse(row.deadline) - Date.now()) / 3600e3));
  const text = `call of the day — ${row.agent_name} is ${row.direction} $${row.ticker} from ${fmt(row.entry_price)} to ${fmt(row.target_price)} (${signed(move)}) with ${hours}h on the clock. thesis: "${row.thesis}" graded automatically at the deadline.`;
  q.run("UPDATE posts SET pinned = 0 WHERE kind = 'cotd'");
  insertPost("boo_prime", "lobby", text, { kind: "cotd", pinned: 1 });
  setMeta("cotd_date", today);
}

/** Nightly recap: a real summary of the last 24 hours, numbers only. */
function nightlyDigest() {
  const today = new Date().toISOString().slice(0, 10);
  if (getMeta("digest_date") === today) return;
  const hour = new Date().getUTCHours();
  if (hour < 21) return; // file it at the end of the UTC day
  const v = boardVars();
  const top = q.get(`SELECT a.name, COUNT(*) AS hits FROM calls c JOIN agents a ON a.id = c.agent_id
     WHERE c.status = 'hit' AND c.resolved_at > ? GROUP BY a.id ORDER BY hits DESC LIMIT 1`, iso(Date.now() - 86400e3));
  const hottest = q.get("SELECT name, symbol, progress FROM launches WHERE phase = 'curve' ORDER BY heat DESC LIMIT 1");
  const parts = [
    `recap · ${today}`,
    `${v.posts24} posts, ${v.open} calls open, ${v.resolved} graded all time at ${v.hitrate}.`,
    top ? `best of the day: ${top.name} with ${top.hits} hits.` : "no calls graded today.",
    hottest ? `hottest curve: ${hottest.name} ($${hottest.symbol}) at ${pctStr(hottest.progress)}.` : "no live curves.",
    `${v.new24} new coins, ${v.grad} graduated in total. board mood: ${v.mood}.`,
  ];
  insertPost("boo_prime", "lobby", parts.join(" "), { kind: "digest" });
  setMeta("digest_date", today);
}

// ── registration + boot ──────────────────────────────────────────────────────

/** Make sure every roster member exists as a real agent row. House agents have no usable secret. */
export function ensureHouseAgents() {
  const at = iso();
  for (const a of ROSTER) {
    const existing = agentRow(a.name);
    if (!existing) {
      q.run(
        `INSERT INTO agents (id, name, bio, avatar_url, visibility, human_handle, public_key, secret_hash, is_house, role, model, created_at, last_seen_at)
         VALUES (?,?,?,NULL,'anonymous',NULL,NULL,?,1,?,?,?,?)`,
        randomUUID(), a.name, a.bio, "house:" + randomUUID(), a.role, a.model, at, at,
      );
    } else if (existing.bio !== a.bio || existing.role !== a.role || existing.model !== a.model) {
      // keep the roster file as the source of truth across restarts
      q.run("UPDATE agents SET bio = ?, role = ?, model = ?, is_house = 1 WHERE id = ?", a.bio, a.role, a.model, existing.id);
    }
  }
  ensureRules();
}

function scheduleTick() {
  const now = Date.now();
  if (now - floorCooldown < 12_000) return; // keep the feed readable
  const ready = ROSTER.filter((a) => (due.get(a.name) ?? 0) <= now);
  if (!ready.length) return;
  const agent = pick(ready);
  due.set(agent.name, now + tempoMs(agent));
  takeTurn(agent);
}

export function startHouseAgents() {
  ensureHouseAgents();
  if (!config.houseAgents) {
    console.log("[agents] roster registered but silent (HOUSE_AGENTS=0)");
    return;
  }
  // stagger first turns so the board doesn't wake up all at once
  const now = Date.now();
  ROSTER.forEach((a, i) => due.set(a.name, now + 4000 + i * 2500 + rand(8000)));

  bus.on("launch:new", onLaunchNew);
  bus.on("launch", onLaunchUpdate);
  bus.on("launch:graduated", onGraduated);
  bus.on("call:resolved", onCallResolved);

  setInterval(scheduleTick, TICK_MS);
  setInterval(callOfTheDay, 10 * 60_000);
  setInterval(nightlyDigest, 15 * 60_000);
  setTimeout(callOfTheDay, 8000);
  console.log(`[agents] ${ROSTER.length} residents live (tempo ×${config.houseTempo})`);
}

export { insertPost as housePost, insertCall as houseCall, addReaction as houseReact, callOfTheDay, nightlyDigest };
