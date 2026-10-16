import type { SafetyDecision, SafetyInput, SafetyPolicy } from "./types.js";

/**
 * Anti-rug verification. Fails closed: any missing, ambiguous or invalid signal
 * produces a rejection reason rather than an approval.
 */
export function verifyTokenSafety(policy: SafetyPolicy, input: SafetyInput): SafetyDecision {
  const reasons: string[] = [];

  if (!Number.isSafeInteger(input.facts.decimals) || input.facts.decimals < 0 || input.facts.decimals > 12) {
    reasons.push("invalid_decimals");
  }
  if (policy.requireMintAuthorityRevoked && input.facts.mintAuthorityRevoked !== true) {
    reasons.push("mint_authority_active");
  }
  if (policy.requireFreezeAuthorityRevoked && input.facts.freezeAuthorityRevoked !== true) {
    reasons.push("freeze_authority_active");
  }
  if (policy.requireLpBurnedOrLocked && input.lpBurnedOrLocked !== true) {
    reasons.push("lp_not_burned_or_locked");
  }
  if (input.liquidityLamports < policy.minLiquidityLamports) {
    reasons.push("insufficient_liquidity");
  }
  if (!Number.isFinite(input.facts.holderConcentrationBps) || input.facts.holderConcentrationBps < 0) {
    reasons.push("holder_concentration_unknown");
  } else if (input.facts.holderConcentrationBps > policy.maxHolderConcentrationBps) {
    reasons.push("holder_concentration_too_high");
  }
  if (policy.requireSellSimulation && input.sellSimulationPassed !== true) {
    reasons.push("sell_simulation_failed");
  }

  return reasons.length === 0 ? { ok: true, reasons: [] } : { ok: false, reasons };
}
