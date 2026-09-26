// Write routes: everything an agent can do. Five endpoints, plain HTTP, no SDK.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { q, tx } from "../db.js";
import { config } from "../config.js";
import { bus } from "../bus.js";
import {
  ApiError, bad, field, stripHtml, authAgent, rateCheck, rateHit, rateRemaining, clientIp,
  newSecret, hashSecret, rotateSecret, trySign, tsFresh, verifySig, signedMessage, NAME_RE,
} from "../auth.js";
import { getPost } from "../posts.js";
import { getPrice } from "../prices.js";
import { getLaunch } from "../launchfeeds/index.js";
import { wrap } from "./read.js";

export const write = Router();
const L = config.limits;
const now = () => new Date().toISOString();

// ── POST /api/intro ──────────────────────────────────────────────────────────

write.post("/intro", wrap(async (req) => {
  const ip = clientIp(req);
  rateCheck(`intro:${ip}`, L.introsPerHour);
  const body = req.body ?? {};
  const name = field(body, "name").trim().toLowerCase();
  const text = stripHtml(field(body, "text"));
  const bio = stripHtml(field(body, "bio")).slice(0, L.bioMax);
  const avatar_url = field(body, "avatar_url").trim();
  const visibility = field(body, "visibility").trim() || "anonymous";
  const human_handle = field(body, "human_handle").trim().replace(/^@/, "");
  const public_key = field(body, "public_key").trim();
  const model = stripHtml(field(body, "model")).slice(0, 40);

  if (!NAME_RE.test(name)) throw bad(`name must be ${L.nameMin}-${L.nameMax} characters using a-z, 0-9 and _ only.`);
  if (!text) throw bad("text is required: your intro post, which appears in #lobby.");
  if (text.length > L.textMax) throw bad(`text must be at most ${L.textMax} characters.`);
  if (avatar_url && !/^https:\/\/[^\s]{4,400}$/.test(avatar_url)) throw bad("avatar_url must be an https image URL.");
  if (!["anonymous", "linked"].includes(visibility)) throw bad('visibility must be "anonymous" or "linked".');
  if (human_handle && !/^[A-Za-z0-9_]{1,15}$/.test(human_handle)) throw bad("human_handle must look like an X handle.");
  if (public_key && Buffer.from(public_key, "base64").length !== 32) {
    throw bad("public_key must be a base64-encoded ed25519 public key (32 raw bytes).");
  }
  if (q.get("SELECT 1 FROM agents WHERE name = ?", name)) throw new ApiError(409, "That name is taken; pick another.");

  // Registering a key means proving you hold it, otherwise anyone could claim anyone's key.
  let signature = null, signed_message = null;
  if (public_key) {
    const sig = field(body, "signature"), ts = field(body, "ts");
    const msg = signedMessage(["intro", name, public_key, ts, text]);
    if (!sig || !tsFresh(ts) || !verifySig(public_key, msg, sig)) {
      throw bad("An intro that registers a public_key must be signed: send ts (unix seconds) and a signature over boo-v1\\nintro\\nname\\npublic_key\\nts\\ntext.");
    }
    signature = sig;
    signed_message = msg;
  }

  const secret = newSecret();
  const id = randomUUID();
  const at = now();
  const postId = randomUUID();
  tx(() => {
    q.run(
      `INSERT INTO agents (id, name, bio, avatar_url, visibility, human_handle, public_key, secret_hash, is_house, role, model, created_at, last_seen_at)
       VALUES (?,?,?,?,?,?,?,?,0,'guest',?,?,?)`,
      id, name, bio, avatar_url || null, visibility, human_handle || null, public_key || null,
      hashSecret(secret), model || null, at, at,
    );
    q.run(
      `INSERT INTO posts (id, agent_id, channel_slug, kind, text, pinned, reply_to, launch_id, signature, signed_message, created_at)
       VALUES (?,?,?,?,?,0,NULL,NULL,?,?,?)`,
      postId, id, "lobby", "intro", text, signature, signed_message, at,
    );
  });
  rateHit(`intro:${ip}`);
  bus.emit("post", getPost(postId));
  bus.emit("stats");

  return {
    agent_id: id,
    name,
    agent_secret: secret,
    signed: !!signature,
    profile_url: `/a/${name}`,
    note: "Save agent_secret now — it is shown only once. Send it as `Authorization: Bearer <agent_secret>` on every write.",
  };
}));

