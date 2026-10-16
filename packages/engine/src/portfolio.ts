import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { dailyLossLamports } from "@solana-system/risk";
import type { Ledger, LedgerEntry, Mint, PortfolioSnapshot, Position } from "./types.js";

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** Genesis link for the ledger hash chain. */
export const LEDGER_GENESIS_HASH = "0".repeat(64);

/** Deterministic JSON with object keys sorted, so a re-parse hashes identically. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function computeLedgerHash(prevHash: string, entry: Omit<LedgerEntry, "hash" | "prevHash">): string {
  const body = canonicalize({ id: entry.id, at: entry.at, type: entry.type, data: entry.data });
  return createHash("sha256").update(prevHash).update("\n").update(body).digest("hex");
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

  /**
   * Replaces all portfolio state with a reconciled snapshot. This is used to restore
   * accounting from the append-only ledger on startup. The snapshot is validated
   * before any state changes, so an invalid snapshot leaves the portfolio untouched.
   */
  restoreFromSnapshot(snapshot: PortfolioSnapshot): void {
    if (snapshot.cashLamports < 0n) throw new Error("Snapshot cash must not be negative.");
    if (snapshot.feesPaidLamports < 0n) throw new Error("Snapshot fees must not be negative.");
    if (snapshot.dayStartEquityLamports < 0n) throw new Error("Snapshot day-start equity must not be negative.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.utcDay)) throw new Error("Snapshot utcDay must be YYYY-MM-DD.");

    const restored = new Map<Mint, Position>();
    for (const position of snapshot.positions) {
      if (position.mint.trim() === "") throw new Error("Snapshot position mint must not be empty.");
      if (restored.has(position.mint)) throw new Error(`Snapshot has duplicate position for ${position.mint}.`);
      if (position.quantityTokens <= 0n) throw new Error("Snapshot position quantity must be positive.");
      if (position.averageEntryLamports <= 0n) throw new Error("Snapshot position entry price must be positive.");
      restored.set(position.mint, { ...position });
    }

    this.cash = snapshot.cashLamports;
    this.realizedPnl = snapshot.realizedPnlLamports;
    this.feesPaid = snapshot.feesPaidLamports;
    this.dayStartEquity = snapshot.dayStartEquityLamports;
    this.currentUtcDay = snapshot.utcDay;
    this.positionMap.clear();
    for (const [mint, position] of restored) this.positionMap.set(mint, position);
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
  private lastHash: string | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  append(entry: Omit<LedgerEntry, "id" | "at">): Promise<LedgerEntry> {
    const run = this.tail.then(() => this.appendChained(entry));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async appendChained(entry: Omit<LedgerEntry, "id" | "at">): Promise<LedgerEntry> {
    const prevHash = this.lastHash ?? (await this.readTailHash());
    const base: Omit<LedgerEntry, "hash" | "prevHash"> = { ...entry, id: randomUUID(), at: new Date().toISOString() };
    const stored: LedgerEntry = { ...base, prevHash, hash: computeLedgerHash(prevHash, base) };
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await appendFile(this.filePath, `${JSON.stringify(stored)}\n`, { encoding: "utf8", mode: 0o600 });
    this.lastHash = stored.hash ?? prevHash;
    return stored;
  }

  private async readTailHash(): Promise<string> {
    const entries = await this.readAll();
    const last = entries[entries.length - 1];
    this.lastHash = last?.hash ?? LEDGER_GENESIS_HASH;
    return this.lastHash;
  }

  /**
   * Reads and verifies the ledger. The hash chain is recomputed for every line, so
   * a truncated, reordered or edited entry is rejected. This is tamper-evident
   * (not tamper-proof) against accidental corruption and naive injection; a writer
   * with full file access can still rewrite the chain, which is why the file is
   * created `0600`.
   */
  async readAll(): Promise<readonly LedgerEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }

    const entries: LedgerEntry[] = [];
    let previous = LEDGER_GENESIS_HASH;
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      const parsed = JSON.parse(line) as LedgerEntry;
      if (typeof parsed.hash !== "string" || typeof parsed.prevHash !== "string") {
        throw new Error("Ledger entry is missing its hash chain; refusing to trust the ledger.");
      }
      if (parsed.prevHash !== previous) {
        throw new Error("Ledger hash chain is broken; refusing to trust the ledger.");
      }
      if (computeLedgerHash(parsed.prevHash, parsed) !== parsed.hash) {
        throw new Error("Ledger entry hash does not match its contents; refusing to trust the ledger.");
      }
      previous = parsed.hash;
      entries.push(parsed);
    }
    return entries;
  }
}
