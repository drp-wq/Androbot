import assert from "node:assert/strict";
import test from "node:test";
import { computePositionSizeLamports, dailyLossLamports, evaluateRisk, type RiskLimits, type RiskSnapshot } from "../src/index.js";

const limits: RiskLimits = {
  maxPositionLamports: 1_000_000_000n,
  maxDailyLossLamports: 500_000_000n,
  maxOpenPositions: 3,
  maxSlippageBps: 150
};

const safeSnapshot: RiskSnapshot = {
  proposedPositionLamports: 100_000_000n,
  dailyLossLamports: 0n,
  openPositions: 0,
  proposedSlippageBps: 50,
  tradingPaused: false
};

test("allows a proposal within all configured limits", () => {
  assert.deepEqual(evaluateRisk(limits, safeSnapshot), { allowed: true, reasons: [] });
});

test("rejects a proposal that exceeds position and slippage limits", () => {
  const result = evaluateRisk(limits, {
    ...safeSnapshot,
    proposedPositionLamports: 2_000_000_000n,
    proposedSlippageBps: 200
  });
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.ok(result.reasons.includes("position_limit_exceeded"));
    assert.ok(result.reasons.includes("slippage_limit_exceeded"));
  }
});

test("rejects when paused or at the daily loss cap", () => {
  const result = evaluateRisk(limits, {
    ...safeSnapshot,
    dailyLossLamports: limits.maxDailyLossLamports,
    tradingPaused: true
  });
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.ok(result.reasons.includes("trading_paused"));
    assert.ok(result.reasons.includes("daily_loss_limit_reached"));
  }
});

test("position sizing is clamped by cash, cap and confidence", () => {
  assert.equal(computePositionSizeLamports({ availableCashLamports: 1000n, maxPositionLamports: 500n, confidenceBps: 10_000 }), 500n);
  assert.equal(computePositionSizeLamports({ availableCashLamports: 400n, maxPositionLamports: 500n, confidenceBps: 10_000 }), 400n);
  assert.equal(computePositionSizeLamports({ availableCashLamports: 1000n, maxPositionLamports: 500n, confidenceBps: 5_000 }), 250n);
  assert.equal(computePositionSizeLamports({ availableCashLamports: 0n, maxPositionLamports: 500n, confidenceBps: 10_000 }), 0n);
  assert.equal(computePositionSizeLamports({ availableCashLamports: 1000n, maxPositionLamports: 500n, confidenceBps: 0 }), 0n);
});

test("daily loss only counts losses below the day start baseline", () => {
  assert.equal(dailyLossLamports(1000n, 800n), 200n);
  assert.equal(dailyLossLamports(1000n, 1000n), 0n);
  assert.equal(dailyLossLamports(1000n, 1200n), 0n);
});
