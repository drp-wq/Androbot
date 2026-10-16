import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig, parseBoolean, redactSecrets, TradeIntentSchema, LIVE_TRADING_ACK_PHRASE } from "../src/index.js";

test("defaults to devnet and disables mainnet trading", () => {
  const config = loadRuntimeConfig({});
  assert.equal(config.network, "devnet");
  assert.equal(config.mainnetTradingEnabled, false);
});

test("rejects mainnet without explicit enablement", () => {
  assert.throws(() => loadRuntimeConfig({ NETWORK: "mainnet" }), /Mainnet is disabled/);
});

test("rejects invalid boolean environment values", () => {
  assert.throws(() => parseBoolean("yes"), /exactly 'true' or 'false'/);
});

test("defaults to paper mode with sensible risk limits", () => {
  const config = loadRuntimeConfig({});
  assert.equal(config.tradingMode, "paper");
  assert.equal(config.enableControlApi, false);
  assert.ok(config.maxSlippageBps >= 1 && config.maxSlippageBps <= 1000);
});

test("rejects live mode without the explicit acknowledgement", () => {
  assert.throws(
    () => loadRuntimeConfig({ NETWORK: "mainnet", MAINNET_TRADING_ENABLED: "true", TRADING_MODE: "live" }),
    /LIVE_TRADING_ACK/
  );
});

test("allows live mode only with mainnet, enablement and the acknowledgement", () => {
  const config = loadRuntimeConfig({
    NETWORK: "mainnet",
    MAINNET_TRADING_ENABLED: "true",
    TRADING_MODE: "live",
    LIVE_TRADING_ACK: LIVE_TRADING_ACK_PHRASE
  });
  assert.equal(config.tradingMode, "live");
});

test("control API requires a token when enabled", () => {
  assert.throws(() => loadRuntimeConfig({ ENABLE_CONTROL_API: "true" }), /CONTROL_API_TOKEN/);
});

test("redacts secret-looking keys from log records", () => {
  const redacted = redactSecrets({ apiKey: "abc", nested: { privateKey: "xyz", plain: 1 } }) as Record<string, unknown>;
  assert.equal(redacted["apiKey"], "[redacted]");
  assert.deepEqual(redacted["nested"], { privateKey: "[redacted]", plain: 1 });
});

test("validates trade intent shape and bounds", () => {
  const result = TradeIntentSchema.safeParse({
    idempotencyKey: "c7c3b79d-9e6c-4a84-bf80-0a8b7c9d5d15",
    mintAddress: "So11111111111111111111111111111111111111112",
    side: "buy",
    amountLamports: 1000,
    maxSlippageBps: 100
  });
  assert.equal(result.success, true);
});
