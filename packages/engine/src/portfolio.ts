import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { dailyLossLamports } from "@solana-system/risk";
import type { Ledger, LedgerEntry, Mint, PortfolioSnapshot, Position } from "./types.js";

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * In-memory portfolio and position tracker. All accounting is integer-only using
 * bigint lamports and whole-token quantities. It never touches the network.
 */
export class Portfolio {
  private cash: bigint;
  private realizedPnl = 0n;
  private feesPaid = 0n;
  private dayStartEquity: bigint;
  private currentUtcDay: string;
  private readonly positionMap = new Map<Mint, Position>();

  constructor(initialCashLamports: bigint, now: Date = new Date()) {
    if (initialCashLamports < 0n) throw new Error("Initial cash must not be negative.");
    this.cash = initialCashLamports;
    this.dayStartEquity = initialCashLamports;
    this.currentUtcDay = utcDay(now);
  }

  snapshot(): PortfolioSnapshot {
    return {
      cashLamports: this.cash,
      positions: [...this.positionMap.values()],
      realizedPnlLamports: this.realizedPnl,
      feesPaidLamports: this.feesPaid,
      dayStartEquityLamports: this.dayStartEquity,
      utcDay: this.currentUtcDay
    };
  }

  cashLamports(): bigint {
    return this.cash;
  }

  getPosition(mint: Mint): Position | undefined {
    return this.positionMap.get(mint);
  }

  openPositionsCount(): number {
    return this.positionMap.size;
  }

  equityLamports(prices: ReadonlyMap<Mint, bigint>): bigint {
    let equity = this.cash;
    for (const position of this.positionMap.values()) {
      const price = prices.get(position.mint) ?? position.averageEntryLamports;
      equity += position.quantityTokens * price;
    }
    return equity;
  }

  dailyLoss(equity: bigint): bigint {
    return dailyLossLamports(this.dayStartEquity, equity);
  }

  rollDayIfNeeded(equity: bigint, now: Date = new Date()): boolean {
    const today = utcDay(now);
    if (today === this.currentUtcDay) return false;
    this.currentUtcDay = today;
    this.dayStartEquity = equity;
    return true;
  }

  applyBuy(mint: Mint, symbol: string, quantityTokens: bigint, priceLamports: bigint, feeLamports: bigint, now: Date = new Date()): void {
    if (quantityTokens <= 0n) throw new Error("Buy quantity must be positive.");
    if (priceLamports <= 0n) throw new Error("Buy price must be positive.");
    const cost = quantityTokens * priceLamports + feeLamports;
    if (cost > this.cash) throw new Error("Insufficient cash for buy.");
    this.cash -= cost;
    this.feesPaid += feeLamports;

    const existing = this.positionMap.get(mint);
    if (existing === undefined) {
      this.positionMap.set(mint, {
        mint,
        symbol,
        quantityTokens,
        averageEntryLamports: priceLamports,
        openedAt: now.toISOString()
      });
      return;
    }
    const totalQuantity = existing.quantityTokens + quantityTokens;
    const weighted = existing.averageEntryLamports * existing.quantityTokens + priceLamports * quantityTokens;
    this.positionMap.set(mint, {
      mint,
      symbol,
      quantityTokens: totalQuantity,
      averageEntryLamports: weighted / totalQuantity,
      openedAt: existing.openedAt
    });
  }

  applySell(mint: Mint, quantityTokens: bigint, priceLamports: bigint, feeLamports: bigint): bigint {
    const existing = this.positionMap.get(mint);
    if (existing === undefined) throw new Error(`No open position for ${mint}.`);
    if (quantityTokens <= 0n || quantityTokens > existing.quantityTokens) {
      throw new Error("Sell quantity must be positive and no greater than the open position.");
    }
    const proceeds = quantityTokens * priceLamports - feeLamports;
    this.cash += proceeds;
    this.feesPaid += feeLamports;
    const realized = (priceLamports - existing.averageEntryLamports) * quantityTokens - feeLamports;
    this.realizedPnl += realized;
    const remaining = existing.quantityTokens - quantityTokens;
    if (remaining === 0n) {
      this.positionMap.delete(mint);
    } else {
      this.positionMap.set(mint, { ...existing, quantityTokens: remaining });
    }
    return realized;
  }
}

export class MemoryLedger implements Ledger {
  private readonly entries: LedgerEntry[] = [];

  async append(entry: Omit<LedgerEntry, "id" | "at">): Promise<LedgerEntry> {
    const stored: LedgerEntry = { ...entry, id: randomUUID(), at: new Date().toISOString() };
    this.entries.push(stored);
    return stored;
  }

  async readAll(): Promise<readonly LedgerEntry[]> {
    return [...this.entries];
  }
}

/** Append-only JSONL ledger. A write-ahead intent is flushed before execution. */
export class FileLedger implements Ledger {
  constructor(private readonly filePath: string) {}

  async append(entry: Omit<LedgerEntry, "id" | "at">): Promise<LedgerEntry> {
    const stored: LedgerEntry = { ...entry, id: randomUUID(), at: new Date().toISOString() };
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(stored)}\n`, "utf8");
    return stored;
  }

  async readAll(): Promise<readonly LedgerEntry[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return raw
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as LedgerEntry);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}
