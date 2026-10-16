import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJsonLogger, persistKillswitchLock, persistKillswitchUnlock } from "@solana-system/shared";
import type { RiskLimits } from "@solana-system/risk";
import {
  AutonomousTrader,
  MemoryLedger,
  PAPER_MARKETS,
  PaperExecutionRouter,
  PaperSolanaClient,
  Portfolio,
  type MarketDataSource,
  type MarketQuote,
  type Mint,
  type PricePoint,
  type Strategy
} from "../src/index.js";

const MINT: Mint = PAPER_MARKETS[0]?.mint ?? "So11111111111111111111111111111111111111112";

class FakeMarket implements MarketDataSource {
  readonly id = "fake";
  readonly isLive = false;
  async listMarkets(): Promise<readonly Mint[]> {
    return [MINT];
  }
  async getQuote(mint: Mint): Promise<MarketQuote> {
    return {
      mint,
      symbol: "FAKE",
      priceLamports: 100n,
      liquidityLamports: 5_000_000_000n,
      lpBurnedOrLocked: true,
      updatedAt: new Date().toISOString()
    };
  }
  async getHistory(_mint: Mint): Promise<readonly PricePoint[]> {
    return Array.from({ length: 12 }, (_value, index) => ({
      at: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
      priceLamports: 100n,
      liquidityLamports: 5_000_000_000n
    }));
  }
}

const alwaysBuy: Strategy = { evaluate: () => ({ action: "buy", confidenceBps: 10_000, reasons: ["test"] }) };
const limits: RiskLimits = { maxPositionLamports: 100_000n, maxDailyLossLamports: 1_000_000n, maxOpenPositions: 1, maxSlippageBps: 100 };

function buildTrader(directory: string): AutonomousTrader {
  return new AutonomousTrader(
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
      market: new FakeMarket(),
      solana: new PaperSolanaClient(),
      executor: new PaperExecutionRouter({ feeBps: 30, slippageBps: 50 }),
      portfolio: new Portfolio(1_000_000n),
      ledger: new MemoryLedger(),
      strategy: alwaysBuy,
      logger: createJsonLogger("error", {}, () => {}),
      limits
    }
  );
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "engine-killswitch-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("a locked killswitch halts trading even while a strategy wants to buy", async () => {
  await withTempDir(async (directory) => {
    await persistKillswitchLock(join(directory, "killswitch-state.json"), "panic:manual");
    const trader = buildTrader(directory);
    const summary = await trader.tick();
    assert.equal(summary.entries, 0);
    assert.equal(summary.paused, true);
    assert.equal(trader.status().locked, true);
    assert.match(trader.status().lockReason ?? "", /panic:manual/);
  });
});

test("trading resumes only after the lock is explicitly cleared", async () => {
  await withTempDir(async (directory) => {
    const lockPath = join(directory, "killswitch-state.json");
    await persistKillswitchLock(lockPath, "manual_lock");
    const trader = buildTrader(directory);

    assert.equal((await trader.tick()).entries, 0);
    trader.resume();
    assert.equal((await trader.tick()).entries, 0, "resume must not override a killswitch lock");

    await persistKillswitchUnlock(lockPath);
    assert.equal((await trader.tick()).entries, 1);
    assert.equal(trader.status().locked, false);
  });
});

test("a malformed lock file fails closed", async () => {
  await withTempDir(async (directory) => {
    await writeFile(join(directory, "killswitch-state.json"), "{ broken", "utf8");
    const trader = buildTrader(directory);
    const summary = await trader.tick();
    assert.equal(summary.entries, 0);
    assert.equal(trader.status().locked, true);
    assert.match(trader.status().lockReason ?? "", /malformed/);
  });
});
