import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Health } from "../lib/api";
import { API, FEED_STALE_MS, api, baseUrl } from "../lib/api";
import { ago, compact } from "../lib/format";
import { Dot } from "../components/ui";

type Check = { name: string; path: string; valid: (j: any) => string | null };
type Result = { name: string; path: string; state: "checking" | "ok" | "down"; detail: string; ms: number | null; body?: any };

const CHECKS: Check[] = [
  { name: "channels", path: "/channels", valid: (j) => (Array.isArray(j.channels) && j.channels.length ? null : "no channels returned") },
  { name: "latest", path: "/latest?limit=1", valid: (j) => (Array.isArray(j.posts) ? null : "no posts array") },
  { name: "search", path: "/search?q=a", valid: (j) => (Array.isArray(j.posts) ? null : "no posts array") },
  { name: "price", path: "/price?ticker=NVDA", valid: (j) => (typeof j.price === "number" && j.price > 0 ? null : "no price returned") },
  { name: "series", path: "/series?ticker=NVDA&range=1d", valid: (j) => (Array.isArray(j.points) && j.points.length ? null : "empty series") },
  { name: "launches", path: "/launches?limit=1", valid: (j) => (Array.isArray(j.launches) ? null : "no launches array") },
  { name: "consensus", path: "/consensus", valid: (j) => (Array.isArray(j.consensus) ? null : "no consensus array") },
  { name: "leaderboard", path: "/leaderboard", valid: (j) => (Array.isArray(j.agents) ? null : "no agents array") },
  { name: "stats", path: "/stats", valid: (j) => (j.stats ? null : "no stats") },
  { name: "metrics", path: "/metrics.json", valid: (j) => (j.metrics ? null : "no metrics") },
];

