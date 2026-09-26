// Grading. A call is a public promise with a deadline, and BOO settles all of them the same way.
//
// Two ways a call resolves:
//   • touched  – the target was reached while the call was open. Graded a hit immediately, which is
//                what actually happened, and lands on the feed live instead of hours later.
//   • deadline – the clock ran out. Hit if the last price is at or beyond the target, otherwise missed.
// Peak and trough over the open window are stored either way, so a near miss is visible as a near miss.
import { q } from "./db.js";
import { getPrice, extremes, cachedPrice } from "./prices.js";
import { bus } from "./bus.js";
import { callRow } from "./posts.js";

const TICK_MS = 30_000;

function resolve(call, price, { early }) {
  const { hi, lo } = extremes(call.ticker, call.created_at);
  const status = call.direction === "long" ? (price >= call.target_price ? "hit" : "missed") : (price <= call.target_price ? "hit" : "missed");
  q.run(
    "UPDATE calls SET status = ?, resolved_price = ?, resolved_at = ?, resolved_early = ?, peak_price = ?, trough_price = ? WHERE id = ?",
    status, price, new Date().toISOString(), early ? 1 : 0, hi, lo, call.id,
  );
  const row = q.get("SELECT * FROM calls WHERE id = ?", call.id);
  bus.emit("call", callRow(row));
  bus.emit("stats");
  bus.emit("call:resolved", row);
  return row;
}

/** Grade everything that is due, and settle early anything that already reached its target. */
export async function gradeDueCalls() {
  const nowIso = new Date().toISOString();
  const due = q.all("SELECT * FROM calls WHERE status = 'open' AND deadline <= ? LIMIT 50", nowIso);
  for (const c of due) {
    try {
      const { price } = await getPrice(c.ticker);
      resolve(c, price, { early: false });
    } catch (e) {
      console.warn("[grader] deadline grading failed on", c.ticker, e.message);
    }
  }

  // Early settlement: the target was touched at some point while the call was open.
  const open = q.all("SELECT * FROM calls WHERE status = 'open' LIMIT 400");
  for (const c of open) {
    const { hi, lo } = extremes(c.ticker, c.created_at);
    if (hi == null || lo == null) continue;
    const touched = c.direction === "long" ? hi >= c.target_price : lo <= c.target_price;
    if (!touched) continue;
    // settle at the target itself: that is the price at which the promise came true
    resolve(c, c.target_price, { early: true });
  }
}

/** Live unrealised progress on an open call, for the countdown card. */
export function callProgress(call) {
  const price = cachedPrice(call.ticker);
  if (price == null) return null;
  const span = call.target_price - call.entry_price;
  if (!span) return null;
  return Math.max(-1, Math.min(1.5, (price - call.entry_price) / span));
}

export function startGrader() {
  void gradeDueCalls();
  setInterval(() => void gradeDueCalls(), TICK_MS);
}
