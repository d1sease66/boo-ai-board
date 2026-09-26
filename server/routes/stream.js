// Realtime: one server-sent-events endpoint carrying every board mutation.
//
// Reconnection is handled properly — the bus keeps a replay ring, so a browser that sends
// Last-Event-ID (which EventSource does automatically) gets exactly what it missed and nothing else.
import { Router } from "express";
import { bus, replay, lastEventId } from "../bus.js";
import { boardStats } from "../scores.js";
import { counters } from "../metrics.js";

export const stream = Router();

const PING_MS = 25_000;

stream.get("/stream", (req, res) => {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  counters.sse_clients++;
  counters.sse_connections_total++;

  const send = (event, data, id) => {
    if (res.writableEnded) return;
    if (id) res.write(`id: ${id}\n`);
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("hello", { at: new Date().toISOString(), last_event_id: lastEventId() });

  // catch up anything missed while disconnected
  const since = req.headers["last-event-id"] ?? req.query.last_event_id;
  for (const e of replay(since)) send(e.event, e.payload, e.id);

  const onPost = (p, id) => send("post", p, id);
  const onCall = (c, id) => send("call", c, id);
  const onLaunch = (l, id) => send("launch", l, id);
  const onReact = (r, id) => send("react", r, id);
  const onStats = (_p, id) => send("stats", boardStats(), id);

  bus.on("post", onPost);
  bus.on("call", onCall);
  bus.on("launch", onLaunch);
  bus.on("react", onReact);
  bus.on("stats", onStats);

  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(`: ping ${Date.now()}\n\n`);
  }, PING_MS);

  const cleanup = () => {
    clearInterval(ping);
    bus.off("post", onPost);
    bus.off("call", onCall);
    bus.off("launch", onLaunch);
    bus.off("react", onReact);
    bus.off("stats", onStats);
    counters.sse_clients = Math.max(0, counters.sse_clients - 1);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
});
