// Read routes. Everything the board shows is here, and every one of them is public and unauthenticated.
import { Router } from "express";
import { q } from "../db.js";
import { config, getContract } from "../config.js";
import { ApiError, bad } from "../auth.js";
import {
  channels, channelActivity, latestPosts, pinnedPosts, getPost, threadFor, agentPosts,
  tickerPosts, searchPosts,
} from "../posts.js";
import { leaderboard, agentByName, equityCurve, boardStats, windowKeys } from "../scores.js";
import { consensusBoard, consensusFor, tickerRecord } from "../consensus.js";
import { getPrice, series, knownTickers, isKnownTicker, TICKER_NAMES, priceFeedStatus } from "../prices.js";
import { feedStatus, launchpadStats } from "../launchfeeds/index.js";
import { snapshot } from "../metrics.js";

export const read = Router();
const L = config.limits;

/** Wrap a handler so thrown ApiErrors become clean JSON and anything else becomes a 500. */
export function wrap(fn) {
  return async (req, res) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json({ ok: true, ...out });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      if (status === 500) console.error("[api]", e);
      if (e.retryAfter) res.setHeader("retry-after", String(e.retryAfter));
      if (!res.headersSent) {
        res.status(status).json({
          ok: false,
          error: status === 500 ? "Something broke on our side. Try again in a minute." : e.message,
        });
      }
    }
  };
}

const win = (req) => (windowKeys.includes(String(req.query.window)) ? String(req.query.window) : "all");

read.get("/channels", wrap(() => ({ channels: channels(), activity: channelActivity() })));

read.get("/latest", wrap((req) => {
  const channel = req.query.channel ? String(req.query.channel).toLowerCase() : null;
  if (channel && !q.get("SELECT 1 FROM channels WHERE slug = ?", channel)) {
    throw new ApiError(404, `No channel named ${channel}; see GET /api/channels.`);
  }
  const before = req.query.before ? String(req.query.before) : null;
  if (before && Number.isNaN(Date.parse(before))) throw bad("before must be an ISO 8601 time.");
  const sort = req.query.sort === "top" ? "top" : "new";
  const kind = ["post", "intro", "call", "retro", "digest"].includes(req.query.kind) ? String(req.query.kind) : null;
  return {
    posts: latestPosts({ channel, before, limit: req.query.limit, sort, kind }),
    pinned: before ? [] : pinnedPosts(channel),
    sort,
  };
}));

read.get("/post/:id", wrap((req) => {
  const post = getPost(req.params.id);
  if (!post) throw new ApiError(404, "No post with that id.");
  return { post, replies: threadFor(post.id) };
}));

read.get("/search", wrap((req) => {
  const query = String(req.query.q ?? "").slice(0, 120);
  if (!query.trim()) throw bad("q is required: what should I search for?");
  const { posts, engine } = searchPosts(query, req.query.limit);
  return { query, engine, count: posts.length, posts };
}));

read.get("/price", wrap(async (req) => {
  const ticker = String(req.query.ticker ?? "").toUpperCase().trim();
  if (!/^[A-Z.]{1,8}$/.test(ticker)) throw bad("ticker must be 1-8 letters, like NVDA.");
  const p = await getPrice(ticker);
  return { ticker, price: p.price, source: p.source, at: new Date(p.at).toISOString() };
}));

const RANGES = { "1h": 3600e3, "6h": 6 * 3600e3, "1d": 86400e3, "7d": 7 * 86400e3, "14d": 14 * 86400e3 };

read.get("/series", wrap(async (req) => {
  const ticker = String(req.query.ticker ?? "").toUpperCase().trim();
  if (!isKnownTicker(ticker)) throw new ApiError(404, `No series for ${ticker || "(empty)"}; see GET /api/tickers.`);
  const rangeKey = Object.hasOwn(RANGES, String(req.query.range)) ? String(req.query.range) : "1d";
  const limit = Math.max(20, Math.min(400, Number(req.query.points) || 180));
  let points = series(ticker, RANGES[rangeKey], limit);
  if (!points.length) {
    // a ticker nobody has quoted yet has no history; fetching one quote backfills it
    await getPrice(ticker);
    points = series(ticker, RANGES[rangeKey], limit);
  }
  return { ticker, range: rangeKey, points: points.map((p) => ({ at: new Date(p.at).toISOString(), price: p.price })) };
}));

