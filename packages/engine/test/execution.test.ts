import assert from "node:assert/strict";
import test from "node:test";
import { LiveExecutionRouter, PaperExecutionRouter } from "../src/index.js";

const baseRequest = {
  mint: "So11111111111111111111111111111111111111112",
  symbol: "wSOL",
  referencePriceLamports: 1_000_000n,
  maxSlippageBps: 100,
  idempotencyKey: "11111111-1111-4111-8111-111111111111"
} as const;

test("paper router fills a buy with adverse slippage and fees", async () => {
  const router = new PaperExecutionRouter({ feeBps: 30, slippageBps: 50 });
  const result = await router.execute({ ...baseRequest, side: "buy", notionalLamports: 10_000_000n, quantityTokens: 0n });
  assert.equal(result.status, "filled");
  assert.ok(result.priceLamports > baseRequest.referencePriceLamports);
  assert.ok(result.quantityTokens > 0n);
  assert.ok(result.feeLamports > 0n);
  assert.ok(result.txRef !== null && result.txRef.startsWith("paper:"));
});

test("paper router rejects an invalid slippage cap", async () => {
  const router = new PaperExecutionRouter();
  const result = await router.execute({
    ...baseRequest,
    side: "buy",
    notionalLamports: 1_000_000n,
    quantityTokens: 0n,
    maxSlippageBps: 5_000
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "invalid_slippage_cap");
});

test("live router requires acknowledgement and always rejects", async () => {
  assert.throws(() => new LiveExecutionRouter(false), /acknowledgement/);
  const router = new LiveExecutionRouter(true);
  const result = await router.execute({ ...baseRequest, side: "sell", notionalLamports: 0n, quantityTokens: 10n });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "live_execution_not_implemented");
});
