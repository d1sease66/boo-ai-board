// Live EVM indexer for pump-style launchpads.
//
// This is deliberately generic: point FACTORY_ADDRESS at a factory that emits a "token created" event
// and BOO will index it. The indexer discovers tokens from factory logs, reads ERC-20 metadata through
// Multicall3, tracks the quote reserve held by each bonding curve, and derives curve progress from
// reserve / CURVE_TARGET_QUOTE. Buys and sells are counted from Transfer flow against the curve, which
// works without knowing the launchpad's bespoke event names.
//
// Nothing here is required for BOO to run: LAUNCH_FEED=sim is the default and needs no chain at all.
import { createPublicClient, http, parseAbi, parseAbiItem, formatUnits, getAddress } from "viem";
import { q } from "../db.js";
import { config } from "../config.js";
import { bus } from "../bus.js";
import { upsertLaunch, getLaunch, markFeedUpdated, newLaunchId, decayedHeat } from "./index.js";

const POLL_MS = 4000;
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

// Candidate factory events. The first one that decodes wins; add yours here if it differs.
const FACTORY_EVENTS = [
  parseAbiItem("event TokenCreated(address indexed token, address indexed curve, address indexed creator)"),
  parseAbiItem("event Launch(address indexed token, address indexed curve, address indexed creator)"),
  parseAbiItem("event NewToken(address indexed token, address indexed pool, address indexed deployer)"),
  parseAbiItem("event Created(address indexed token, address indexed curve)"),
];

const ERC20 = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);
// Reserve getters seen across pump-style curves; tried in order.
const CURVE = parseAbi([
  "function realQuoteReserve() view returns (uint256)",
  "function reserveQuote() view returns (uint256)",
  "function quoteReserve() view returns (uint256)",
]);

const iso = (ms = Date.now()) => new Date(ms).toISOString();
let client = null;
let cursor = 0n;
let failures = 0;

function makeClient() {
  if (!config.evm.rpcUrl) throw new Error("RPC_URL is required when LAUNCH_FEED=evm");
  if (!/^0x[a-fA-F0-9]{40}$/.test(config.evm.factory)) throw new Error("FACTORY_ADDRESS is required when LAUNCH_FEED=evm");
  return createPublicClient({
    transport: http(config.evm.rpcUrl, { batch: true, timeout: 12_000, retryCount: 2 }),
    batch: { multicall: { batchSize: 512, wait: 30 } },
  });
}

/** Pull factory logs for a block range and register anything new. */
async function discover(fromBlock, toBlock) {
  const found = new Map(); // token -> { curve, creator, block }
  for (const event of FACTORY_EVENTS) {
    let logs = [];
    try {
      logs = await client.getLogs({ address: getAddress(config.evm.factory), event, fromBlock, toBlock });
    } catch {
      continue; // this chain/factory doesn't have that event signature
    }
    for (const log of logs) {
      const a = log.args ?? {};
      const token = a.token ?? a.newToken ?? null;
      if (!token) continue;
      found.set(String(token).toLowerCase(), {
        curve: (a.curve ?? a.pool ?? null) && String(a.curve ?? a.pool).toLowerCase(),
        creator: (a.creator ?? a.deployer ?? null) && String(a.creator ?? a.deployer).toLowerCase(),
        block: Number(log.blockNumber),
      });
    }
    if (found.size) break;
  }
  return found;
}

/** Read name/symbol/decimals for freshly discovered tokens in one multicall round. */
async function readMetadata(tokens) {
  if (!tokens.length) return new Map();
  const calls = tokens.flatMap((t) => [
    { address: getAddress(t), abi: ERC20, functionName: "name" },
    { address: getAddress(t), abi: ERC20, functionName: "symbol" },
  ]);
  let results = [];
  try {
    results = await client.multicall({ contracts: calls, multicallAddress: MULTICALL3, allowFailure: true });
  } catch {
    return new Map();
  }
  const out = new Map();
  tokens.forEach((t, i) => {
    const name = results[i * 2]?.status === "success" ? String(results[i * 2].result).slice(0, 60) : null;
    const symbol = results[i * 2 + 1]?.status === "success" ? String(results[i * 2 + 1].result).slice(0, 16) : null;
    if (name || symbol) out.set(t, { name: name ?? symbol ?? "unknown", symbol: symbol ?? "?" });
  });
  return out;
}

/** Quote reserve currently sitting in each curve, in whole units. */
async function readReserves(rows) {
  const tracked = rows.filter((r) => r.curve_address);
  if (!tracked.length) return new Map();
  const out = new Map();
  for (const fn of ["realQuoteReserve", "reserveQuote", "quoteReserve"]) {
    const pending = tracked.filter((r) => !out.has(r.token_address));
    if (!pending.length) break;
    let results = [];
    try {
      results = await client.multicall({
        contracts: pending.map((r) => ({ address: getAddress(r.curve_address), abi: CURVE, functionName: fn })),
        multicallAddress: MULTICALL3,
        allowFailure: true,
      });
    } catch {
      continue;
    }
    pending.forEach((r, i) => {
      if (results[i]?.status === "success") {
        out.set(r.token_address, Number(formatUnits(results[i].result, r.pair_decimals ?? 18)));
      }
    });
  }
  return out;
}

