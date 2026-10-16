import type { PricePoint, Strategy, StrategyInput, StrategySignal } from "./types.js";

export interface MomentumStrategyConfig {
  readonly shortWindow: number;
  readonly longWindow: number;
  readonly minSamples: number;
  readonly thresholdBps: number;
}

const DEFAULT_CONFIG: MomentumStrategyConfig = {
  shortWindow: 3,
  longWindow: 10,
  minSamples: 12,
  thresholdBps: 20
};

function simpleAverage(points: readonly PricePoint[]): bigint {
  let total = 0n;
  for (const point of points) total += point.priceLamports;
  return total / BigInt(points.length);
}

function clampConfidence(value: number): number {
  if (value < 0) return 0;
  if (value > 10_000) return 10_000;
  return Math.round(value);
}

/**
 * Deterministic momentum strategy. It never issues a buy while the market regime is
 * risk_off and always returns "hold" when history is too short to be meaningful.
 */
export class MomentumStrategy implements Strategy {
  private readonly config: MomentumStrategyConfig;

  constructor(config: Partial<MomentumStrategyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  evaluate(input: StrategyInput): StrategySignal {
    const { history } = input;
    if (history.length < this.config.minSamples) {
      return { action: "hold", confidenceBps: 0, reasons: ["insufficient_history"] };
    }
    const shortSlice = history.slice(history.length - this.config.shortWindow);
    const longSlice = history.slice(history.length - this.config.longWindow);
    const shortAverage = simpleAverage(shortSlice);
    const longAverage = simpleAverage(longSlice);
    if (longAverage <= 0n) {
      return { action: "hold", confidenceBps: 0, reasons: ["invalid_price_history"] };
    }

    const divergenceBps = (Number(shortAverage) / Number(longAverage) - 1) * 10_000;
    if (!Number.isFinite(divergenceBps)) {
      return { action: "hold", confidenceBps: 0, reasons: ["non_finite_divergence"] };
    }
    const magnitude = Math.abs(divergenceBps);
    const baseConfidence = 5_000 + Math.min(3_000, magnitude);
    const regimeAdjustment = input.regime === "risk_on" ? 1_000 : input.regime === "uncertain" ? -2_000 : -5_000;
    const confidence = clampConfidence(baseConfidence + regimeAdjustment);

    if (magnitude < this.config.thresholdBps) {
      return { action: "hold", confidenceBps: confidence, reasons: ["divergence_below_threshold"] };
    }
    if (divergenceBps > 0) {
      if (input.regime === "risk_off") {
        return { action: "hold", confidenceBps: confidence, reasons: ["buy_blocked_by_risk_off_regime"] };
      }
      return { action: "buy", confidenceBps: confidence, reasons: ["short_average_above_long_average"] };
    }
    if (input.hasOpenPosition) {
      return { action: "sell", confidenceBps: confidence, reasons: ["short_average_below_long_average"] };
    }
    return { action: "hold", confidenceBps: confidence, reasons: ["bearish_without_position"] };
  }
}
