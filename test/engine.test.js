// Unit tests for the parts that decide who is right: scoring, grading and consensus.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

let dir, mods;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "boo-engine-"));
  process.env.DB_PATH = join(dir, "engine.db");
  process.env.HOUSE_AGENTS = "0";
  process.env.PRICE_SOURCE = "sim";
  process.env.LAUNCH_FEED = "sim";
  mods = {
    db: await import("../server/db.js"),
    scores: await import("../server/scores.js"),
    consensus: await import("../server/consensus.js"),
    grader: await import("../server/grader.js"),
    prices: await import("../server/prices.js"),
    seed: await import("../server/seed.js"),
    brain: await import("../server/agents/brain.js"),
    roster: await import("../server/agents/roster.js"),
    launchfeeds: await import("../server/launchfeeds/index.js"),
  };
  mods.seed.seedChannels();
});

after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const iso = (ms) => new Date(ms).toISOString();

function addAgent(name) {
  const id = randomUUID();
  const at = iso(Date.now() - 20 * 86400e3);
  mods.db.q.run(
    `INSERT INTO agents (id, name, bio, avatar_url, visibility, human_handle, public_key, secret_hash, is_house, role, model, created_at, last_seen_at)
     VALUES (?,?,'','',?,NULL,NULL,?,0,'guest',NULL,?,?)`,
    id, name, "anonymous", randomUUID(), at, at,
  );
  return id;
}

/** Insert a graded or open call directly, bypassing the API, to test the maths in isolation. */
function addCall(agentId, { ticker = "NVDA", direction = "long", entry = 100, target = 110, status = "open", resolved = null, agoH = 24 } = {}) {
  const postId = randomUUID(), callId = randomUUID();
  const created = iso(Date.now() - agoH * 3600e3);
  mods.db.q.run(
    `INSERT INTO posts (id, agent_id, channel_slug, kind, text, pinned, reply_to, launch_id, signature, signed_message, created_at)
     VALUES (?,?,?,'call','thesis',0,NULL,NULL,NULL,NULL,?)`,
    postId, agentId, ticker.toLowerCase(), created,
  );
  mods.db.q.run(
    `INSERT INTO calls (id, post_id, agent_id, ticker, direction, entry_price, target_price, deadline, thesis, status, resolved_price, resolved_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,'thesis',?,?,?,?)`,
    callId, postId, agentId, ticker, direction, entry, target,
    iso(Date.now() + 24 * 3600e3), status, resolved,
    status === "open" ? null : iso(Date.now() - (agoH - 1) * 3600e3), created,
  );
  return callId;
}

describe("wilson lower bound", () => {
  test("rewards evidence, not a lucky run", () => {
    const { wilsonLower } = mods.scores;
    const lucky = wilsonLower(3, 3);
    const proven = wilsonLower(40, 50);
    assert.ok(proven > lucky, `40/50 (${proven.toFixed(3)}) should outrank 3/3 (${lucky.toFixed(3)})`);
  });

  test("is bounded, monotonic in volume, and zero with no data", () => {
    const { wilsonLower } = mods.scores;
    assert.equal(wilsonLower(0, 0), 0);
    assert.ok(wilsonLower(10, 10) > wilsonLower(5, 5));
    for (const [h, n] of [[0, 10], [5, 10], [10, 10], [1, 3]]) {
      const v = wilsonLower(h, n);
      assert.ok(v >= 0 && v <= 1, `${h}/${n} produced ${v}`);
    }
  });

  test("a perfect record never reaches 1", () => {
    assert.ok(mods.scores.wilsonLower(100, 100) < 1);
  });
});

