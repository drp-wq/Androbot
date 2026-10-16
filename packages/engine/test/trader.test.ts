import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AutonomousTrader,
  MemoryLedger,
  PAPER_MARKETS,
  PaperExecutionRouter,
  PaperSolanaClient,
  Portfolio,
  type MarketDataSource,
  type Mint,
  type MarketQuote,
  type PricePoint,
  type Strategy
} from "../src/index.js";
import { createJsonLogger, type StructuredLogger } from "@solana-system/shared";
import type { RiskLimits } from "@solana-system/risk";

const MINT: Mint = PAPER_MARKETS[0]?.mint ?? "So11111111111111111111111111111111111111112";

class FakeMarket implements MarketDataSource {
  readonly id = "fake";
  readonly isLive = false;
  constructor(public priceLamports: bigint) {}

  async listMarkets(): Promise<readonly Mint[]> {
    return [MINT];
  }

  async getQuote(mint: Mint): Promise<MarketQuote> {
    return {
      mint,
      symbol: "FAKE",
      priceLamports: this.priceLamports,
      liquidityLamports: 5_000_000_000n,
      lpBurnedOrLocked: true,
      updatedAt: new Date().toISOString()
    };
  }

  async getHistory(_mint: Mint): Promise<readonly PricePoint[]> {
    return Array.from({ length: 12 }, (_value, index) => ({
      at: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
      priceLamports: this.priceLamports,
      liquidityLamports: 5_000_000_000n
    }));
  }
}

const alwaysBuy: Strategy = {
  evaluate: () => ({ action: "buy", confidenceBps: 10_000, reasons: ["test"] })
};

const limits: RiskLimits = {
  maxPositionLamports: 100_000n,
  maxDailyLossLamports: 1_000n,
  maxOpenPositions: 1,
  maxSlippageBps: 100
};

function silentLogger(): StructuredLogger {
  return createJsonLogger("error", {}, () => {});
}

test("paper trader enters, hits stop loss, breaches daily loss and pauses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "engine-trader-"));
  const ledger = new MemoryLedger();
  const market = new FakeMarket(100n);
  const portfolio = new Portfolio(1_000_000n);
  const trader = new AutonomousTrader(
    {
      markets: [MINT],
      actor: "test",
      mode: "paper",
      network: "devnet",
      safetyPolicy: {
        minLiquidityLamports: 1n,
        maxHolderConcentrationBps: 9_000,
        requireMintAuthorityRevoked: true,
        requireFreezeAuthorityRevoked: true,
        requireLpBurnedOrLocked: true,
        requireSellSimulation: true
      },
      stopLossBps: 2_000,
      takeProfitBps: 5_000,
      maxRpcFailureStreak: 3,
      heartbeatPath: join(directory, "status.json"),
      killswitchStatePath: join(directory, "killswitch-state.json")
    },
    {
      market,
      solana: new PaperSolanaClient(),
      executor: new PaperExecutionRouter({ feeBps: 30, slippageBps: 50 }),
      portfolio,
      ledger,
      strategy: alwaysBuy,
      logger: silentLogger(),
      limits
    }
  );

  try {
    const first = await trader.tick();
    assert.equal(first.entries, 1);
    assert.equal(trader.status().openPositions, 1);

    market.priceLamports = 10n;
    const second = await trader.tick();
    assert.equal(trader.status().openPositions, 0);
    assert.equal(second.exits, 1);
    assert.equal(trader.isPaused(), true);
    assert.equal(trader.status().pauseReason, "daily_loss_limit_reached");

    const entries = await ledger.readAll();
    assert.ok(entries.some((entry) => entry.type === "intent"));
    assert.ok(entries.some((entry) => entry.type === "fill"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("paused trader performs no work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "engine-trader-"));
  const market = new FakeMarket(100n);
  const trader = new AutonomousTrader(
    {
      markets: [MINT],
      actor: "test",
      mode: "paper",
      network: "devnet",
      safetyPolicy: {
        minLiquidityLamports: 1n,
        maxHolderConcentrationBps: 9_000,
        requireMintAuthorityRevoked: true,
        requireFreezeAuthorityRevoked: true,
        requireLpBurnedOrLocked: true,
        requireSellSimulation: true
      },
      stopLossBps: 2_000,
      takeProfitBps: 5_000,
      maxRpcFailureStreak: 3,
      heartbeatPath: join(directory, "status.json"),
      killswitchStatePath: join(directory, "killswitch-state.json")
    },
    {
      market,
      solana: new PaperSolanaClient(),
      executor: new PaperExecutionRouter(),
      portfolio: new Portfolio(1_000_000n),
      ledger: new MemoryLedger(),
      strategy: alwaysBuy,
      logger: silentLogger(),
      limits
    }
  );
  try {
    trader.pause("manual");
    const summary = await trader.tick();
    assert.equal(summary.paused, true);
    assert.equal(summary.entries, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
