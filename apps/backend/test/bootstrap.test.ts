import assert from "node:assert/strict";
import test from "node:test";
import { createJsonLogger, loadRuntimeConfig, LIVE_TRADING_ACK_PHRASE } from "@solana-system/shared";
import { buildTradingStack, resolveLimits, resolveSafetyPolicy } from "../src/bootstrap.js";

const logger = createJsonLogger("error", {}, () => {});

test("resolveLimits mirrors the validated runtime config", () => {
  const config = loadRuntimeConfig({ MAX_POSITION_LAMPORTS: "5000000", MAX_OPEN_POSITIONS: "2", MAX_SLIPPAGE_BPS: "150" });
  const limits = resolveLimits(config);
  assert.equal(limits.maxPositionLamports, 5_000_000n);
  assert.equal(limits.maxOpenPositions, 2);
  assert.equal(limits.maxSlippageBps, 150);
});

test("safety policy requires revoked authorities, locked LP and a passing sell simulation", () => {
  const policy = resolveSafetyPolicy();
  assert.equal(policy.requireMintAuthorityRevoked, true);
  assert.equal(policy.requireFreezeAuthorityRevoked, true);
  assert.equal(policy.requireLpBurnedOrLocked, true);
  assert.equal(policy.requireSellSimulation, true);
});

test("paper stack builds offline with simulated components", () => {
  const config = loadRuntimeConfig({});
  const stack = buildTradingStack(config, logger, {});
  assert.equal(stack.market.isLive, false);
  assert.equal(stack.solana.isLive, false);
  assert.ok(stack.markets.length > 0);
});

test("live stack rejects a malformed MARKET_MINTS address", () => {
  const env = {
    NETWORK: "mainnet",
    MAINNET_TRADING_ENABLED: "true",
    TRADING_MODE: "live",
    LIVE_TRADING_ACK: LIVE_TRADING_ACK_PHRASE,
    MARKET_DATA_URL: "https://feed.example.invalid",
    MARKET_MINTS: "not-a-valid-mint"
  };
  const config = loadRuntimeConfig(env);
  assert.throws(() => buildTradingStack(config, logger, env), /invalid Solana address/);
});

test("live stack builds read-only when addresses are valid", () => {
  const env = {
    NETWORK: "mainnet",
    MAINNET_TRADING_ENABLED: "true",
    TRADING_MODE: "live",
    LIVE_TRADING_ACK: LIVE_TRADING_ACK_PHRASE,
    MARKET_DATA_URL: "https://feed.example.invalid",
    MARKET_MINTS: "So11111111111111111111111111111111111111112"
  };
  const config = loadRuntimeConfig(env);
  const stack = buildTradingStack(config, logger, env);
  assert.equal(stack.market.isLive, true);
  assert.equal(stack.solana.isLive, true);
});
