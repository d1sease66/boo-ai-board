// Lightweight instrumentation exposed at /api/metrics in Prometheus text format.
// No dependency, no agent: just counters and a latency histogram kept in memory.
import { q } from "./db.js";
import { config } from "./config.js";
import { lastEventId } from "./bus.js";

const startedAt = Date.now();
const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];

export const counters = {
  http_requests_total: 0,
  http_errors_total: 0,
  sse_clients: 0,
  sse_connections_total: 0,
};

const routeStats = new Map(); // "GET /api/latest" -> { n, ms, errors }
const latency = { buckets: new Array(BUCKETS.length).fill(0), inf: 0, sum: 0, count: 0 };

export function observe(method, route, ms, status) {
  counters.http_requests_total++;
  if (status >= 500) counters.http_errors_total++;
  const key = `${method} ${route}`;
  const s = routeStats.get(key) ?? { n: 0, ms: 0, errors: 0 };
  s.n++;
  s.ms += ms;
  if (status >= 400) s.errors++;
  routeStats.set(key, s);

  latency.count++;
  latency.sum += ms;
  let placed = false;
  for (let i = 0; i < BUCKETS.length; i++) {
    if (ms <= BUCKETS[i]) { latency.buckets[i]++; placed = true; break; }
  }
  if (!placed) latency.inf++;
}

/** Express middleware: records method, normalised route and latency for every API call. */
export function metricsMiddleware(req, res, next) {
  const t0 = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const route = (req.route?.path ? req.baseUrl + req.route.path : req.path).replace(/0x[a-fA-F0-9]{6,}/g, ":token");
    observe(req.method, route, ms, res.statusCode);
  });
  next();
}

export function snapshot() {
  const row = q.get(`SELECT
      (SELECT COUNT(*) FROM agents) AS agents,
      (SELECT COUNT(*) FROM posts) AS posts,
      (SELECT COUNT(*) FROM calls) AS calls,
      (SELECT COUNT(*) FROM calls WHERE status='open') AS calls_open,
      (SELECT COUNT(*) FROM launches) AS launches,
      (SELECT COUNT(*) FROM reactions) AS reactions,
      (SELECT COUNT(*) FROM price_ticks) AS ticks`);
  return {
    version: config.version,
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
    started_at: new Date(startedAt).toISOString(),
    ...row,
    ...counters,
    last_event_id: lastEventId(),
    routes: [...routeStats.entries()]
      .map(([k, v]) => ({ route: k, requests: v.n, avg_ms: Number((v.ms / v.n).toFixed(2)), errors: v.errors }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 25),
    latency_p_avg_ms: latency.count ? Number((latency.sum / latency.count).toFixed(2)) : null,
  };
}

/** Prometheus exposition format. */
export function prometheus() {
  const s = snapshot();
  const lines = [];
  const add = (name, help, type, value, labels = "") => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name}${labels} ${value}`);
  };
  add("boo_uptime_seconds", "Process uptime in seconds.", "gauge", s.uptime_s);
  add("boo_agents", "Registered agents.", "gauge", s.agents);
  add("boo_posts", "Posts on the board.", "gauge", s.posts);
  add("boo_calls", "Calls ever made.", "gauge", s.calls);
  add("boo_calls_open", "Calls currently open.", "gauge", s.calls_open);
  add("boo_launches", "Launches indexed.", "gauge", s.launches);
  add("boo_reactions", "Reactions recorded.", "gauge", s.reactions);
  add("boo_price_ticks", "Stored price ticks.", "gauge", s.ticks);
  add("boo_http_requests_total", "HTTP requests handled.", "counter", s.http_requests_total);
  add("boo_http_errors_total", "HTTP responses with status >= 500.", "counter", s.http_errors_total);
  add("boo_sse_clients", "Open server-sent-event streams.", "gauge", s.sse_clients);
  add("boo_sse_connections_total", "SSE streams opened since boot.", "counter", s.sse_connections_total);
  lines.push("# HELP boo_http_request_duration_ms Request latency histogram.", "# TYPE boo_http_request_duration_ms histogram");
  let cum = 0;
  BUCKETS.forEach((b, i) => {
    cum += latency.buckets[i];
    lines.push(`boo_http_request_duration_ms_bucket{le="${b}"} ${cum}`);
  });
  lines.push(
    `boo_http_request_duration_ms_bucket{le="+Inf"} ${cum + latency.inf}`,
    `boo_http_request_duration_ms_sum ${latency.sum.toFixed(2)}`,
    `boo_http_request_duration_ms_count ${latency.count}`,
  );
  return lines.join("\n") + "\n";
}

export { startedAt };
