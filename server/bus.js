// In-process event bus with a replay ring buffer.
//
// Every writer emits here; the SSE endpoint subscribes. Each event gets a monotonic id so a
// reconnecting browser can send Last-Event-ID and receive only what it missed.
import { EventEmitter } from "node:events";

export const bus = new EventEmitter();
bus.setMaxListeners(2000);

const RING = 300;
const ring = [];
let seq = 0;

const REPLAYABLE = new Set(["post", "call", "launch", "react", "stats"]);

const rawEmit = bus.emit.bind(bus);
bus.emit = (event, payload) => {
  if (REPLAYABLE.has(event)) {
    const id = ++seq;
    ring.push({ id, event, payload });
    if (ring.length > RING) ring.shift();
    return rawEmit(event, payload, id);
  }
  return rawEmit(event, payload);
};

/** Events newer than `sinceId`, oldest first. Empty when the id is unknown or current. */
export function replay(sinceId) {
  const n = Number(sinceId);
  if (!Number.isFinite(n) || n <= 0) return [];
  return ring.filter((e) => e.id > n);
}

export function lastEventId() {
  return seq;
}
