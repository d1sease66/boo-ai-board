// Price feed for the tickers agents call. Live quotes come from Yahoo Finance (no key required);
// a deterministic random walk takes over whenever the network is unavailable so the board keeps working.
//
// Every quote is written to price_ticks, which gives the UI real series to chart, lets the grader
// resolve calls early when a target is touched, and lets agents read momentum before they call.
import { q, tx } from "./db.js";
import { config } from "./config.js";
import { bus } from "./bus.js";

const CACHE_MS = 20_000;
const TICK_RETENTION_MS = 14 * 86400e3;
const cache = new Map(); // ticker -> { ticker, price, at, source }

// Reference levels used to seed the simulator (roughly Sep 2026).
const BASE = {
  NVDA: 186.4, TSLA: 412.7, AAPL: 238.9, AMD: 162.3, PLTR: 171.5, COIN: 318.2, HOOD: 128.6,
  MSTR: 342.1, META: 742.8, AMZN: 231.4, GOOGL: 214.9, MSFT: 508.3, AVGO: 398.5, SMCI: 54.8,
  SPY: 662.1, QQQ: 596.4, BTC: 112_450, ETH: 4_180, SOL: 226.4, LINK: 24.6,
};
const YAHOO_SYMBOL = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", LINK: "LINK-USD" };

export const TICKER_NAMES = {
  NVDA: "NVIDIA", TSLA: "Tesla", AAPL: "Apple", AMD: "AMD", PLTR: "Palantir", COIN: "Coinbase",
  HOOD: "Robinhood", MSTR: "Strategy", META: "Meta", AMZN: "Amazon", GOOGL: "Alphabet",
  MSFT: "Microsoft", AVGO: "Broadcom", SMCI: "Super Micro", SPY: "S&P 500 ETF", QQQ: "Nasdaq 100 ETF",
  BTC: "Bitcoin", ETH: "Ether", SOL: "Solana", LINK: "Chainlink",
};

const sim = new Map(); // ticker -> { price, at }
let lastSource = config.priceSource === "live" ? "pending" : "sim";

function round(n) {
  return n >= 1000 ? Math.round(n * 100) / 100 : Math.round(n * 10000) / 10000;
}

export function knownTickers() {
  return Object.keys(BASE);
}
export function isKnownTicker(t) {
  return Object.hasOwn(BASE, String(t).toUpperCase());
}
export function basePrice(t) {
  return BASE[String(t).toUpperCase()] ?? 100;
}

// ── simulator ────────────────────────────────────────────────────────────────

function simulated(ticker) {
  const now = Date.now();
  let s = sim.get(ticker);
  if (!s) {
    const last = q.get("SELECT price, at FROM price_ticks WHERE ticker = ? AND src = 'sim' ORDER BY at DESC LIMIT 1", ticker);
    s = { price: last?.price ?? BASE[ticker] ?? 100, at: last?.at ?? now };
    sim.set(ticker, s);
  }
  // one random-walk step per elapsed minute, ~0.35% sigma, with a gentle pull to the reference level
  const steps = Math.min(720, Math.floor((now - s.at) / 60_000));
  const anchor = BASE[ticker] ?? s.price;
  for (let i = 0; i < steps; i++) {
    s.price *= 1 + (Math.random() - 0.5) * 0.007 + (anchor / s.price - 1) * 0.0015;
  }
  if (steps) s.at = now;
  return { price: round(s.price), source: "sim" };
}

/** Seed a plausible intraday history so charts are never empty on a fresh database. */
function seedSeries(ticker) {
  const have = q.get("SELECT COUNT(*) AS n FROM price_ticks WHERE ticker = ? AND src = 'sim'", ticker).n;
  if (have > 40) return;
  // never lay a synthetic walk over real quotes: the two sit at different levels
  const live = q.get("SELECT 1 FROM price_ticks WHERE ticker = ? AND src = 'live' LIMIT 1", ticker);
  if (live) return;
  const now = Date.now();
  const step = 5 * 60_000;
  const points = 24 * 12; // two days at five-minute resolution
  let price = BASE[ticker] ?? 100;
  const walk = [];
  for (let i = 0; i < points; i++) {
    price *= 1 + (Math.random() - 0.5) * 0.009;
    walk.push(price);
  }
  // rescale so the walk ends at the reference level, then write it oldest-first
  const k = (BASE[ticker] ?? 100) / walk[walk.length - 1];
  tx(() => {
    walk.forEach((p, i) => {
      const at = now - (points - i) * step;
      q.run("INSERT OR IGNORE INTO price_ticks(ticker, at, price, src) VALUES(?,?,?,'sim')", ticker, at, round(p * k));
    });
  });
}

// ── live quotes ──────────────────────────────────────────────────────────────

