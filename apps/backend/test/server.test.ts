import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "../src/server.js";

async function withServer(
  env: NodeJS.ProcessEnv,
  run: (app: ReturnType<typeof createServer>) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "backend-test-"));
  const app = createServer({
    autostart: false,
    env: { ...env, NODE_ENV: "test", STATE_DIR: directory }
  });
  try {
    await run(app);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("health endpoint reports paper mode and live execution disabled", async () => {
  await withServer({}, async (app) => {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { status: string; tradingEnabled: boolean; network: string; mode: string };
    assert.equal(body.status, "ok");
    assert.equal(body.tradingEnabled, false);
    assert.equal(body.network, "devnet");
    assert.equal(body.mode, "paper");
  });
});

test("status endpoint exposes portfolio and risk limits", async () => {
  await withServer({}, async (app) => {
    const response = await app.inject({ method: "GET", url: "/api/status" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { mode: string; paused: boolean; maxSlippageBps: number; positions: unknown[] };
    assert.equal(body.mode, "paper");
    assert.equal(body.paused, false);
    assert.ok(body.maxSlippageBps > 0 && body.maxSlippageBps <= 1000);
    assert.deepEqual(body.positions, []);
  });
});

test("control API fails closed when disabled", async () => {
  await withServer({}, async (app) => {
    const response = await app.inject({ method: "POST", url: "/api/control/pause" });
    assert.equal(response.statusCode, 403);
    assert.equal((response.json() as { error: string }).error, "control_api_disabled");
  });
});

test("control API requires a matching token", async () => {
  const env = { ENABLE_CONTROL_API: "true", CONTROL_API_TOKEN: "test-token-1234567890" };
  await withServer(env, async (app) => {
    const unauthorized = await app.inject({ method: "POST", url: "/api/control/pause" });
    assert.equal(unauthorized.statusCode, 401);

    const authorized = await app.inject({
      method: "POST",
      url: "/api/control/pause",
      headers: { authorization: "Bearer test-token-1234567890" },
      payload: { reason: "test" }
    });
    assert.equal(authorized.statusCode, 200);
    assert.equal((authorized.json() as { paused: boolean }).paused, true);

    const status = await app.inject({ method: "GET", url: "/api/status" });
    assert.equal((status.json() as { paused: boolean }).paused, true);
  });
});
