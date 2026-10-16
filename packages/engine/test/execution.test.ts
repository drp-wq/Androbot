import assert from "node:assert/strict";
import test from "node:test";
import { LiveExecutionRouter, PaperExecutionRouter, firstExecutionRequestProblem, validateExecutionRequest } from "../src/index.js";

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

test("validateExecutionRequest accepts a well-formed request", () => {
  assert.deepEqual(validateExecutionRequest({ ...baseRequest, side: "buy", notionalLamports: 1_000n, quantityTokens: 0n }), []);
  assert.equal(firstExecutionRequestProblem({ ...baseRequest, side: "sell", notionalLamports: 0n, quantityTokens: 10n }), null);
});

test("validateExecutionRequest rejects malformed mint, side, symbol and idempotency key", () => {
  const reasons = validateExecutionRequest({
    ...baseRequest,
    mint: "not-a-solana-address",
    side: "hodl" as unknown as "buy",
    symbol: "",
    idempotencyKey: "not-a-uuid"
  } as never);
  assert.ok(reasons.includes("invalid_mint"));
  assert.ok(reasons.includes("invalid_side"));
  assert.ok(reasons.includes("invalid_symbol"));
  assert.ok(reasons.includes("invalid_idempotency_key"));
});

test("validateExecutionRequest rejects bad amounts, price and slippage bounds", () => {
  assert.deepEqual(
    validateExecutionRequest({ ...baseRequest, side: "buy", notionalLamports: 0n, quantityTokens: 0n }),
    ["invalid_notional"]
  );
  assert.deepEqual(
    validateExecutionRequest({ ...baseRequest, side: "sell", notionalLamports: 0n, quantityTokens: 0n }),
    ["invalid_quantity"]
  );
  assert.ok(
    validateExecutionRequest({ ...baseRequest, side: "buy", notionalLamports: 1n, quantityTokens: 0n, referencePriceLamports: 0n }).includes(
      "invalid_reference_price"
    )
  );
  assert.ok(
    validateExecutionRequest({ ...baseRequest, side: "buy", notionalLamports: 1n, quantityTokens: 0n, maxSlippageBps: 1_001 }).includes(
      "invalid_slippage_cap"
    )
  );
});

test("paper router fails closed on a malformed mint at the boundary", async () => {
  const router = new PaperExecutionRouter();
  const result = await router.execute({
    ...baseRequest,
    mint: "not-a-solana-address",
    side: "buy",
    notionalLamports: 1_000_000n,
    quantityTokens: 0n
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "invalid_mint");
});

test("paper router reports multiple boundary problems with a combined reason", async () => {
  const router = new PaperExecutionRouter();
  const result = await router.execute({
    ...baseRequest,
    mint: "not-a-solana-address",
    symbol: "",
    side: "buy",
    notionalLamports: 0n,
    quantityTokens: 0n
  });
  assert.equal(result.status, "rejected");
  assert.match(result.reason, /^invalid_execution_request:/);
  assert.match(result.reason, /invalid_mint/);
  assert.match(result.reason, /invalid_notional/);
});

test("live router requires acknowledgement and always rejects", async () => {
  assert.throws(() => new LiveExecutionRouter(false), /acknowledgement/);
  const router = new LiveExecutionRouter(true);
  const result = await router.execute({ ...baseRequest, side: "sell", notionalLamports: 0n, quantityTokens: 10n });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "live_execution_not_implemented");
});