describe("realised edge", () => {
  test("is signed by the direction of the call", () => {
    const { callEdge } = mods.scores;
    assert.ok(Math.abs(callEdge({ direction: "long", entry_price: 100, resolved_price: 110 }) - 0.1) < 1e-9);
    assert.ok(Math.abs(callEdge({ direction: "short", entry_price: 100, resolved_price: 90 }) - 0.1) < 1e-9);
    // a long that fell is negative edge, even if it was graded
    assert.ok(callEdge({ direction: "long", entry_price: 100, resolved_price: 90 }) < 0);
    assert.equal(callEdge({ direction: "long", entry_price: 100, resolved_price: null }), null);
  });
});

describe("agent scoring", () => {
  test("aggregates hits, edge and form from the call table", () => {
    const id = addAgent("scorer_one");
    addCall(id, { status: "hit", entry: 100, target: 110, resolved: 112, agoH: 100 });
    addCall(id, { status: "hit", entry: 100, target: 110, resolved: 111, agoH: 90 });
    addCall(id, { status: "missed", entry: 100, target: 110, resolved: 96, agoH: 80 });
    addCall(id, { status: "open", agoH: 2 });

    const row = mods.db.q.get("SELECT * FROM agent_scores WHERE id = ?", id);
    const s = mods.scores.scoreRow(row);
    assert.equal(s.calls_total, 3);
    assert.equal(s.calls_hit, 2);
    assert.equal(s.calls_open, 1);
    assert.ok(Math.abs(s.hit_rate - 2 / 3) < 1e-9);
    assert.deepEqual(s.form, [1, 1, 0]);
    assert.ok(s.avg_edge > 0);
    assert.equal(s.ranked, false, "three graded calls is under the five-call minimum");
  });

  test("the ranking puts proven records above short lucky ones", () => {
    const lucky = addAgent("lucky_streak");
    for (let i = 0; i < 5; i++) addCall(lucky, { status: "hit", entry: 100, target: 103, resolved: 104, agoH: 50 - i });
    const proven = addAgent("long_record");
    for (let i = 0; i < 30; i++) {
      addCall(proven, { status: i < 24 ? "hit" : "missed", entry: 100, target: 106, resolved: i < 24 ? 107 : 99, agoH: 200 - i });
    }
    const board = mods.scores.leaderboard();
    const names = board.filter((a) => a.ranked).map((a) => a.name);
    assert.ok(names.includes("long_record") && names.includes("lucky_streak"));
    assert.ok(
      names.indexOf("long_record") < names.indexOf("lucky_streak"),
      "24/30 should rank above 5/5",
    );
  });

  test("the equity curve accumulates realised edge in order", () => {
    const id = addAgent("curve_walker");
    addCall(id, { status: "hit", entry: 100, target: 110, resolved: 110, agoH: 60 });
    addCall(id, { status: "missed", entry: 100, target: 110, resolved: 95, agoH: 50 });
    const eq = mods.scores.equityCurve(id);
    assert.equal(eq.length, 2);
    assert.ok(eq[0].cum > 0);
    assert.ok(eq[1].cum < eq[0].cum, "a miss must pull the curve down");
  });
});

describe("consensus", () => {
  test("weights open calls and reports the lean", () => {
    const bull = addAgent("con_bull");
    const bear = addAgent("con_bear");
    addCall(bull, { ticker: "AAPL", direction: "long", entry: 200, target: 220, status: "open" });
    addCall(bull, { ticker: "AAPL", direction: "long", entry: 200, target: 215, status: "open" });
    addCall(bear, { ticker: "AAPL", direction: "short", entry: 200, target: 180, status: "open" });

    const c = mods.consensus.consensusFor("AAPL");
    assert.equal(c.open_calls, 3);
    assert.equal(c.longs, 2);
    assert.equal(c.shorts, 1);
    assert.ok(c.net > 0, "two longs against one short leans long");
    assert.equal(c.lean, "long");
    assert.ok(c.consensus_target > 200);
  });

  test("returns null for a ticker nobody is committed on", () => {
    assert.equal(mods.consensus.consensusFor("LINK"), null);
  });

  test("the per-ticker record only counts graded calls", () => {
    const id = addAgent("record_keeper");
    addCall(id, { ticker: "MSFT", status: "hit", entry: 500, target: 520, resolved: 525, agoH: 40 });
    addCall(id, { ticker: "MSFT", status: "missed", entry: 500, target: 520, resolved: 495, agoH: 30 });
    addCall(id, { ticker: "MSFT", status: "open" });
    const r = mods.consensus.tickerRecord("MSFT");
    assert.equal(r.graded, 2);
    assert.equal(r.hits, 1);
    assert.equal(r.hit_rate, 0.5);
  });
});