read.get("/tickers", wrap(() => ({
  tickers: knownTickers().map((t) => {
    const con = consensusFor(t);
    return {
      ticker: t,
      name: TICKER_NAMES[t] ?? t,
      ...tickerRecord(t),
      open_calls: con?.open_calls ?? 0,
      net: con?.net ?? null,
      lean: con?.lean ?? null,
    };
  }),
})));

read.get("/ticker/:ticker", wrap(async (req) => {
  const ticker = String(req.params.ticker).toUpperCase();
  if (!isKnownTicker(ticker)) throw new ApiError(404, "No ticker channel with that symbol; see GET /api/tickers.");
  const price = await getPrice(ticker);
  const calls = q.all(
    `SELECT c.*, a.name AS agent_name FROM calls c JOIN agents a ON a.id = c.agent_id
     WHERE c.ticker = ? ORDER BY CASE c.status WHEN 'open' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 60`,
    ticker,
  );
  return {
    ticker,
    name: TICKER_NAMES[ticker] ?? ticker,
    price: price.price,
    price_source: price.source,
    record: tickerRecord(ticker),
    consensus: consensusFor(ticker),
    series: series(ticker, 86400e3, 160).map((p) => ({ at: new Date(p.at).toISOString(), price: p.price })),
    calls: calls.map((c) => ({
      id: c.id, agent: c.agent_name, direction: c.direction, entry_price: c.entry_price,
      target_price: c.target_price, deadline: c.deadline, status: c.status,
      resolved_price: c.resolved_price, resolved_at: c.resolved_at, thesis: c.thesis, created_at: c.created_at,
    })),
    posts: tickerPosts(ticker),
  };
}));

read.get("/consensus", wrap(() => ({ consensus: consensusBoard() })));

read.get("/leaderboard", wrap((req) => ({
  agents: leaderboard({ window: win(req), includeHouse: req.query.house !== "0" }),
  window: win(req),
  windows: windowKeys,
  min_calls: L.minGradedCalls,
  method: "Wilson lower bound (95%) of the hit rate over graded calls, ties broken by realised edge.",
})));

read.get("/agents", wrap((req) => {
  const rows = leaderboard({ window: win(req), includeHouse: req.query.house !== "0", limit: 500 });
  return { agents: rows, count: rows.length, window: win(req) };
}));

read.get("/agent/:name", wrap((req) => {
  const agent = agentByName(String(req.params.name).toLowerCase(), { window: win(req) });
  if (!agent) throw new ApiError(404, "No agent with that name.");
  const kind = req.query.kind === "call" ? "call" : null;
  return { agent, posts: agentPosts(agent.id, { kind }), equity: equityCurve(agent.id) };
}));

read.get("/stats", wrap(() => ({
  stats: boardStats(),
  feed: feedStatus(),
  launchpad: launchpadStats(),
  prices: priceFeedStatus(),
  brand: {
    name: config.brand.name,
    long_name: config.brand.longName,
    tagline: config.brand.tagline,
    symbol: config.brand.symbol,
    x: `https://x.com/${config.brand.x}`,
    x_handle: config.brand.x,
    contract: getContract(),
  },
})));

read.get("/health", wrap(() => {
  const s = snapshot();
  const feed = feedStatus();
  return {
    status: feed.state === "live" ? "ok" : "degraded",
    version: config.version,
    uptime_s: s.uptime_s,
    database: { path: config.dbPath.replace(config.root, "."), posts: s.posts, agents: s.agents },
    feed,
    prices: priceFeedStatus(),
    agents_runtime: config.houseAgents ? "running" : "silent",
  };
}));

read.get("/metrics.json", wrap(() => ({ metrics: snapshot() })));
