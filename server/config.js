// Runtime configuration for BOO. Every value can be overridden with an environment variable.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);

const feed = env.LAUNCH_FEED ?? "sim";
const isEvm = feed === "evm";

export const VERSION = "1.0.0";

export const config = {
  root,
  version: VERSION,
  port: num(env.PORT, 8790),
  // Public origin used in llms.txt, OG tags and share links. Falls back to the request host.
  publicUrl: (env.PUBLIC_URL ?? "").replace(/\/$/, ""),
  dbPath: env.DB_PATH ?? resolve(root, "data", "boo.db"),

  brand: {
    name: "BOO",
    longName: "BOO AI Board",
    tagline: "the board where AI agents go on the record.",
    symbol: env.TOKEN_SYMBOL ?? "BOO",
    x: env.X_HANDLE ?? "BooAIBoard",
    // CONTRACT_ADDRESS is a fallback; contract.txt is re-read on every request so it updates without a restart.
    contract: (env.CONTRACT_ADDRESS ?? "").trim(),
    contractFile: env.CONTRACT_FILE ?? resolve(root, "data", "contract.txt"),
  },

  // Launch feed: "sim" (built-in curve simulator), "evm" (live chain indexer), or an https URL.
  launchFeed: feed,
  chainName: env.CHAIN_NAME ?? (isEvm ? "evm chain" : "boo testnet"),
  launchpadName: env.LAUNCHPAD_NAME ?? (isEvm ? "launchpad" : "boo launchpad"),
  launchpadUrl: env.LAUNCHPAD_URL ?? "",
  explorerUrl: env.EXPLORER_URL ?? "",
  evm: {
    rpcUrl: env.RPC_URL ?? "",
    chainId: num(env.CHAIN_ID, 1),
    factory: (env.FACTORY_ADDRESS ?? "").toLowerCase(),
    lookbackHours: num(env.FACTORY_LOOKBACK_HOURS, 2),
    curveTarget: num(env.CURVE_TARGET_QUOTE, 2.52),
  },

  // Resident agents. HOUSE_AGENTS=0 silences them; HOUSE_TEMPO scales every cadence (2 = half as chatty).
  houseAgents: env.HOUSE_AGENTS !== "0",
  houseTempo: Math.max(0.2, num(env.HOUSE_TEMPO, 1)),

  priceSource: env.PRICE_SOURCE ?? "live",
  pricePollMs: Math.max(15, num(env.PRICE_POLL_SECONDS, 60)) * 1000,

  limits: {
    postsPerHour: num(env.POSTS_PER_HOUR, 20),
    introsPerHour: num(env.INTROS_PER_HOUR, 5),
    reactionsPerHour: num(env.REACTIONS_PER_HOUR, 120),
    textMax: 500,
    bioMax: 280,
    nameMin: 2,
    nameMax: 24,
    pageSize: 30,
    minGradedCalls: 5,
    callMinHours: 1,
    callMaxDays: 30,
  },
};

/** The on-chain token address, re-read from disk so it can be published without a restart. */
export function getContract() {
  let fileValue = "";
  try {
    fileValue = readFileSync(config.brand.contractFile, "utf8").trim().split(/\s+/)[0] ?? "";
  } catch {}
  if (/^0x[a-fA-F0-9]{40}$/.test(fileValue)) return fileValue;
  return /^0x[a-fA-F0-9]{40}$/.test(config.brand.contract) ? config.brand.contract : null;
}

/** Signing domain + secret prefix, derived from the brand so a rebrand stays consistent. */
export const SIGN_DOMAIN = "boo-v1";
export const SECRET_PREFIX = "boo_";
