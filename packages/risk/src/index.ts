export interface RiskLimits {
  readonly maxPositionLamports: bigint;
  readonly maxDailyLossLamports: bigint;
  readonly maxOpenPositions: number;
  readonly maxSlippageBps: number;
}

export interface RiskSnapshot {
  readonly proposedPositionLamports: bigint;
  readonly dailyLossLamports: bigint;
  readonly openPositions: number;
  readonly proposedSlippageBps: number;
  readonly tradingPaused: boolean;
}

export type RiskDecision =
  | { readonly allowed: true; readonly reasons: readonly [] }
  | { readonly allowed: false; readonly reasons: readonly string[] };

export function validateRiskLimits(limits: RiskLimits): void {
  if (limits.maxPositionLamports <= 0n) throw new Error("maxPositionLamports must be positive.");
  if (limits.maxDailyLossLamports <= 0n) throw new Error("maxDailyLossLamports must be positive.");
  if (!Number.isSafeInteger(limits.maxOpenPositions) || limits.maxOpenPositions < 1) {
    throw new Error("maxOpenPositions must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(limits.maxSlippageBps) || limits.maxSlippageBps < 1 || limits.maxSlippageBps > 1000) {
    throw new Error("maxSlippageBps must be between 1 and 1000 basis points.");
  }
}

export function evaluateRisk(limits: RiskLimits, snapshot: RiskSnapshot): RiskDecision {
  validateRiskLimits(limits);
  const reasons: string[] = [];
  if (snapshot.tradingPaused) reasons.push("trading_paused");
  if (snapshot.proposedPositionLamports <= 0n) reasons.push("position_must_be_positive");
  if (snapshot.proposedPositionLamports > limits.maxPositionLamports) reasons.push("position_limit_exceeded");
  if (snapshot.dailyLossLamports < 0n) reasons.push("daily_loss_snapshot_invalid");
  if (snapshot.dailyLossLamports >= limits.maxDailyLossLamports) reasons.push("daily_loss_limit_reached");
  if (!Number.isSafeInteger(snapshot.openPositions) || snapshot.openPositions < 0) reasons.push("open_position_snapshot_invalid");
  if (snapshot.openPositions >= limits.maxOpenPositions) reasons.push("open_position_limit_reached");
  if (!Number.isSafeInteger(snapshot.proposedSlippageBps) || snapshot.proposedSlippageBps < 0) {
    reasons.push("slippage_snapshot_invalid");
  } else if (snapshot.proposedSlippageBps > limits.maxSlippageBps) {
    reasons.push("slippage_limit_exceeded");
  }
  return reasons.length === 0 ? { allowed: true, reasons: [] } : { allowed: false, reasons };
}
