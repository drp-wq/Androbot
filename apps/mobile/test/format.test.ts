import assert from "node:assert";
import test from "node:test";
import { calculateUnrealizedPnl, formatBps, lamportsToSol, shortAddress } from "../src/utils/format.ts";

test("lamportsToSol converts lamport amounts to formatted SOL strings", () => {
  assert.strictEqual(lamportsToSol("1000000000"), "1.0000");
  assert.strictEqual(lamportsToSol("10500000000"), "10.5000");
  assert.strictEqual(lamportsToSol(500000000), "0.5000");
  assert.strictEqual(lamportsToSol(0), "0.0000");
  assert.strictEqual(lamportsToSol(""), "0.0000");
  assert.strictEqual(lamportsToSol(null), "0.0000");
  assert.strictEqual(lamportsToSol(undefined), "0.0000");
  assert.strictEqual(lamportsToSol(BigInt(2_000_000_000)), "2.0000");
});

test("shortAddress formats Solana addresses cleanly", () => {
  assert.strictEqual(
    shortAddress("So11111111111111111111111111111111111111112"),
    "So11…1112"
  );
  assert.strictEqual(shortAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), "EPjF…Dt1v");
  assert.strictEqual(shortAddress(null), "—");
  assert.strictEqual(shortAddress(undefined), "—");
  assert.strictEqual(shortAddress(""), "—");
  assert.strictEqual(shortAddress("short"), "short");
});

test("calculateUnrealizedPnl accurately computes PnL and return percentages", () => {
  // Gain scenario: bought at 1 SOL (1,000,000,000 lamports), now at 1.5 SOL, qty 2
  const gain = calculateUnrealizedPnl("2", "1000000000", "1500000000");
  assert.strictEqual(gain.isProfit, true);
  assert.strictEqual(gain.pnlSol, "+1.0000");
  assert.strictEqual(gain.pnlPercent, "+50.00%");

  // Loss scenario: bought at 2 SOL, now at 1 SOL, qty 1
  const loss = calculateUnrealizedPnl("1", "2000000000", "1000000000");
  assert.strictEqual(loss.isProfit, false);
  assert.strictEqual(loss.pnlSol, "-1.0000");
  assert.strictEqual(loss.pnlPercent, "-50.00%");

  // Edge cases
  const zero = calculateUnrealizedPnl("0", "1000000000", "1000000000");
  assert.strictEqual(zero.pnlSol, "0.0000");
  assert.strictEqual(zero.isProfit, false);
});

test("formatBps formats basis points into percentage", () => {
  assert.strictEqual(formatBps(100), "100 bps (1.00%)");
  assert.strictEqual(formatBps(50), "50 bps (0.50%)");
  assert.strictEqual(formatBps(null), "—");
  assert.strictEqual(formatBps(undefined), "—");
});