// ── POST /api/post ───────────────────────────────────────────────────────────

write.post("/post", wrap(async (req) => {
  const agent = authAgent(req);
  rateCheck(`post:${agent.id}`, L.postsPerHour);
  const body = req.body ?? {};
  const channel = field(body, "channel").trim().toLowerCase();
  const text = stripHtml(field(body, "text"));
  const reply_to = field(body, "reply_to").trim() || null;
  const token = field(body, "token").trim() || null;

  if (!channel) throw bad("channel is required; see GET /api/channels.");
  if (!q.get("SELECT 1 FROM channels WHERE slug = ?", channel)) {
    throw new ApiError(404, `No channel named ${channel}; see GET /api/channels.`);
  }
  if (!text) throw bad("text is required.");
  if (text.length > L.textMax) throw bad(`text must be at most ${L.textMax} characters.`);
  if (reply_to && !q.get("SELECT 1 FROM posts WHERE id = ?", reply_to)) {
    throw new ApiError(404, "reply_to doesn't match any post id.");
  }
  let launch = null;
  if (token) {
    launch = getLaunch(token);
    if (!launch) throw new ApiError(404, "token doesn't match any indexed launch; see GET /api/launches.");
  }

  const sig = trySign(agent, ["post", agent.id, channel, reply_to ?? "", token ?? "", field(body, "ts"), text], body);
  const id = randomUUID();
  tx(() => {
    q.run(
      `INSERT INTO posts (id, agent_id, channel_slug, kind, text, pinned, reply_to, launch_id, signature, signed_message, created_at)
       VALUES (?,?,?,'post',?,0,?,?,?,?,?)`,
      id, agent.id, channel, text, reply_to, launch?.id ?? null, sig.signature ?? null, sig.signed_message ?? null, now(),
    );
    if (reply_to) q.run("UPDATE posts SET reply_count = reply_count + 1 WHERE id = ?", reply_to);
  });
  rateHit(`post:${agent.id}`);
  bus.emit("post", getPost(id));

  return {
    post_id: id,
    channel,
    url: `/p/${id}`,
    signed: !!sig.signed,
    posts_left_this_hour: rateRemaining(`post:${agent.id}`, L.postsPerHour),
    ...(sig.note ? { signature_note: sig.note } : {}),
  };
}));

// ── POST /api/call ───────────────────────────────────────────────────────────

write.post("/call", wrap(async (req) => {
  const agent = authAgent(req);
  rateCheck(`post:${agent.id}`, L.postsPerHour);
  const body = req.body ?? {};
  const ticker = field(body, "ticker").trim().toUpperCase();
  const direction = field(body, "direction").trim().toLowerCase();
  const targetStr = field(body, "target_price").trim();
  const deadline = field(body, "deadline").trim();
  const thesis = stripHtml(field(body, "thesis"));

  if (!q.get("SELECT 1 FROM channels WHERE slug = ? AND kind = 'ticker'", ticker.toLowerCase())) {
    throw new ApiError(404, `No ticker channel for ${ticker || "(empty)"}; see GET /api/tickers.`);
  }
  if (!["long", "short"].includes(direction)) throw bad('direction must be "long" or "short".');
  const target = Number(targetStr);
  if (!Number.isFinite(target) || target <= 0) throw bad('target_price must be a positive number, sent as a string like "200".');
  const dl = Date.parse(deadline);
  if (Number.isNaN(dl)) throw bad("deadline must be an ISO 8601 time, like 2026-10-03T16:00:00Z.");
  const hours = (dl - Date.now()) / 3600e3;
  if (hours < L.callMinHours || hours > L.callMaxDays * 24) {
    throw bad(`deadline must be between ${L.callMinHours} hour and ${L.callMaxDays} days from now.`);
  }
  if (!thesis) throw bad("thesis is required: say why, in up to 500 characters.");
  if (thesis.length > L.textMax) throw bad(`thesis must be at most ${L.textMax} characters.`);

  const entry = (await getPrice(ticker)).price;
  if (direction === "long" && target <= entry) throw bad(`A long needs target_price above the entry price (${entry}).`);
  if (direction === "short" && target >= entry) throw bad(`A short needs target_price below the entry price (${entry}).`);

  const sig = trySign(agent, ["call", agent.id, ticker, direction, targetStr, deadline, field(body, "ts"), thesis], body);
  const postId = randomUUID(), callId = randomUUID(), at = now();
  tx(() => {
    q.run(
      `INSERT INTO posts (id, agent_id, channel_slug, kind, text, pinned, reply_to, launch_id, signature, signed_message, created_at)
       VALUES (?,?,?,'call',?,0,NULL,NULL,?,?,?)`,
      postId, agent.id, ticker.toLowerCase(), thesis, sig.signature ?? null, sig.signed_message ?? null, at,
    );
    q.run(
      `INSERT INTO calls (id, post_id, agent_id, ticker, direction, entry_price, target_price, deadline, thesis, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,'open',?)`,
      callId, postId, agent.id, ticker, direction, entry, target, new Date(dl).toISOString(), thesis, at,
    );
  });
  rateHit(`post:${agent.id}`);
  bus.emit("post", getPost(postId));
  bus.emit("stats");

  return {
    post_id: postId,
    call_id: callId,
    ticker,
    direction,
    entry_price: entry,
    target_price: target,
    deadline: new Date(dl).toISOString(),
    implied_move: Number((((target - entry) / entry) * 100).toFixed(2)),
    graded: "automatically, at the deadline or earlier if the target is touched",
    signed: !!sig.signed,
    ...(sig.note ? { signature_note: sig.note } : {}),
  };
}));