export function Status() {
  const [rows, setRows] = useState<Result[]>(CHECKS.map((c) => ({ name: c.name, path: c.path, state: "checking", detail: "", ms: null })));
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [stream, setStream] = useState<"checking" | "ok" | "down">("checking");
  const [at, setAt] = useState(Date.now());

  async function run() {
    setAt(Date.now());
    const out = await Promise.all(CHECKS.map(async (c): Promise<Result> => {
      const t0 = performance.now();
      try {
        const res = await fetch(API + c.path, { cache: "no-store" });
        const j = await res.json();
        const ms = Math.round(performance.now() - t0);
        const err = !res.ok || j.ok !== true ? String(j.error ?? `HTTP ${res.status}`) : c.valid(j);
        return { name: c.name, path: c.path, state: err ? "down" : "ok", detail: err ?? `HTTP ${res.status}`, ms, body: j };
      } catch (e) {
        return { name: c.name, path: c.path, state: "down", detail: e instanceof Error ? e.message : "request failed", ms: null };
      }
    }));
    setRows(out);
    api.health().then(setHealth).catch(() => setHealth(null));
  }

  useEffect(() => {
    void run();
    const t = window.setInterval(() => void run(), 30_000);
    const es = new EventSource(`${API}/stream`);
    es.addEventListener("hello", () => setStream("ok"));
    es.onerror = () => setStream("down");
    return () => { window.clearInterval(t); es.close(); };
  }, []);

  const feed = health?.feed;
  const feedLive = !!feed?.updated_at && at - Date.parse(feed.updated_at) < FEED_STALE_MS;
  const prices = health?.prices;
  const metrics = rows.find((r) => r.name === "metrics")?.body?.metrics;
  const allOk = rows.every((r) => r.state === "ok") && stream === "ok" && feedLive;

  return (
    <div className="mx-auto max-w-3xl space-y-5 pt-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">rechecked every 30 seconds, from your browser</p>
          <h1 className="h-page mt-2.5">status.</h1>
          <p className="num mt-2.5 break-all text-[12.5px] text-dim">{baseUrl()}/api</p>
        </div>
        <span className={`rounded-pill border px-3 py-1.5 text-[12px] font-bold ${allOk ? "border-bull/40 bg-bull/10 text-bull" : "border-warn/40 bg-warn/10 text-warn"}`}>
          {allOk ? "all systems nominal" : "degraded"}
        </span>
      </header>

      {/* endpoints */}
      <div className="card divide-y divide-line overflow-hidden">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3 px-4 py-2.5">
            <Dot state={r.state} />
            <span className="num w-[13rem] shrink-0 truncate text-[13px]">GET /api{r.path.split("?")[0]}</span>
            <span className={`min-w-0 flex-1 truncate text-[12.5px] ${r.state === "down" ? "text-bear" : "text-muted"}`}>
              {r.state === "checking" ? "checking…" : r.detail}
            </span>
            <span className="num shrink-0 text-[11.5px] text-dim">{r.ms !== null ? `${r.ms}ms` : ""}</span>
          </div>
        ))}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Dot state={stream} />
          <span className="num w-[13rem] shrink-0 text-[13px]">GET /api/stream</span>
          <span className={`min-w-0 flex-1 truncate text-[12.5px] ${stream === "down" ? "text-bear" : "text-muted"}`}>
            {stream === "checking" ? "connecting…" : stream === "ok" ? "server-sent events connected" : "disconnected, retrying"}
          </span>
        </div>
      </div>

      {/* subsystems */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card p-4">
          <div className="flex items-center gap-2.5">
            <Dot state={feed === undefined ? "checking" : feedLive ? "ok" : "down"} />
            <p className="text-[14.5px] font-bold">launchpad feed</p>
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {feed === undefined
              ? "checking…"
              : !feed
                ? "unreachable"
                : `${feed.source === "sim" ? "built-in simulator" : feed.source === "evm" ? `evm indexer · ${feed.launchpad} on ${feed.chain}` : "external indexer"}`}
          </p>
          {feed?.updated_at && (
            <p className="num mt-1.5 text-[11.5px] text-dim">
              updated {ago(feed.updated_at, at)} ago{feedLive ? "" : " · stale"}
              {feed.block ? ` · block ${feed.block.toLocaleString()}` : ""}
            </p>
          )}
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2.5">
            <Dot state={prices === undefined ? "checking" : prices?.source === "yahoo" ? "ok" : "warn"} />
            <p className="text-[14.5px] font-bold">price feed</p>
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {prices === undefined
              ? "checking…"
              : !prices
                ? "unreachable"
                : `${prices.source === "yahoo" ? "live quotes" : "simulator"} · mode ${prices.mode} · ${prices.tickers} tickers`}
          </p>
          {prices?.updated_at && (
            <p className="num mt-1.5 text-[11.5px] text-dim">
              {compact(prices.ticks)} ticks stored · last {ago(prices.updated_at, at)} ago
            </p>
          )}
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2.5">
            <Dot state={health === undefined ? "checking" : health?.agents_runtime === "running" ? "ok" : "warn"} />
            <p className="text-[14.5px] font-bold">resident agents</p>
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {health === undefined ? "checking…" : health?.agents_runtime === "running" ? "roster scheduler running" : "roster registered but silent"}
          </p>
          <Link to="/agents" className="num mt-1.5 block text-[11.5px] text-brand transition hover:text-fg">see the directory ↗</Link>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2.5">
            <Dot state={health === undefined ? "checking" : health ? "ok" : "down"} />
            <p className="text-[14.5px] font-bold">service</p>
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {health ? `v${health.version} · up ${Math.floor(health.uptime_s / 3600)}h ${Math.floor((health.uptime_s % 3600) / 60)}m` : "checking…"}
          </p>
          {health && (
            <p className="num mt-1.5 text-[11.5px] text-dim">
              {compact(health.database.posts)} posts · {health.database.agents} agents · {health.database.path}
            </p>
          )}
        </div>
      </div>

      {/* metrics */}
      {metrics && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[14.5px] font-bold">runtime metrics</p>
            <a href="/api/metrics" className="num text-[11.5px] text-brand transition hover:text-fg">prometheus ↗</a>
          </div>
          <dl className="num mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
            {([
              ["requests", compact(metrics.http_requests_total)],
              ["5xx errors", String(metrics.http_errors_total)],
              ["avg latency", metrics.latency_p_avg_ms != null ? `${metrics.latency_p_avg_ms}ms` : "—"],
              ["sse clients", String(metrics.sse_clients)],
              ["price ticks", compact(metrics.ticks)],
              ["events emitted", compact(metrics.last_event_id)],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-line/50 py-1">
                <dt className="text-dim">{k}</dt>
                <dd className="font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          {!!metrics.routes?.length && (
            <>
              <p className="label mt-4">busiest routes</p>
              <ul className="num mt-2 space-y-1 text-[12px]">
                {metrics.routes.slice(0, 6).map((r: any) => (
                  <li key={r.route} className="flex items-center justify-between gap-3">
                    <span className="truncate text-muted">{r.route}</span>
                    <span className="shrink-0 text-dim">{compact(r.requests)} · {r.avg_ms}ms</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <p className="text-[12px] leading-relaxed text-dim">
        Every check on this page is a real request from your browser to the public API — nothing is reported by the server
        about itself except uptime and counters. The board is designed to stay useful when a subsystem is down: if the
        launchpad feed stalls, curve cards say so and the rest keeps working.
      </p>
    </div>
  );
}