/** Count buys and sells from Transfer flow against the curve address. */
async function readFlow(rows, fromBlock, toBlock) {
  const flow = new Map();
  for (const r of rows) {
    if (!r.curve_address) continue;
    try {
      const logs = await client.getLogs({ address: getAddress(r.token_address), event: TRANSFER, fromBlock, toBlock });
      let buys = 0, sells = 0;
      const buyers = new Set();
      for (const log of logs) {
        const from = String(log.args.from).toLowerCase();
        const to = String(log.args.to).toLowerCase();
        if (from === r.curve_address) { buys++; buyers.add(to); }
        else if (to === r.curve_address) sells++;
      }
      if (buys || sells) flow.set(r.token_address, { buys, sells, buyers: buyers.size });
    } catch {
      /* a node that rejects per-token getLogs just means no flow detail this round */
    }
  }
  return flow;
}

async function tick() {
  const head = await client.getBlockNumber();
  if (!cursor) cursor = head - BigInt(Math.max(1, Math.round(config.evm.lookbackHours * 1800)));
  if (head <= cursor) return;
  const from = cursor + 1n;
  const to = head;

  // 1. discover
  const found = await discover(from, to);
  const brandNew = [...found.keys()].filter((t) => !getLaunch(t));
  const meta = await readMetadata(brandNew);
  for (const token of brandNew) {
    const info = found.get(token);
    const m = meta.get(token);
    const created = upsertLaunch({
      id: newLaunchId(),
      token_address: token,
      name: m?.name ?? "indexing…",
      symbol: m?.symbol ?? "?",
      logo_url: null,
      pair_symbol: "ETH",
      threshold: config.evm.curveTarget,
      launched_at: iso(),
      last_trade_at: iso(),
      curve_address: info?.curve ?? null,
      deployer: info?.creator ?? null,
      block: info?.block ?? Number(to),
      meta_pending: m ? 0 : 1,
      source: "evm",
    });
    if (!created.meta_pending) bus.emit("launch:new", created);
  }

  // 2. refresh state for curves still filling
  const rows = q.all(
    "SELECT * FROM launches WHERE source = 'evm' AND phase = 'curve' ORDER BY COALESCE(last_trade_at, launched_at) DESC LIMIT 120",
  );
  const reserves = await readReserves(rows);
  const flow = await readFlow(rows.slice(0, 25), from, to);

  for (const r of rows) {
    const reserve = reserves.get(r.token_address);
    const f = flow.get(r.token_address);
    if (reserve == null && !f) continue;
    const quote = reserve ?? r.quote_net;
    const progress = Math.max(0, Math.min(1, quote / r.threshold));
    const graduated = progress >= 1;
    const delta = Math.max(0, quote - r.quote_net);
    const now = Date.now();
    const updated = upsertLaunch({
      ...r,
      quote_net: quote,
      progress,
      phase: graduated ? "graduated" : "curve",
      graduated_at: graduated ? (r.graduated_at ?? iso(now)) : r.graduated_at,
      buys: r.buys + (f?.buys ?? 0),
      sells: r.sells + (f?.sells ?? 0),
      buyers_seen: r.buyers_seen + (f?.buyers ?? 0),
      volume: r.volume + delta,
      heat: decayedHeat(r.heat, r.heat_at, now) + delta / r.threshold,
      heat_at: delta > 0 ? iso(now) : r.heat_at,
      last_trade_at: delta > 0 || f ? iso(now) : r.last_trade_at,
      block: Number(to),
      source: "evm",
    });
    if (graduated && r.phase === "curve") bus.emit("launch:graduated", updated);
  }

  // 3. late metadata for tokens whose name/symbol were not readable yet
  const pending = q.all("SELECT token_address FROM launches WHERE source = 'evm' AND meta_pending = 1 LIMIT 20").map((r) => r.token_address);
  if (pending.length) {
    const late = await readMetadata(pending);
    for (const [token, m] of late) {
      const row = getLaunch(token);
      if (row) {
        const updated = upsertLaunch({ ...row, name: m.name, symbol: m.symbol, meta_pending: 0, source: "evm" });
        bus.emit("launch:new", updated);
      }
    }
  }

  cursor = to;
  markFeedUpdated(Number(to));
  failures = 0;
}

export function startEvm() {
  try {
    client = makeClient();
  } catch (e) {
    console.error("[launches] evm indexer disabled:", e.message, "— falling back to no feed. Set LAUNCH_FEED=sim for the simulator.");
    return;
  }
  const loop = async () => {
    try {
      await tick();
    } catch (e) {
      failures++;
      if (failures % 5 === 1) console.warn("[launches] evm tick failed:", e.shortMessage ?? e.message);
    }
  };
  void loop();
  setInterval(loop, POLL_MS);
  console.log(`[launches] evm indexer on ${config.evm.rpcUrl} factory ${config.evm.factory}`);
}
