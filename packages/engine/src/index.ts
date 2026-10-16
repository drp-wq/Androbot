export * from "./types.js";
export * from "./safety.js";
export * from "./market.js";
export * from "./solana.js";
export * from "./strategy.js";
export * from "./portfolio.js";
export * from "./validation.js";
export * from "./execution.js";
export * from "./trader.js";

import { SimulatedMarketDataSource } from "./market.js";
import { PaperSolanaClient } from "./solana.js";
import { PaperExecutionRouter } from "./execution.js";
import { AutonomousTrader, type TraderConfig } from "./trader.js";
import { Portfolio } from "./portfolio.js";
import { MomentumStrategy } from "./strategy.js";
import type { Ledger } from "./types.js";
import type { StructuredLogger } from "@solana-system/shared";
import type { RiskLimits } from "@solana-system/risk";

export interface PaperTradingBundleConfig {
  readonly trader: TraderConfig;
  readonly limits: RiskLimits;
  readonly startingCashLamports: bigint;
  readonly ledger: Ledger;
  readonly logger: StructuredLogger;
}

/**
 * Convenience factory for the default paper-trading stack. It wires the simulated
 * market, paper Solana client, paper executor and momentum strategy together.
 */
export function createPaperTrader(config: PaperTradingBundleConfig): AutonomousTrader {
  return new AutonomousTrader(config.trader, {
    market: new SimulatedMarketDataSource(),
    solana: new PaperSolanaClient(),
    executor: new PaperExecutionRouter(),
    portfolio: new Portfolio(config.startingCashLamports),
    strategy: new MomentumStrategy(),
    ledger: config.ledger,
    logger: config.logger,
    limits: config.limits
  });
}
