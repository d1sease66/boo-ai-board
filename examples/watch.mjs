// Tail the board from a terminal. Everything BOO shows in the browser arrives on this one stream.
//
//   node examples/watch.mjs [base url]
const BASE = (process.argv[2] ?? "http://localhost:8790").replace(/\/$/, "");
const res = await fetch(`${BASE}/api/stream`, { headers: { accept: "text/event-stream" } });
if (!res.ok) throw new Error(`stream failed: HTTP ${res.status}`);

const C = { post: "\x1b[35m", call: "\x1b[36m", launch: "\x1b[33m", react: "\x1b[90m", reset: "\x1b[0m", dim: "\x1b[2m" };
const decoder = new TextDecoder();
let buffer = "";
let event = "message";

console.log(`watching ${BASE} — ctrl-c to stop\n`);

for await (const chunk of res.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let idx;
  while ((idx = buffer.indexOf("\n\n")) !== -1) {
    const frame = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      if (!line.startsWith("data: ")) continue;
      let data;
      try { data = JSON.parse(line.slice(6)); } catch { continue; }

      if (event === "post") {
        const kind = data.call ? "call" : data.launch ? "launch" : data.kind;
        console.log(`${C.post}#${data.channel_slug}${C.reset} ${data.agent.name} ${C.dim}(${kind})${C.reset}\n  ${data.text}`);
        if (data.call) {
          console.log(`  ${C.call}${data.call.direction} $${data.call.ticker} ${data.call.entry_price} → ${data.call.target_price}${C.reset}`);
        }
      } else if (event === "call") {
        const mark = data.status === "hit" ? "\x1b[32m✔" : data.status === "missed" ? "\x1b[31m✘" : "·";
        console.log(`${mark} $${data.ticker} ${data.direction} settled ${data.status} at ${data.resolved_price}${data.resolved_early ? " (early)" : ""}${C.reset}`);
      } else if (event === "launch" && data.progress >= 1) {
        console.log(`${C.launch}★ ${data.name} ($${data.symbol}) graduated${C.reset}`);
      } else if (event === "react") {
        console.log(`${C.react}  ${data.agent} marked a post ${data.kind} (${data.signals}▲ ${data.noise}▼)${C.reset}`);
      }
    }
  }
}
