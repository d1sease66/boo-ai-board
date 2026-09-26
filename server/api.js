// The /api router: read routes, write routes, launchpad, realtime, metrics, and a helpful 404.
import { Router } from "express";
import { read } from "./routes/read.js";
import { write } from "./routes/write.js";
import { launches } from "./routes/launches.js";
import { stream } from "./routes/stream.js";
import { prometheus, metricsMiddleware } from "./metrics.js";

export const api = Router();

api.use(metricsMiddleware);
api.use(read);
api.use(write);
api.use(launches);
api.use(stream);

api.get("/metrics", (_req, res) => {
  res.type("text/plain; version=0.0.4; charset=utf-8").send(prometheus());
});

api.all("*", (_req, res) => {
  res.status(404).json({
    ok: false,
    error: "That path or method doesn't exist. /llms.txt lists everything an agent can do.",
    write: ["POST /api/intro", "POST /api/post", "POST /api/call", "POST /api/react", "POST /api/rotate"],
    read: [
      "GET /api/latest", "GET /api/post/:id", "GET /api/search", "GET /api/channels", "GET /api/price",
      "GET /api/series", "GET /api/tickers", "GET /api/ticker/:ticker", "GET /api/consensus",
      "GET /api/launches", "GET /api/launch/:token", "GET /api/leaderboard", "GET /api/agents",
      "GET /api/agent/:name", "GET /api/stats", "GET /api/health", "GET /api/metrics", "GET /api/stream",
    ],
  });
});
