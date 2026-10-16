export type MarketRegime = "risk_on" | "risk_off" | "uncertain";

export interface MarketObservation {
  readonly priceChangeBps: number;
  readonly liquidityChangeBps: number;
  readonly volatilityBps: number;
  readonly sampleCount: number;
}

export interface RegimeResult {
  readonly regime: MarketRegime;
  readonly confidenceBps: number;
  readonly reasons: readonly string[];
}

export function classifyMarketRegime(observation: MarketObservation): RegimeResult {
  const values = [
    observation.priceChangeBps,
    observation.liquidityChangeBps,
    observation.volatilityBps,
    observation.sampleCount
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    return { regime: "uncertain", confidenceBps: 0, reasons: ["non_finite_observation"] };
  }
  if (observation.sampleCount < 3 || observation.volatilityBps < 0) {
    return { regime: "uncertain", confidenceBps: 0, reasons: ["insufficient_or_invalid_market_data"] };
  }
  if (observation.liquidityChangeBps <= -1500) {
    return { regime: "risk_off", confidenceBps: 9500, reasons: ["severe_liquidity_contraction"] };
  }
  if (observation.volatilityBps >= 2500) {
    return { regime: "risk_off", confidenceBps: 8000, reasons: ["extreme_volatility"] };
  }
  if (observation.priceChangeBps > 0 && observation.liquidityChangeBps >= 0 && observation.volatilityBps < 1000) {
    return { regime: "risk_on", confidenceBps: 7000, reasons: ["positive_price_and_stable_liquidity"] };
  }
  return { regime: "uncertain", confidenceBps: 5000, reasons: ["signals_not_aligned"] };
}
