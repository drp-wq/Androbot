import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLedger, Portfolio, reconcilePortfolioFromLedger } from "../src/index.js";
import type { Ledger, LedgerEntry } from "../src/index.js";

class ScriptedLedger implements Ledger {
  constructor(private readonly entries: readonly LedgerEntry[]) {}

  async append(entry: Omit<LedgerEntry, "id" | "at">): Promise<LedgerEntry> {
    const stored: LedgerEntry = { ...entry, id: `scripted-${this.entries.length}`, at: new Date().toISOString() };
    return stored;
  }

  async readAll(): Promise<readonly LedgerEntry[]> {
    return this.entries;
  }
}

function entry(
  id: string,
  at: string,
  type: LedgerEntry["type"],
  data: Readonly<Record<string, unknown>>
): LedgerEntry {
  return { id, at, type, data };
}

function fill(at: string, overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    mint: "mintA",
    symbol: "AAA",
    side: "buy",
    quantityTokens: "100",
    priceLamports: "100",
    feeLamports: "5",
    ...overrides
  };
}

test("replays fills into the same snapshot as live application", async () => {
  const ledger = new MemoryLedger();
  await ledger.append({ type: "fill", data: fill(new Date().toISOString(), {}) });
  await ledger.append({
    type: "fill",
    data: fill(new Date().toISOString(), { side: "sell", quantityTokens: "40", priceLamports: "120", feeLamports: "3" })
  });
  await ledger.append({ type: "intent", data: { side: "buy" } });
  await ledger.append({ type: "reject", data: { reason: "nope" } });

  const result = await reconcilePortfolioFromLedger({ ledger, startingCashLamports: 1_000_000n });
  assert.equal(result.ok, true);
  assert.equal(result.fillsApplied, 2);
  assert.equal(result.problems.length, 0);

  const live = new Portfolio(1_000_000n);
  live.applyBuy("mintA", "AAA", 100n, 100n, 5n);
  live.applySell("mintA", 40n, 120n, 3n);
  const expected = live.snapshot();
  const normalized = {
    ...result.snapshot,
    positions: result.snapshot?.positions.map((position) => ({ ...position, openedAt: "ignored" }))
  };
  assert.deepEqual(normalized, { ...expected, positions: expected.positions.map((position) => ({ ...position, openedAt: "ignored" })) });
});

test("an empty ledger reconciles to the starting cash snapshot", async () => {
  const ledger = new MemoryLedger();
  const result = await reconcilePortfolioFromLedger({ ledger, startingCashLamports: 500n });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot?.cashLamports, 500n);
  assert.deepEqual(result.snapshot?.positions, []);
  assert.equal(result.entriesRead, 0);
});

test("skips duplicate entry ids instead of applying a fill twice", async () => {
  const at = new Date().toISOString();
  const duplicated = entry("dup-1", at, "fill", fill(at));
  const ledger = new ScriptedLedger([duplicated, duplicated]);
  const result = await reconcilePortfolioFromLedger({ ledger, startingCashLamports: 1_000_000n });
  assert.equal(result.ok, true);
  assert.equal(result.fillsApplied, 1);
  assert.equal(result.duplicatesSkipped, 1);
  assert.equal(result.snapshot?.cashLamports, 1_000_000n - (100n * 100n + 5n));
});

test("fails closed on a malformed fill and returns no snapshot", async () => {
  const at = new Date().toISOString();
  const ledger = new ScriptedLedger([
    entry("ok-1", at, "fill", fill(at)),
    entry("bad-1", at, "fill", fill(at, { quantityTokens: "not-a-number" })),
    entry("ok-2", at, "fill", fill(at))
  ]);
  const result = await reconcilePortfolioFromLedger({ ledger, startingCashLamports: 1_000_000n });
  assert.equal(result.ok, false);
  assert.equal(result.snapshot, null);
  assert.ok(result.problems.some((problem) => problem.startsWith("fill_malformed:bad-1")));
});

test("fails closed on a sell without an open position", async () => {
  const at = new Date().toISOString();
  const ledger = new ScriptedLedger([
    entry("sell-1", at, "fill", fill(at, { side: "sell", quantityTokens: "10", priceLamports: "100" }))
  ]);
  const result = await reconcilePortfolioFromLedger({ ledger, startingCashLamports: 1_000_000n });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.startsWith("fill_rejected:sell-1")));
});

test("fails closed on an unparseable timestamp", async () => {
  const ledger = new ScriptedLedger([entry("bad-time", "not-a-date", "fill", fill("not-a-date"))]);
  const result = await reconcilePortfolioFromLedger({ ledger, startingCashLamports: 1_000_000n });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.startsWith("entry_timestamp_invalid:bad-time")));
});

test("fails closed when the ledger cannot be read", async () => {
  const ledger: Ledger = {
    append: async (input) => ({ ...input, id: "x", at: new Date().toISOString() }),
    readAll: async () => {
      throw new Error("disk gone");
    }
  };
  const result = await reconcilePortfolioFromLedger({ ledger, startingCashLamports: 1_000_000n });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.startsWith("ledger_unreadable")));
});

test("rolls the daily-loss baseline across day boundaries during replay", async () => {
  const ledger = new ScriptedLedger([
    entry("buy-day1", "2026-01-01T10:00:00.000Z", "fill", fill("2026-01-01T10:00:00.000Z", { quantityTokens: "100", priceLamports: "100", feeLamports: "0" })),
    entry("sell-day2", "2026-01-02T10:00:00.000Z", "fill", fill("2026-01-02T10:00:00.000Z", { side: "sell", quantityTokens: "100", priceLamports: "80", feeLamports: "0" }))
  ]);
  const result = await reconcilePortfolioFromLedger({ ledger, startingCashLamports: 100_000n });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot?.utcDay, "2026-01-02");
  // The day rolled before the day-2 sell. Equity at the start of day 2 marks the open
  // position at its last known fill price (90,000 cash + 10,000 position = 100,000).
  assert.equal(result.snapshot?.dayStartEquityLamports, 100_000n);
  assert.equal(result.snapshot?.realizedPnlLamports, -2_000n);
});

test("reports the last entry timestamp across all entry types", async () => {
  const ledger = new ScriptedLedger([
    entry("e1", "2026-01-01T10:00:00.000Z", "intent", {}),
    entry("e2", "2026-01-01T11:00:00.000Z", "fill", fill("2026-01-01T11:00:00.000Z")),
    entry("e3", "2026-01-01T12:00:00.000Z", "event", { action: "something" })
  ]);
  const result = await reconcilePortfolioFromLedger({ ledger, startingCashLamports: 1_000_000n });
  assert.equal(result.lastEntryAt, "2026-01-01T12:00:00.000Z");
});
