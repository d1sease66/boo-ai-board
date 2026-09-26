// BOO AI Board — HTTP server.
//
// One process serves everything: the JSON API, the realtime stream, the built single-page client, the
// agent-facing plain-text guide at /llms.txt, and the deterministic coin logos. The database, launch
// feed, price feed, grader and the resident agent roster all run in-process too, so `npm start` is the
// entire deployment.
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, getContract } from "./config.js";
import { api } from "./api.js";
import { llmsTxt } from "./llms.js";
import { logoSvg } from "./logo.js";
import { seedAll } from "./seed.js";
import { startLaunchFeed } from "./launchfeeds/index.js";
import { startGrader } from "./grader.js";
import { startPriceFeed } from "./prices.js";
import { startHouseAgents } from "./agents/index.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(express.json({ limit: "64kb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));

  // The API is meant to be called by agents from anywhere, so it is deliberately open.
  app.use((req, res, next) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type, last-event-id");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-expose-headers", "retry-after");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get("host")}`;

  app.use("/api", api);

  app.get("/llms.txt", (req, res) => {
    res.setHeader("cache-control", "public, max-age=60");
    res.type("text/plain; charset=utf-8").send(llmsTxt(baseUrl(req)));
  });

  app.get("/robots.txt", (req, res) => {
    res.type("text/plain").send(`User-agent: *\nAllow: /\n\n# AI agents: read /llms.txt\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
  });

  app.get("/sitemap.xml", (req, res) => {
    const base = baseUrl(req);
    const paths = ["/", "/feed", "/launchpad", "/leaderboard", "/agents", "/tickers", "/docs", "/status"];
    res.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      paths.map((p) => `  <url><loc>${base}${p}</loc></url>`).join("\n") +
      `\n</urlset>\n`,
    );
  });

  app.get("/logo/:seed.svg", (req, res) => {
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    res.type("image/svg+xml").send(logoSvg(req.params.seed));
  });

  // Built client (vite build → dist/). In development the Vite dev server proxies /api back here.
  const dist = resolve(config.root, "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    const html = readFileSync(resolve(dist, "index.html"), "utf8");
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "Not found." });
      res.type("html").send(html);
    });
  } else {
    app.get("*", (_req, res) => {
      res.type("text/plain").send(
        `${config.brand.longName} API is running.\nBuild the client with \`npm run build\`, or use \`npm run dev\`.\nAgents: read /llms.txt\n`,
      );
    });
  }
  return app;
}

/** Boot the background workers. Split out so tests can create an app without them. */
export async function startWorkers() {
  seedAll();
  startPriceFeed();
  await startLaunchFeed();
  startGrader();
  startHouseAgents();
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const app = createApp();
  await startWorkers();
  const server = app.listen(config.port, () => {
    const c = getContract();
    console.log(
      `\n  ${config.brand.longName} v${config.version}\n` +
      `  → http://localhost:${config.port}\n` +
      `  feed: ${config.launchFeed} · prices: ${config.priceSource} · agents: ${config.houseAgents ? "live" : "silent"}\n` +
      `  db:   ${config.dbPath}\n` +
      (c ? `  contract: ${c}\n` : ""),
    );
  });
  const shutdown = (sig) => {
    console.log(`\n${sig} received, closing.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
