import {
  AutonomousTrader,
  FileLedger,
  HttpMarketDataSource,
  LiveExecutionRouter,
  MomentumStrategy,
  PAPER_MARKETS,
  PaperExecutionRouter,
  PaperSolanaClient,
  Portfolio,
  RpcSolanaClient,
  SimulatedMarketDataSource,
  type Ledger,
  type MarketDataSource,
  type Mint,
  type SafetyPolicy,
  type SolanaClient
} from "@solana-system/engine";
import type { RiskLimits } from "@solana-system/risk";
import type { RuntimeConfig, StructuredLogger } from "@solana-system/shared";
import { isPaperMode, parseSolanaAddressList } from "@solana-system/shared";
import { join } from "node:path";

export interface TradingStack {
  readonly trader: AutonomousTrader;
  readonly market: MarketDataSource;
  readonly solana: SolanaClient;
  readonly ledger: Ledger;
  readonly markets: readonly Mint[];
}

export function resolveSafetyPolicy(): SafetyPolicy {
  return {
    minLiquidityLamports: 1_000_000_000n,
    maxHolderConcentrationBps: 3_000,
    requireMintAuthorityRevoked: true,
    requireFreezeAuthorityRevoked: true,
    requireLpBurnedOrLocked: true,
    requireSellSimulation: true
  };
}

export function resolveLimits(config: RuntimeConfig): RiskLimits {
  return {
    maxPositionLamports: BigInt(config.maxPositionLamports),
    maxDailyLossLamports: BigInt(config.maxDailyLossLamports),
    maxOpenPositions: config.maxOpenPositions,
    maxSlippageBps: config.maxSlippageBps
  };
}

function resolveLiveMarkets(env: NodeJS.ProcessEnv): readonly Mint[] {
  const raw = env.MARKET_MINTS;
  if (raw === undefined || raw.trim() === "") {
    throw new Error("Live mode requires MARKET_MINTS (comma-separated mint addresses).");
  }
  return parseSolanaAddressList(raw, "MARKET_MINTS");
}

/**
 * Builds the trading stack. Paper mode is fully self-contained and offline. Live mode
 * is constructed but its execution router rejects every order until a reviewed signer
 * and DEX router exist, so it can only ever observe.
 */
export function buildTradingStack(config: RuntimeConfig, logger: StructuredLogger, env: NodeJS.ProcessEnv): TradingStack {
  const stateDir = config.stateDir;
  const ledger = new FileLedger(join(stateDir, "ledger.jsonl"));
  const limits = resolveLimits(config);

  let market: MarketDataSource;
  let solana: SolanaClient;
  let portfolio: Portfolio;

  if (isPaperMode(config)) {
    market = new SimulatedMarketDataSource();
    solana = new PaperSolanaClient();
    portfolio = new Portfolio(BigInt(config.paperStartingBalanceLamports));
  } else {
    const marketDataUrl = env.MARKET_DATA_URL;
    if (marketDataUrl === undefined || marketDataUrl.trim() === "") {
      throw new Error("Live mode requires MARKET_DATA_URL for the market feed.");
    }
    market = new HttpMarketDataSource({ id: "http", baseUrl: marketDataUrl, markets: resolveLiveMarkets(env) });
    solana = new RpcSolanaClient({ id: "rpc", rpcUrl: config.solanaRpcUrl });
    portfolio = new Portfolio(0n);
  }

  const markets = isPaperMode(config)
    ? PAPER_MARKETS.map((entry) => entry.mint)
    : resolveLiveMarkets(env);

  const executor = isPaperMode(config)
    ? new PaperExecutionRouter({ feeBps: 30, slippageBps: Math.min(50, config.maxSlippageBps) })
    : new LiveExecutionRouter(true);

  const trader = new AutonomousTrader(
    {
      markets,
      actor: "backend",
      mode: config.tradingMode,
      network: config.network,
      safetyPolicy: resolveSafetyPolicy(),
      stopLossBps: 1_500,
      takeProfitBps: 3_000,
      maxRpcFailureStreak: 3,
      heartbeatPath: join(stateDir, "trader-status.json"),
      killswitchStatePath: config.killswitchStatePath
    },
    {
      market,
      solana,
      executor,
      portfolio,
      ledger,
      strategy: new MomentumStrategy(),
      logger,
      limits
    }
  );

  return { trader, market, solana, ledger, markets };
}