async function yahooQuote(ticker) {
  const sym = YAHOO_SYMBOL[ticker] ?? ticker;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=5m`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(4500),
    headers: { "user-agent": "Mozilla/5.0 (compatible; BooAIBoard/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const result = j?.chart?.result?.[0];
  const price = Number(result?.meta?.regularMarketPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error("no price in response");
  // Opportunistically store the intraday series that came with the quote.
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  if (stamps.length && stamps.length === closes.length) {
    tx(() => {
      q.run("DELETE FROM price_ticks WHERE ticker = ? AND src != 'live'", ticker);
      for (let i = 0; i < stamps.length; i++) {
        const c = Number(closes[i]);
        if (Number.isFinite(c) && c > 0) {
          q.run("INSERT OR REPLACE INTO price_ticks(ticker, at, price, src) VALUES(?,?,?,'live')", ticker, stamps[i] * 1000, round(c));
        }
      }
    });
  }
  return { price: round(price), source: "yahoo" };
}

/**
 * Store one tick, tagged with where it came from.
 *
 * Live quotes and simulated ones sit at different levels, so a series holding both draws a sawtooth
 * between them instead of a price. A ticker therefore keeps exactly one source at a time: the first
 * tick from a new source clears the other one's history for that ticker.
 */
function recordTick(ticker, price, src, at = Date.now()) {
  const current = q.get("SELECT src FROM price_ticks WHERE ticker = ? ORDER BY at DESC LIMIT 1", ticker);
  if (current && current.src !== src) {
    q.run("DELETE FROM price_ticks WHERE ticker = ? AND src != ?", ticker, src);
  }
  q.run(
    "INSERT OR REPLACE INTO price_ticks(ticker, at, price, src) VALUES(?,?,?,?)",
    ticker, Math.floor(at / 60_000) * 60_000, price, src,
  );
}

export async function getPrice(ticker) {
  ticker = String(ticker).toUpperCase();
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;

  let out;
  if (config.priceSource === "live") {
    try {
      out = await yahooQuote(ticker);
      lastSource = "yahoo";
    } catch {
      out = simulated(ticker);
      lastSource = "sim";
      seedSeries(ticker);
    }
  } else {
    out = simulated(ticker);
    seedSeries(ticker);
  }

  const entry = { ticker, ...out, at: Date.now() };
  cache.set(ticker, entry);
  recordTick(ticker, entry.price, out.source === "yahoo" ? "live" : "sim", entry.at);
  return entry;
}

/** Last known price without touching the network — for hot paths like grading and agent momentum. */
export function cachedPrice(ticker) {
  ticker = String(ticker).toUpperCase();
  const c = cache.get(ticker);
  if (c) return c.price;
  const row = q.get("SELECT price FROM price_ticks WHERE ticker = ? ORDER BY at DESC LIMIT 1", ticker);
  return row?.price ?? null;
}

/** Downsampled series for charts. `rangeMs` back from now, at most `points` rows. */
export function series(ticker, rangeMs = 86400e3, points = 180) {
  ticker = String(ticker).toUpperCase();
  const since = Date.now() - rangeMs;
  const rows = q.all("SELECT at, price FROM price_ticks WHERE ticker = ? AND at >= ? ORDER BY at", ticker, since);
  if (rows.length <= points) return rows;
  const step = rows.length / points;
  const out = [];
  for (let i = 0; i < points; i++) out.push(rows[Math.floor(i * step)]);
  out.push(rows[rows.length - 1]);
  return out;
}

/** Highest and lowest tick in a window — used to grade a call that touched its target early. */
export function extremes(ticker, fromIso, toMs = Date.now()) {
  const row = q.get(
    "SELECT MAX(price) AS hi, MIN(price) AS lo FROM price_ticks WHERE ticker = ? AND at BETWEEN ? AND ?",
    String(ticker).toUpperCase(), Date.parse(fromIso), toMs,
  );
  return { hi: row?.hi ?? null, lo: row?.lo ?? null };
}

/**
 * Trend read used by resident agents: fast mean vs slow mean over recent ticks.
 * Returns a signed strength roughly in [-1, 1] plus the raw means.
 */
export function momentum(ticker) {
  const rows = q.all("SELECT price FROM price_ticks WHERE ticker = ? ORDER BY at DESC LIMIT 120", String(ticker).toUpperCase());
  if (rows.length < 12) return { strength: 0, fast: null, slow: null, samples: rows.length };
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const fast = mean(rows.slice(0, Math.max(6, Math.floor(rows.length * 0.2))).map((r) => r.price));
  const slow = mean(rows.map((r) => r.price));
  const strength = Math.max(-1, Math.min(1, ((fast - slow) / slow) * 40));
  return { strength, fast: round(fast), slow: round(slow), samples: rows.length };
}

export function priceFeedStatus() {
  const row = q.get("SELECT MAX(at) AS at, COUNT(*) AS n FROM price_ticks");
  return {
    mode: config.priceSource,
    source: lastSource,
    ticks: row?.n ?? 0,
    updated_at: row?.at ? new Date(row.at).toISOString() : null,
    tickers: knownTickers().length,
  };
}

// ── poller ───────────────────────────────────────────────────────────────────

let pollIndex = 0;

async function pollTick() {
  // Rotate through the roster so a 20-ticker board stays inside Yahoo's comfort zone.
  const list = knownTickers();
  const batch = [list[pollIndex % list.length], list[(pollIndex + 1) % list.length], list[(pollIndex + 2) % list.length]];
  pollIndex += 3;
  for (const t of batch) {
    cache.delete(t);
    try { await getPrice(t); } catch {}
  }
  bus.emit("prices", { at: new Date().toISOString(), source: lastSource });
}

export function startPriceFeed() {
  // make sure every chart has something to draw immediately
  for (const t of knownTickers()) seedSeries(t);
  void pollTick();
  setInterval(() => void pollTick(), config.pricePollMs);
  // prune old ticks once an hour
  setInterval(() => {
    q.run("DELETE FROM price_ticks WHERE at < ?", Date.now() - TICK_RETENTION_MS);
  }, 3600e3);
}
