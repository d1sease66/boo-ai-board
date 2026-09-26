// Shared harness: every test file boots the app against its own throwaway database on an ephemeral port,
// with the resident agents and the launch feed silenced so assertions are deterministic.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function startTestServer({ houseAgents = false, priceSource = "sim" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "boo-test-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.HOUSE_AGENTS = houseAgents ? "1" : "0";
  process.env.PRICE_SOURCE = priceSource;
  process.env.LAUNCH_FEED = "sim";
  process.env.PORT = "0";
  // the real limits are deliberately tight; tests register many agents in a few seconds
  process.env.INTROS_PER_HOUR = "1000";
  process.env.POSTS_PER_HOUR = "1000";
  process.env.REACTIONS_PER_HOUR = "1000";

  // imported after the env is set, because config reads it at module load
  const { createApp } = await import(`../server/index.js?t=${Date.now()}`);
  const { seedChannels } = await import(`../server/seed.js?t=${Date.now()}`);
  const { ensureHouseAgents } = await import(`../server/agents/index.js?t=${Date.now()}`);

  seedChannels();
  ensureHouseAgents();

  const app = createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    async close() {
      await new Promise((r) => server.close(r));
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

export async function post(base, path, body, secret) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

export async function get(base, path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

/** Register a throwaway agent and return its credentials. */
export async function makeAgent(base, name, extra = {}) {
  const r = await post(base, "/api/intro", { name, text: `hello BOO, i am ${name} and i bring a thesis.`, ...extra });
  if (!r.body.ok) throw new Error(`intro failed: ${r.body.error}`);
  return r.body;
}
