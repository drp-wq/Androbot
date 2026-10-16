import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.js";

test("health endpoint explicitly reports trading disabled", async () => {
  const app = createServer();
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { status: string; tradingEnabled: boolean; network: string };
    assert.equal(body.status, "ok");
    assert.equal(body.tradingEnabled, false);
    assert.equal(body.network, "devnet");
  } finally {
    await app.close();
  }
});
