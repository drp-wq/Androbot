import assert from "node:assert/strict";
import test from "node:test";
import { verifyTokenSafety, type SafetyPolicy, type TokenAccountFacts } from "../src/index.js";

const policy: SafetyPolicy = {
  minLiquidityLamports: 1_000_000n,
  maxHolderConcentrationBps: 2_000,
  requireMintAuthorityRevoked: true,
  requireFreezeAuthorityRevoked: true,
  requireLpBurnedOrLocked: true,
  requireSellSimulation: true
};

const safeFacts: TokenAccountFacts = {
  mint: "So11111111111111111111111111111111111111112",
  mintAuthorityRevoked: true,
  freezeAuthorityRevoked: true,
  decimals: 9,
  holderConcentrationBps: 1_000
};

test("approves a token that passes every anti-rug check", () => {
  const decision = verifyTokenSafety(policy, {
    mint: safeFacts.mint,
    facts: safeFacts,
    liquidityLamports: 10_000_000n,
    lpBurnedOrLocked: true,
    sellSimulationPassed: true
  });
  assert.equal(decision.ok, true);
});

test("fails closed on multiple unsafe signals", () => {
  const decision = verifyTokenSafety(policy, {
    mint: safeFacts.mint,
    facts: { ...safeFacts, mintAuthorityRevoked: false, freezeAuthorityRevoked: false, holderConcentrationBps: 9_000 },
    liquidityLamports: 1n,
    lpBurnedOrLocked: false,
    sellSimulationPassed: false
  });
  assert.equal(decision.ok, false);
  assert.ok(decision.reasons.includes("mint_authority_active"));
  assert.ok(decision.reasons.includes("freeze_authority_active"));
  assert.ok(decision.reasons.includes("insufficient_liquidity"));
  assert.ok(decision.reasons.includes("lp_not_burned_or_locked"));
  assert.ok(decision.reasons.includes("holder_concentration_too_high"));
  assert.ok(decision.reasons.includes("sell_simulation_failed"));
});

test("rejects invalid decimals", () => {
  const decision = verifyTokenSafety(policy, {
    mint: safeFacts.mint,
    facts: { ...safeFacts, decimals: 99 },
    liquidityLamports: 10_000_000n,
    lpBurnedOrLocked: true,
    sellSimulationPassed: true
  });
  assert.equal(decision.ok, false);
  assert.ok(decision.reasons.includes("invalid_decimals"));
});
