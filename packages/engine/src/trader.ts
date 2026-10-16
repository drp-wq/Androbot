import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { classifyMarketRegime, type MarketObservation } from "@solana-system/ai";
import {
  computePositionSizeLamports,
  estimateSlippageBps,
  evaluateRisk,
  type RiskLimits
} from "@solana-system/risk";
import {
  isKillswitchLocked,
  newIdempotencyKey,
  readKillswitchLock,
  type KillswitchLockRead,
  type StructuredLogger
} from "@solana-system/shared";
import { verifyTokenSafety } from "./safety.js";
import type {
  ExecutionResult,
  ExecutionRouter,
  Ledger,
  MarketDataSource,
  MarketQuote,
  Mint,
  PortfolioSnapshot,
  PricePoint,
  SafetyPolicy,
  SolanaClient,
  Strategy,
  TokenAccountFacts,
  TradeEvent,
  SellSimulation
} from "./types.js";
import type { Portfolio } from "./portfolio.js";

export interface TraderConfig {
  readonly markets: readonly Mint[];
  readonly actor: string;
  readonly mode: "paper" | "live";
  readonly network: string;
  readonly safetyPolicy: SafetyPolicy;
  readonly stopLossBps: number;
  readonly takeProfitBps: number;
  readonly maxRpcFailureStreak: number;
  readonly heartbeatPath: string;
  /** Durable independent killswitch lock. Trading halts whenever this is locked or unreadable. */
  readonly killswitchStatePath: string;
}

export interface TraderDeps {
  readonly market: MarketDataSource;
  readonly solana: SolanaClient;
  readonly executor: ExecutionRouter;
  readonly portfolio: Portfolio;
  readonly ledger: Ledger;
  readonly strategy: Strategy;
  readonly logger: StructuredLogger;
  readonly limits: RiskLimits;
}

export interface TickSummary {
  readonly at: string;
  readonly marketsObserved: number;
  readonly entries: number;
  readonly exits: number;
  readonly rejected: number;
  readonly paused: boolean;
}

export interface TraderStatus {
  readonly mode: "paper" | "live";
  readonly network: string;
  readonly paused: boolean;
  readonly pauseReason: string | null;
  readonly locked: boolean;
  readonly lockReason: string | null;
  readonly lastTickAt: string | null;
  readonly ticks: number;
  readonly rpcFailureStreak: number;
  readonly openPositions: number;
  readonly cashLamports: string;
  readonly equityLamports: string;
  readonly realizedPnlLamports: string;
  readonly feesPaidLamports: string;
  readonly dailyLossLamports: string;
  readonly maxDailyLossLamports: string;
  readonly maxPositionLamports: string;
  readonly maxOpenPositions: number;
  readonly maxSlippageBps: number;
  readonly positions: readonly {
    readonly mint: Mint;
    readonly symbol: string;
    readonly quantityTokens: string;
    readonly averageEntryLamports: string;
    readonly markPriceLamports: string;
    readonly openedAt: string;
  }[];
}

interface Candidate {
  readonly mint: Mint;
  readonly quote: MarketQuote;
  readonly history: readonly PricePoint[];
  readonly facts: TokenAccountFacts;
  readonly simulation: SellSimulation;
}

const MAX_EVENTS = 200;

function buildObservation(history: readonly PricePoint[]): MarketObservation {
  if (history.length < 2) {
    return { priceChangeBps: 0, liquidityChangeBps: 0, volatilityBps: 0, sampleCount: history.length };
  }
  const first = history[0];
  const last = history[history.length - 1];
  if (first === undefined || last === undefined) {
    return { priceChangeBps: 0, liquidityChangeBps: 0, volatilityBps: 0, sampleCount: history.length };
  }
  const priceChangeBps = first.priceLamports > 0n ? (Number(last.priceLamports) / Number(first.priceLamports) - 1) * 10_000 : 0;
  const liquidityChangeBps =
    first.liquidityLamports > 0n ? (Number(last.liquidityLamports) / Number(first.liquidityLamports) - 1) * 10_000 : 0;

  const returns: number[] = [];
  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1];
    const current = history[index];
    if (previous !== undefined && current !== undefined && previous.priceLamports > 0n) {
      returns.push(Number(current.priceLamports) / Number(previous.priceLamports) - 1);
    }
  }
  const mean = returns.length === 0 ? 0 : returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.length === 0 ? 0 : returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const volatilityBps = Math.sqrt(variance) * 10_000;

  return { priceChangeBps, liquidityChangeBps, volatilityBps, sampleCount: history.length };
}