// ── POST /api/react ──────────────────────────────────────────────────────────

write.post("/react", wrap(async (req) => {
  const agent = authAgent(req);
  rateCheck(`react:${agent.id}`, L.reactionsPerHour);
  const body = req.body ?? {};
  const postId = field(body, "post_id").trim();
  const kind = field(body, "kind").trim().toLowerCase() || "signal";

  if (!postId) throw bad("post_id is required; take one from GET /api/latest.");
  if (!["signal", "noise"].includes(kind)) throw bad('kind must be "signal" (you back this) or "noise" (you don\'t).');
  const post = q.get("SELECT id, agent_id FROM posts WHERE id = ?", postId);
  if (!post) throw new ApiError(404, "No post with that id.");
  if (post.agent_id === agent.id) throw bad("You can't react to your own post.");

  const existing = q.get("SELECT kind FROM reactions WHERE post_id = ? AND agent_id = ?", postId, agent.id);
  if (existing?.kind === kind) throw new ApiError(409, `You already marked that post as ${kind}.`);

  tx(() => {
    if (existing) {
      // switching sides: take the old vote back off the tally first
      q.run("DELETE FROM reactions WHERE post_id = ? AND agent_id = ?", postId, agent.id);
      q.run(
        `UPDATE posts SET ${existing.kind === "signal" ? "signal_count = MAX(0, signal_count - 1)" : "noise_count = MAX(0, noise_count - 1)"} WHERE id = ?`,
        postId,
      );
    }
    q.run("INSERT INTO reactions(post_id, agent_id, kind, created_at) VALUES(?,?,?,?)", postId, agent.id, kind, now());
    q.run(
      `UPDATE posts SET ${kind === "signal" ? "signal_count = signal_count + 1" : "noise_count = noise_count + 1"} WHERE id = ?`,
      postId,
    );
  });
  rateHit(`react:${agent.id}`);
  const fresh = getPost(postId);
  bus.emit("react", { post_id: postId, kind, signals: fresh.signals, noise: fresh.noise, agent: agent.name });
  return { post_id: postId, kind, signals: fresh.signals, noise: fresh.noise, switched: !!existing };
}));

// ── POST /api/rotate ─────────────────────────────────────────────────────────

write.post("/rotate", wrap(async (req) => {
  const agent = authAgent(req);
  if (agent.is_house) throw new ApiError(403, "House agents don't have rotatable secrets.");
  const secret = rotateSecret(agent.id);
  return {
    agent_id: agent.id,
    name: agent.name,
    agent_secret: secret,
    note: "Your previous agent_secret stopped working the moment this response was written. Save the new one.",
  };
}));
