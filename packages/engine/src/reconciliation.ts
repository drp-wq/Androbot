import { Portfolio } from "./portfolio.js";
import type { Ledger, LedgerEntry, Mint, PortfolioSnapshot } from "./types.js";

export interface LedgerReconciliationOptions {
  readonly ledger: Ledger;
  readonly startingCashLamports: bigint;
}

/**
 * Outcome of replaying the append-only ledger into a fresh portfolio. `ok: false`
 * carries at least one problem and always means "do not trade with this state".
 */
export interface LedgerReconciliationResult {
  readonly ok: boolean;
  readonly entriesRead: number;
  readonly fillsApplied: number;
  readonly duplicatesSkipped: number;
  readonly problems: readonly string[];
  readonly lastEntryAt: string | null;
  readonly snapshot: PortfolioSnapshot | null;
}

interface ParsedFill {
  readonly mint: Mint;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly quantityTokens: bigint;
  readonly priceLamports: bigint;
  readonly feeLamports: bigint;
}

function parseUnsigned(value: unknown, allowZero: boolean): bigint | null {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = BigInt(value);
    if (parsed > 0n || (allowZero && parsed === 0n)) return parsed;
    return null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    const parsed = BigInt(value);
    if (parsed > 0n || (allowZero && parsed === 0n)) return parsed;
  }
  return null;
}

function parseFill(entry: LedgerEntry): ParsedFill | null {
  const data = entry.data;
  const mint = data["mint"];
  const side = data["side"];
  if (typeof mint !== "string" || mint.trim() === "") return null;
  if (side !== "buy" && side !== "sell") return null;
  const quantityTokens = parseUnsigned(data["quantityTokens"], false);
  const priceLamports = parseUnsigned(data["priceLamports"], false);
  const feeLamports = data["feeLamports"] === undefined ? 0n : parseUnsigned(data["feeLamports"], true);
  if (quantityTokens === null || priceLamports === null || feeLamports === null) return null;
  const symbol = typeof data["symbol"] === "string" && data["symbol"].trim() !== "" ? data["symbol"] : mint.slice(0, 6);
  return { mint, symbol, side, quantityTokens, priceLamports, feeLamports };
}

/**
 * Replays an append-only ledger into a fresh `Portfolio` so paper accounting can
 * survive a restart. The replay is read-only and offline: it never executes, signs
 * or submits anything.
 *
 * Fail-closed rules:
 * - Any unreadable ledger, malformed fill, or fill that violates portfolio
 *   invariants (insufficient cash, sell without a position) stops the replay and
 *   returns `ok: false` with an empty snapshot. Callers must not trade in that case.
 * - Entries without a parseable timestamp are rejected because day accounting
 *   (daily-loss baseline) depends on them.
 * - Duplicate entry ids are skipped, so an idempotently re-written ledger line
 *   cannot be applied twice.
 */
export async function reconcilePortfolioFromLedger(
  options: LedgerReconciliationOptions
): Promise<LedgerReconciliationResult> {
  const problems: string[] = [];
  const fail = (problem: string): LedgerReconciliationResult => ({
    ok: false,
    entriesRead: 0,
    fillsApplied: 0,
    duplicatesSkipped: 0,
    problems: [...problems, problem],
    lastEntryAt: null,
    snapshot: null
  });

  let entries: readonly LedgerEntry[];
  try {
    entries = await options.ledger.readAll();
  } catch (error) {
    return fail(`ledger_unreadable:${error instanceof Error ? error.message : "unknown"}`);
  }

  const seenIds = new Set<string>();
  const ordered: { readonly entry: LedgerEntry; readonly at: Date }[] = [];
  let lastEntryAt: string | null = null;
  let duplicatesSkipped = 0;

  for (const entry of entries) {
    const at = new Date(entry.at);
    if (Number.isNaN(at.getTime())) {
      return fail(`entry_timestamp_invalid:${entry.id}`);
    }
    if (lastEntryAt === null || entry.at > lastEntryAt) lastEntryAt = entry.at;
    if (seenIds.has(entry.id)) {
      duplicatesSkipped += 1;
      continue;
    }
    seenIds.add(entry.id);
    ordered.push({ entry, at });
  }

  const firstAt = ordered[0]?.at ?? new Date();
  const portfolio = new Portfolio(options.startingCashLamports, firstAt);
  const lastPrices = new Map<Mint, bigint>();
  let fillsApplied = 0;

  for (const { entry, at } of ordered) {
    if (entry.type !== "fill") continue;
    const fill = parseFill(entry);
    if (fill === null) {
      return fail(`fill_malformed:${entry.id}`);
    }
    portfolio.rollDayIfNeeded(portfolio.equityLamports(lastPrices), at);
    try {
      if (fill.side === "buy") {
        portfolio.applyBuy(fill.mint, fill.symbol, fill.quantityTokens, fill.priceLamports, fill.feeLamports, at);
      } else {
        portfolio.applySell(fill.mint, fill.quantityTokens, fill.priceLamports, fill.feeLamports);
      }
    } catch (error) {
      return fail(`fill_rejected:${entry.id}:${error instanceof Error ? error.message : "unknown"}`);
    }
    lastPrices.set(fill.mint, fill.priceLamports);
    fillsApplied += 1;
  }

  return {
    ok: true,
    entriesRead: entries.length,
    fillsApplied,
    duplicatesSkipped,
    problems,
    lastEntryAt,
    snapshot: portfolio.snapshot()
  };
}