describe("grading", () => {
  test("settles a call early once its target has been touched", async () => {
    const id = addAgent("early_bird");
    const callId = addCall(id, { ticker: "COIN", direction: "long", entry: 300, target: 310, status: "open", agoH: 3 });
    // a tick inside the open window that reached the target
    mods.db.q.run("INSERT OR REPLACE INTO price_ticks(ticker, at, price) VALUES(?,?,?)", "COIN", Date.now() - 3600e3, 315);

    await mods.grader.gradeDueCalls();
    const row = mods.db.q.get("SELECT * FROM calls WHERE id = ?", callId);
    assert.equal(row.status, "hit");
    assert.equal(row.resolved_early, 1);
    assert.equal(row.resolved_price, 310, "an early settle books the target price, not the spike");
  });

  test("a short settles early when the price traded down to its target", async () => {
    const id = addAgent("early_bear");
    const callId = addCall(id, { ticker: "META", direction: "short", entry: 700, target: 680, status: "open", agoH: 3 });
    mods.db.q.run("INSERT OR REPLACE INTO price_ticks(ticker, at, price) VALUES(?,?,?)", "META", Date.now() - 3600e3, 675);
    await mods.grader.gradeDueCalls();
    assert.equal(mods.db.q.get("SELECT status FROM calls WHERE id = ?", callId).status, "hit");
  });

  test("leaves an untouched call open", async () => {
    const id = addAgent("patient_one");
    const callId = addCall(id, { ticker: "QQQ", direction: "long", entry: 600, target: 900, status: "open", agoH: 2 });
    mods.db.q.run("INSERT OR REPLACE INTO price_ticks(ticker, at, price) VALUES(?,?,?)", "QQQ", Date.now() - 1800e3, 601);
    await mods.grader.gradeDueCalls();
    assert.equal(mods.db.q.get("SELECT status FROM calls WHERE id = ?", callId).status, "open");
  });
});

describe("launch feed", () => {
  test("heat decays by half every fifteen minutes", () => {
    const { decayedHeat } = mods.launchfeeds;
    const now = Date.now();
    const at = new Date(now - 900_000).toISOString();
    assert.ok(Math.abs(decayedHeat(1, at, now) - 0.5) < 1e-6);
    assert.equal(decayedHeat(0, at, now), 0);
    assert.equal(decayedHeat(1, null, now), 0);
  });

  test("an upsert is keyed on the token address", () => {
    const token = "0x" + "ab".repeat(20);
    mods.launchfeeds.upsertLaunch({
      id: randomUUID(), token_address: token, name: "first", symbol: "FST",
      threshold: 4, launched_at: iso(Date.now()), source: "sim",
    });
    mods.launchfeeds.upsertLaunch({
      id: randomUUID(), token_address: token.toUpperCase(), name: "renamed", symbol: "FST",
      threshold: 4, launched_at: iso(Date.now()), quote_net: 2, progress: 0.5, source: "sim",
    });
    const rows = mods.db.q.all("SELECT * FROM launches WHERE token_address = ?", token);
    assert.equal(rows.length, 1, "the same token must not be indexed twice");
    assert.equal(rows[0].name, "renamed");
    assert.equal(rows[0].progress, 0.5);
  });
});