/**
 * The paper/live trading coordinator. It enforces every deterministic risk check
 * before execution, writes a write-ahead intent to the ledger, and fails closed on
 * any missing or ambiguous signal. In paper mode it uses only simulated fills.
 */
export class AutonomousTrader {
  private paused = false;
  private pauseReason: string | null = null;
  private killswitchLocked = false;
  private killswitchReason: string | null = null;
  private readonly events: TradeEvent[] = [];
  private readonly lastPrices = new Map<Mint, bigint>();
  private rpcFailureStreak = 0;
  private lastTickAt: string | null = null;
  private ticks = 0;

  constructor(
    private readonly config: TraderConfig,
    private readonly deps: TraderDeps
  ) {}

  pause(reason: string): void {
    if (!this.paused) {
      this.record("warn", "trading_paused", null, { reason });
    }
    this.paused = true;
    this.pauseReason = reason;
  }

  resume(): void {
    this.paused = false;
    this.pauseReason = null;
    this.record("info", "trading_resume_requested", null, { killswitchLocked: this.killswitchLocked });
  }

  panic(reason: string): void {
    this.pause(`panic:${reason}`);
  }

  /**
   * Restores portfolio accounting from a reconciled ledger snapshot. Only accepts a
   * snapshot produced by `reconcilePortfolioFromLedger`; invalid snapshots throw and
   * leave the current portfolio untouched.
   */
  restorePortfolio(snapshot: PortfolioSnapshot): void {
    this.deps.portfolio.restoreFromSnapshot(snapshot);
    this.record("info", "portfolio_restored", null, {
      cashLamports: snapshot.cashLamports.toString(),
      positions: snapshot.positions.length,
      realizedPnlLamports: snapshot.realizedPnlLamports.toString(),
      utcDay: snapshot.utcDay
    });
  }

  isPaused(): boolean {
    return this.paused;
  }

  getEvents(): readonly TradeEvent[] {
    return [...this.events];
  }

  status(): TraderStatus {
    const snapshot = this.deps.portfolio.snapshot();
    const equity = this.deps.portfolio.equityLamports(this.lastPrices);
    const positions = snapshot.positions.map((position) => ({
      mint: position.mint,
      symbol: position.symbol,
      quantityTokens: position.quantityTokens.toString(),
      averageEntryLamports: position.averageEntryLamports.toString(),
      markPriceLamports: (this.lastPrices.get(position.mint) ?? position.averageEntryLamports).toString(),
      openedAt: position.openedAt
    }));
    const paused = this.paused || this.killswitchLocked;
    return {
      mode: this.config.mode,
      network: this.config.network,
      paused,
      pauseReason: this.killswitchLocked ? this.killswitchReason : this.pauseReason,
      locked: this.killswitchLocked,
      lockReason: this.killswitchReason,
      lastTickAt: this.lastTickAt,
      ticks: this.ticks,
      rpcFailureStreak: this.rpcFailureStreak,
      openPositions: positions.length,
      cashLamports: snapshot.cashLamports.toString(),
      equityLamports: equity.toString(),
      realizedPnlLamports: snapshot.realizedPnlLamports.toString(),
      feesPaidLamports: snapshot.feesPaidLamports.toString(),
      dailyLossLamports: this.deps.portfolio.dailyLoss(equity).toString(),
      maxDailyLossLamports: this.deps.limits.maxDailyLossLamports.toString(),
      maxPositionLamports: this.deps.limits.maxPositionLamports.toString(),
      maxOpenPositions: this.deps.limits.maxOpenPositions,
      maxSlippageBps: this.deps.limits.maxSlippageBps,
      positions
    };
  }

