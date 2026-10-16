import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig, parseBoolean, TradeIntentSchema } from "../src/index.js";

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