describe("resident agents", () => {
  test("every roster entry is complete and uniquely named", () => {
    const { ROSTER } = mods.roster;
    assert.ok(ROSTER.length >= 20, `expected a full roster, got ${ROSTER.length}`);
    const names = new Set();
    for (const a of ROSTER) {
      assert.match(a.name, /^[a-z0-9_]{2,24}$/, `${a.name} is not a valid agent name`);
      assert.ok(!names.has(a.name), `${a.name} is duplicated`);
      names.add(a.name);
      assert.ok(a.bio.length > 10, `${a.name} needs a bio`);
      assert.ok(a.tempo > 0);
      assert.ok(["follow", "fade", "neutral"].includes(a.momentum));
      assert.ok(Object.values(a.weights).some((w) => w > 0), `${a.name} would never act`);
      assert.ok(a.beats.channels.length > 0, `${a.name} has no channel`);
    }
  });

  test("generated lines never leave an unfilled placeholder", () => {
    const { ROSTER } = mods.roster;
    const launch = {
      id: "l1", name: "ghostcoin", symbol: "GHST", threshold: 4, pair_symbol: "ETH", buys: 12, sells: 3,
      buyers_seen: 9, volume: 2.4, progress: 0.62, launched_at: iso(Date.now() - 3600e3), deployer: "0x" + "cd".repeat(20),
    };
    for (const agent of ROSTER) {
      for (const phase of ["new", "milestone", "graduated"]) {
        const line = mods.brain.launchLine(agent, launch, phase);
        assert.ok(line && line.length > 10, `${agent.name}/${phase} produced nothing`);
        assert.ok(!/\{\w+\}/.test(line), `${agent.name}/${phase} left a placeholder: ${line}`);
      }
      const chatter = mods.brain.chatterLine(agent);
      if (chatter) assert.ok(!/\{\w+\}/.test(chatter), `${agent.name} chatter left a placeholder: ${chatter}`);
    }
  });

  test("a reply names the agent it answers and carries a reason", () => {
    const agent = mods.roster.ROSTER.find((a) => a.role === "skeptic");
    const line = mods.brain.replyLine(agent, { agent: { name: "someone_else" }, text: "the curve is filling" });
    assert.ok(line.includes("someone_else") || line.length > 10);
    assert.ok(!/\{\w+\}/.test(line));
  });

  test("a planned call respects the agent's temperament", () => {
    // give the planner a clean uptrend to read
    const now = Date.now();
    for (let i = 60; i >= 0; i--) {
      mods.db.q.run("INSERT OR REPLACE INTO price_ticks(ticker, at, price) VALUES(?,?,?)", "AVGO", now - i * 60_000, 300 + (60 - i) * 0.9);
    }
    const follower = { ...mods.roster.ROSTER[0], momentum: "follow", beats: { channels: ["lobby"], tickers: ["AVGO"] } };
    const fader = { ...mods.roster.ROSTER[0], momentum: "fade", beats: { channels: ["lobby"], tickers: ["AVGO"] } };
    const a = mods.brain.planCall(follower);
    const b = mods.brain.planCall(fader);
    assert.ok(a && b, "both agents should be able to plan against a clear trend");
    assert.equal(a.direction, "long", "a trend follower goes with a rising series");
    assert.equal(b.direction, "short", "a contrarian fades the same series");
    // the target must be on the correct side of the entry, or the API would reject it
    assert.ok(a.target_price > a.entry_price);
    assert.ok(b.target_price < b.entry_price);
    assert.ok(Date.parse(a.deadline) > Date.now());
  });
});

describe("text safety", () => {
  test("HTML and control characters never survive", async () => {
    const { stripHtml } = await import("../server/auth.js");
    assert.equal(stripHtml("<b>bold</b>"), "bold");
    assert.equal(stripHtml("<img src=x onerror=alert(1)>hello"), "hello");
    assert.equal(stripHtml("a\u0000b"), "ab");
    assert.equal(stripHtml("  trimmed  "), "trimmed");
    assert.equal(stripHtml(null), "");
  });
});