  async writeHeartbeat(): Promise<void> {
    const status = this.status();
    const payload = {
      service: "backend",
      mode: status.mode,
      network: status.network,
      paused: status.paused,
      pauseReason: status.pauseReason,
      locked: status.locked,
      lockReason: status.lockReason,
      openPositions: status.openPositions,
      equityLamports: status.equityLamports,
      dailyLossLamports: status.dailyLossLamports,
      maxDailyLossLamports: status.maxDailyLossLamports,
      rpcFailureStreak: status.rpcFailureStreak,
      lastTickAt: status.lastTickAt,
      updatedAt: new Date().toISOString()
    };
    await mkdir(dirname(this.config.heartbeatPath), { recursive: true });
    await writeFile(this.config.heartbeatPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  async tick(): Promise<TickSummary> {
    const at = new Date().toISOString();
    this.ticks += 1;
    this.lastTickAt = at;
    let entries = 0;
    let exits = 0;
    let rejected = 0;

    const locked = await this.refreshKillswitch();
    if (this.paused || locked) {
      await this.writeHeartbeat();
      return { at, marketsObserved: 0, entries: 0, exits: 0, rejected: 0, paused: true };
    }

    const connectivity = await this.checkConnectivity();
    if (!connectivity) {
      return { at, marketsObserved: 0, entries: 0, exits: 0, rejected: 0, paused: this.paused };
    }

    const candidates = await this.collectCandidates();
    const equity = this.deps.portfolio.equityLamports(this.lastPrices);
    if (this.deps.portfolio.rollDayIfNeeded(equity)) {
      this.record("info", "utc_day_rolled", null, { equityLamports: equity.toString() });
    }

    const currentEquity = this.deps.portfolio.equityLamports(this.lastPrices);
    const dailyLoss = this.deps.portfolio.dailyLoss(currentEquity);
    let entriesAllowed = true;
    if (dailyLoss >= this.deps.limits.maxDailyLossLamports) {
      this.pause("daily_loss_limit_reached");
      entriesAllowed = false;
    }

    exits += await this.processExits(candidates);

    if (entriesAllowed && !this.paused) {
      const entryResult = await this.processEntries(candidates);
      entries += entryResult.entries;
      rejected += entryResult.rejected;
    }

    await this.writeHeartbeat();
    return { at, marketsObserved: candidates.length, entries, exits, rejected, paused: this.paused };
  }

  /**
   * Reads the durable independent killswitch lock. Unreadable or malformed state is
   * treated as locked (fail closed). The lock can only be cleared by the operator
   * writing an unlocked state; `resume()` cannot override it.
   */
  private async refreshKillswitch(): Promise<boolean> {
    let read: KillswitchLockRead;
    try {
      read = await readKillswitchLock(this.config.killswitchStatePath);
    } catch {
      read = { ok: false, error: "killswitch_state_unreadable" };
    }
    const locked = isKillswitchLocked(read);
    const reason = locked ? (read.ok ? `lock:${read.state.reason ?? "unspecified"}` : `lock:${read.error}`) : null;
    if (locked && !this.killswitchLocked) {
      this.record("error", "killswitch_locked", null, { reason: reason ?? "unknown" });
    }
    this.killswitchLocked = locked;
    this.killswitchReason = reason;
    return locked;
  }

  private async checkConnectivity(): Promise<boolean> {
    try {
      await this.deps.solana.getSlot();
      this.rpcFailureStreak = 0;
      return true;
    } catch (error) {
      this.rpcFailureStreak += 1;
      this.record("error", "rpc_connectivity_failed", null, {
        streak: this.rpcFailureStreak,
        error: error instanceof Error ? error.message : "unknown"
      });
      if (this.rpcFailureStreak >= this.config.maxRpcFailureStreak) {
        this.pause("rpc_failure_streak");
      }
      return false;
    }
  }

  private async collectCandidates(): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    for (const mint of this.config.markets) {
      try {
        const quote = await this.deps.market.getQuote(mint);
        const history = await this.deps.market.getHistory(mint);
        const facts = await this.deps.solana.getTokenFacts(mint);
        const simulation = await this.deps.solana.simulateSell(mint, 1n);
        this.lastPrices.set(mint, quote.priceLamports);
        candidates.push({ mint, quote, history, facts, simulation });
      } catch (error) {
        this.record("warn", "market_observation_failed", mint, {
          error: error instanceof Error ? error.message : "unknown"
        });
      }
    }
    return candidates;
  }

  private async processExits(candidates: readonly Candidate[]): Promise<number> {
    let exits = 0;
    const snapshot = this.deps.portfolio.snapshot();
    for (const position of snapshot.positions) {
      const candidate = candidates.find((entry) => entry.mint === position.mint);
      if (candidate === undefined) continue;
      const price = candidate.quote.priceLamports;
      const stopPrice = (position.averageEntryLamports * BigInt(10_000 - this.config.stopLossBps)) / 10_000n;
      const targetPrice = (position.averageEntryLamports * BigInt(10_000 + this.config.takeProfitBps)) / 10_000n;

      let reason: string | null = null;
      if (price <= stopPrice) reason = "stop_loss";
      else if (price >= targetPrice) reason = "take_profit";
      else {
        const regime = classifyMarketRegime(buildObservation(candidate.history)).regime;
        const signal = this.deps.strategy.evaluate({
          quote: candidate.quote,
          history: candidate.history,
          regime,
          hasOpenPosition: true
        });
        if (signal.action === "sell") reason = "strategy_exit";
      }
      if (reason === null) continue;

      if (this.config.safetyPolicy.requireSellSimulation && !candidate.simulation.passed) {
        this.record("error", "exit_blocked_sell_simulation", position.mint, { reason: candidate.simulation.reason });
        continue;
      }

      const executed = await this.executeOrder(candidate, "sell", position.quantityTokens, 0n, reason);
      if (executed) exits += 1;
    }
    return exits;
  }

  private async processEntries(candidates: readonly Candidate[]): Promise<{ entries: number; rejected: number }> {
    let entries = 0;
    let rejected = 0;
    for (const candidate of candidates) {
      if (this.deps.portfolio.getPosition(candidate.mint) !== undefined) continue;

      const safety = verifyTokenSafety(this.config.safetyPolicy, {
        mint: candidate.mint,
        facts: candidate.facts,
        liquidityLamports: candidate.quote.liquidityLamports,
        lpBurnedOrLocked: candidate.quote.lpBurnedOrLocked,
        sellSimulationPassed: candidate.simulation.passed
      });
      if (!safety.ok) {
        rejected += 1;
        this.record("warn", "entry_rejected_safety", candidate.mint, { reasons: safety.reasons.join(",") });
        continue;
      }

      const regime = classifyMarketRegime(buildObservation(candidate.history));
      const signal = this.deps.strategy.evaluate({
        quote: candidate.quote,
        history: candidate.history,
        regime: regime.regime,
        hasOpenPosition: false
      });
      if (signal.action !== "buy") continue;

      const proposedPositionLamports = computePositionSizeLamports({
        availableCashLamports: this.deps.portfolio.cashLamports(),
        maxPositionLamports: this.deps.limits.maxPositionLamports,
        confidenceBps: signal.confidenceBps
      });
      if (proposedPositionLamports <= 0n) continue;

      const currentEquity = this.deps.portfolio.equityLamports(this.lastPrices);
      const estimatedSlippageBps = estimateSlippageBps(proposedPositionLamports, candidate.quote.liquidityLamports);
      const decision = evaluateRisk(this.deps.limits, {
        proposedPositionLamports,
        dailyLossLamports: this.deps.portfolio.dailyLoss(currentEquity),
        openPositions: this.deps.portfolio.openPositionsCount(),
        proposedSlippageBps: estimatedSlippageBps,
        tradingPaused: this.paused || this.killswitchLocked
      });
      if (!decision.allowed) {
        rejected += 1;
        this.record("warn", "entry_rejected_risk", candidate.mint, { reasons: decision.reasons.join(",") });
        continue;
      }

      const executed = await this.executeOrder(candidate, "buy", 0n, proposedPositionLamports, "strategy_entry");
      if (executed) entries += 1;
    }
    return { entries, rejected };
  }

  private async executeOrder(
    candidate: Candidate,
    side: "buy" | "sell",
    quantityTokens: bigint,
    notionalLamports: bigint,
    reason: string
  ): Promise<boolean> {
    const idempotencyKey = newIdempotencyKey();
    const request = {
      mint: candidate.mint,
      symbol: candidate.quote.symbol,
      side,
      notionalLamports,
      quantityTokens,
      referencePriceLamports: candidate.quote.priceLamports,
      maxSlippageBps: this.deps.limits.maxSlippageBps,
      idempotencyKey
    };

    await this.deps.ledger.append({ type: "intent", data: { ...request, quantityTokens: quantityTokens.toString(), notionalLamports: notionalLamports.toString(), referencePriceLamports: candidate.quote.priceLamports.toString(), reason } });

    let result: ExecutionResult;
    try {
      result = await this.deps.executor.execute(request);
    } catch (error) {
      this.record("error", "execution_threw", candidate.mint, { error: error instanceof Error ? error.message : "unknown" });
      return false;
    }

    if (result.status !== "filled") {
      await this.deps.ledger.append({
        type: "reject",
        data: {
          mint: candidate.mint,
          side,
          status: result.status,
          reason: result.reason,
          quantityTokens: result.quantityTokens.toString(),
          priceLamports: result.priceLamports.toString(),
          notionalLamports: result.notionalLamports.toString(),
          feeLamports: result.feeLamports.toString(),
          txRef: result.txRef
        }
      });
      this.record("warn", "execution_rejected", candidate.mint, { reason: result.reason });
      return false;
    }

    // Update the portfolio first. Portfolio methods validate before mutating, so a
    // throw means no state change. Only a confirmed portfolio update is recorded as
    // a fill; otherwise a compensating reject is written so the ledger never shows a
    // fill for a position that was not applied.
    try {
      if (side === "buy") {
        this.deps.portfolio.applyBuy(candidate.mint, candidate.quote.symbol, result.quantityTokens, result.priceLamports, result.feeLamports);
      } else {
        this.deps.portfolio.applySell(candidate.mint, result.quantityTokens, result.priceLamports, result.feeLamports);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      this.record("error", "portfolio_update_failed", candidate.mint, { error: detail, idempotencyKey });
      await this.deps.ledger.append({
        type: "reject",
        data: { mint: candidate.mint, side, status: "rejected", reason: `portfolio_update_failed:${detail}`, idempotencyKey }
      });
      return false;
    }

    await this.deps.ledger.append({
      type: "fill",
      data: {
        mint: candidate.mint,
        side,
        status: result.status,
        reason: result.reason,
        quantityTokens: result.quantityTokens.toString(),
        priceLamports: result.priceLamports.toString(),
        notionalLamports: result.notionalLamports.toString(),
        feeLamports: result.feeLamports.toString(),
        txRef: result.txRef
      }
    });

    this.record("info", side === "buy" ? "entry_filled" : "exit_filled", candidate.mint, {
      reason,
      quantityTokens: result.quantityTokens.toString(),
      priceLamports: result.priceLamports.toString(),
      feeLamports: result.feeLamports.toString(),
      txRef: result.txRef ?? "none"
    });
    return true;
  }

  private record(level: TradeEvent["level"], action: string, mint: Mint | null, detail: TradeEvent["detail"]): void {
    const event: TradeEvent = { at: new Date().toISOString(), level, action, mint, detail };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    const fields = { action, mint: mint ?? "none", ...detail };
    const message = `event:${action}`;
    if (level === "error") this.deps.logger.error(fields, message);
    else if (level === "warn") this.deps.logger.warn(fields, message);
    else this.deps.logger.info(fields, message);
  }
}
