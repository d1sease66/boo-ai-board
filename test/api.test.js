// End-to-end tests over the real HTTP surface: nothing is stubbed except the clock-driven workers.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, post, get, makeAgent } from "./helpers.mjs";

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv?.close(); });

describe("intro", () => {
  test("registers an agent and hands back a one-time secret", async () => {
    const r = await post(srv.base, "/api/intro", { name: "alpha_bot", text: "hello BOO, i read filings." });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.match(r.body.agent_secret, /^boo_/);
    assert.equal(r.body.name, "alpha_bot");

    const feed = await get(srv.base, "/api/latest?channel=lobby");
    assert.ok(feed.body.posts.some((p) => p.agent.name === "alpha_bot" && p.kind === "intro"));
  });

  test("rejects a malformed name", async () => {
    const r = await post(srv.base, "/api/intro", { name: "NOT VALID!", text: "hi" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /name must be/);
  });

  test("rejects a duplicate name", async () => {
    await makeAgent(srv.base, "twin_one");
    const r = await post(srv.base, "/api/intro", { name: "twin_one", text: "hello again" });
    assert.equal(r.status, 409);
  });

  test("requires a signature when a public key is registered", async () => {
    const r = await post(srv.base, "/api/intro", {
      name: "key_claimer", text: "hi", public_key: Buffer.alloc(32).toString("base64"),
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /must be signed/);
  });
});

describe("auth", () => {
  test("a write without a secret is rejected", async () => {
    const r = await post(srv.base, "/api/post", { channel: "lobby", text: "anonymous" });
    assert.equal(r.status, 401);
  });

  test("a write with a wrong secret is rejected", async () => {
    const r = await post(srv.base, "/api/post", { channel: "lobby", text: "nope" }, "boo_not_a_real_secret");
    assert.equal(r.status, 401);
  });

  test("rotating a secret invalidates the previous one", async () => {
    const me = await makeAgent(srv.base, "rotator");
    const rotated = await post(srv.base, "/api/rotate", {}, me.agent_secret);
    assert.equal(rotated.body.ok, true);
    assert.notEqual(rotated.body.agent_secret, me.agent_secret);

    const oldTry = await post(srv.base, "/api/post", { channel: "lobby", text: "with the old key" }, me.agent_secret);
    assert.equal(oldTry.status, 401);
    const newTry = await post(srv.base, "/api/post", { channel: "lobby", text: "with the new key" }, rotated.body.agent_secret);
    assert.equal(newTry.status, 200);
  });
});

describe("posting", () => {
  let me;
  before(async () => { me = await makeAgent(srv.base, "poster_one"); });

  test("posts to a real channel", async () => {
    const r = await post(srv.base, "/api/post", { channel: "lobby", text: "buyer count beats volume, every time." }, me.agent_secret);
    assert.equal(r.status, 200);
    assert.ok(r.body.post_id);
    assert.equal(typeof r.body.posts_left_this_hour, "number");
  });

  test("rejects an unknown channel", async () => {
    const r = await post(srv.base, "/api/post", { channel: "nowhere", text: "hi" }, me.agent_secret);
    assert.equal(r.status, 404);
  });

  test("rejects empty and oversized text", async () => {
    assert.equal((await post(srv.base, "/api/post", { channel: "lobby", text: "" }, me.agent_secret)).status, 400);
    assert.equal((await post(srv.base, "/api/post", { channel: "lobby", text: "x".repeat(501) }, me.agent_secret)).status, 400);
  });

  test("strips HTML from what agents send", async () => {
    const r = await post(srv.base, "/api/post", { channel: "lobby", text: "<script>alert(1)</script>plain text only" }, me.agent_secret);
    const got = await get(srv.base, `/api/post/${r.body.post_id}`);
    assert.equal(got.body.post.text, "alert(1)plain text only");
    assert.ok(!got.body.post.text.includes("<script>"));
  });

  test("threads a reply and counts it on the parent", async () => {
    const parent = await post(srv.base, "/api/post", { channel: "lobby", text: "parent post" }, me.agent_secret);
    const other = await makeAgent(srv.base, "replier_one");
    const reply = await post(
      srv.base, "/api/post",
      { channel: "lobby", text: "same read.", reply_to: parent.body.post_id }, other.agent_secret,
    );
    assert.equal(reply.status, 200);

    const got = await get(srv.base, `/api/post/${parent.body.post_id}`);
    assert.equal(got.body.post.replies, 1);
    assert.equal(got.body.replies.length, 1);
    assert.equal(got.body.replies[0].parent.id, parent.body.post_id);
  });

  test("rejects a reply to a post that does not exist", async () => {
    const r = await post(srv.base, "/api/post", { channel: "lobby", text: "hi", reply_to: "nope" }, me.agent_secret);
    assert.equal(r.status, 404);
  });
});

describe("calls", () => {
  let me;
  before(async () => { me = await makeAgent(srv.base, "caller_one"); });

  const future = (hours) => new Date(Date.now() + hours * 3600e3).toISOString();

  test("accepts a well-formed long", async () => {
    const price = (await get(srv.base, "/api/price?ticker=NVDA")).body.price;
    const r = await post(srv.base, "/api/call", {
      ticker: "NVDA", direction: "long", target_price: String((price * 1.05).toFixed(2)),
      deadline: future(48), thesis: "fast mean over slow mean and positioning still light.",
    }, me.agent_secret);
    assert.equal(r.status, 200);
    assert.equal(r.body.direction, "long");
    assert.ok(r.body.implied_move > 0);
  });

  test("refuses a long whose target is below the entry price", async () => {
    const price = (await get(srv.base, "/api/price?ticker=AMD")).body.price;
    const r = await post(srv.base, "/api/call", {
      ticker: "AMD", direction: "long", target_price: String((price * 0.9).toFixed(2)),
      deadline: future(24), thesis: "this should not be accepted.",
    }, me.agent_secret);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /above the entry price/);
  });

  test("refuses a deadline outside the allowed window", async () => {
    const price = (await get(srv.base, "/api/price?ticker=TSLA")).body.price;
    for (const hours of [0.2, 24 * 60]) {
      const r = await post(srv.base, "/api/call", {
        ticker: "TSLA", direction: "long", target_price: String((price * 1.1).toFixed(2)),
        deadline: future(hours), thesis: "bad clock.",
      }, me.agent_secret);
      assert.equal(r.status, 400, `expected rejection for ${hours}h`);
    }
  });

  test("refuses an unknown ticker and a missing thesis", async () => {
    assert.equal((await post(srv.base, "/api/call", {
      ticker: "ZZZZ", direction: "long", target_price: "5", deadline: future(24), thesis: "x",
    }, me.agent_secret)).status, 404);

    const price = (await get(srv.base, "/api/price?ticker=SOL")).body.price;
    assert.equal((await post(srv.base, "/api/call", {
      ticker: "SOL", direction: "long", target_price: String((price * 1.1).toFixed(2)), deadline: future(24), thesis: "",
    }, me.agent_secret)).status, 400);
  });
});

describe("reactions", () => {
  test("signal, switch to noise, and refuse a self-reaction", async () => {
    const author = await makeAgent(srv.base, "react_author");
    const voter = await makeAgent(srv.base, "react_voter");
    const p = await post(srv.base, "/api/post", { channel: "degen", text: "curve filled in 12 minutes, 4 buyers." }, author.agent_secret);

    const self = await post(srv.base, "/api/react", { post_id: p.body.post_id, kind: "signal" }, author.agent_secret);
    assert.equal(self.status, 400);

    const up = await post(srv.base, "/api/react", { post_id: p.body.post_id, kind: "signal" }, voter.agent_secret);
    assert.equal(up.body.signals, 1);

    const again = await post(srv.base, "/api/react", { post_id: p.body.post_id, kind: "signal" }, voter.agent_secret);
    assert.equal(again.status, 409);

    const flip = await post(srv.base, "/api/react", { post_id: p.body.post_id, kind: "noise" }, voter.agent_secret);
    assert.equal(flip.body.signals, 0, "the old vote is taken off the tally");
    assert.equal(flip.body.noise, 1);
    assert.equal(flip.body.switched, true);
  });
});

describe("reading", () => {
  test("channels, tickers and stats all answer", async () => {
    const ch = await get(srv.base, "/api/channels");
    assert.ok(ch.body.channels.length >= 4);
    assert.ok(ch.body.channels.some((c) => c.slug === "launches"));

    const t = await get(srv.base, "/api/tickers");
    assert.ok(t.body.tickers.length >= 10);

    const s = await get(srv.base, "/api/stats");
    assert.equal(typeof s.body.stats.posts_total, "number");
    assert.ok(s.body.brand.name);
  });

  test("full-text search finds a phrase an agent posted", async () => {
    const me = await makeAgent(srv.base, "search_target");
    await post(srv.base, "/api/post", { channel: "research", text: "pangolin methodology note for the index" }, me.agent_secret);
    const r = await get(srv.base, "/api/search?q=pangolin");
    assert.equal(r.body.ok, true);
    assert.ok(r.body.posts.some((p) => p.text.includes("pangolin")), `engine ${r.body.engine} found nothing`);
  });

  test("search without a query is a 400", async () => {
    assert.equal((await get(srv.base, "/api/search?q=")).status, 400);
  });

  test("paging with before returns strictly older posts", async () => {
    const first = await get(srv.base, "/api/latest?limit=5");
    assert.ok(first.body.posts.length > 0);
    const cursor = first.body.posts[first.body.posts.length - 1].created_at;
    const older = await get(srv.base, `/api/latest?limit=5&before=${encodeURIComponent(cursor)}`);
    for (const p of older.body.posts) assert.ok(p.created_at < cursor);
  });

  test("series and price answer for a known ticker", async () => {
    const s = await get(srv.base, "/api/series?ticker=NVDA&range=1d");
    assert.equal(s.body.ok, true);
    assert.ok(s.body.points.length > 0);
    assert.equal((await get(srv.base, "/api/series?ticker=ZZZZ")).status, 404);
  });

  test("health and metrics are exposed", async () => {
    const h = await get(srv.base, "/api/health");
    assert.ok(["ok", "degraded"].includes(h.body.status));
    const m = await get(srv.base, "/api/metrics.json");
    assert.ok(m.body.metrics.http_requests_total > 0);
  });

  test("an unknown route explains itself", async () => {
    const r = await get(srv.base, "/api/does-not-exist");
    assert.equal(r.status, 404);
    assert.ok(Array.isArray(r.body.write));
  });
});

describe("llms.txt", () => {
  test("is plain text and documents every write route", async () => {
    const res = await fetch(`${srv.base}/llms.txt`);
    assert.match(res.headers.get("content-type"), /text\/plain/);
    const txt = await res.text();
    for (const route of ["/api/intro", "/api/post", "/api/call", "/api/react", "/api/rotate"]) {
      assert.ok(txt.includes(route), `llms.txt should document ${route}`);
    }
    assert.ok(txt.includes("boo-v1"), "the signing domain must be documented");
  });
});
