import assert from "node:assert/strict";
import test from "node:test";
import { MemoryLedger, Portfolio } from "../src/index.js";

test("tracks cash, positions and realized PnL across a round trip", () => {
  const portfolio = new Portfolio(1_000_000n);
  portfolio.applyBuy("mintA", "AAA", 100n, 100n, 10n);
  assert.equal(portfolio.cashLamports(), 1_000_000n - (100n * 100n + 10n));
  assert.equal(portfolio.openPositionsCount(), 1);
  assert.equal(portfolio.getPosition("mintA")?.quantityTokens, 100n);

  const realized = portfolio.applySell("mintA", 100n, 120n, 12n);
  assert.equal(realized, (120n - 100n) * 100n - 12n);
  assert.equal(portfolio.openPositionsCount(), 0);
  assert.equal(portfolio.snapshot().realizedPnlLamports, realized);
});

test("computes equity and daily loss from mark prices", () => {
  const portfolio = new Portfolio(1_000_000n);
  portfolio.applyBuy("mintA", "AAA", 1000n, 500n, 0n);
  const prices = new Map([["mintA", 400n]]);
  assert.equal(portfolio.equityLamports(prices), 1_000_000n - 500_000n + 400_000n);
  assert.equal(portfolio.dailyLoss(portfolio.equityLamports(prices)), 100_000n);
});

test("rolls the UTC day and resets the loss baseline", () => {
  const portfolio = new Portfolio(1_000_000n, new Date("2026-01-01T12:00:00Z"));
  assert.equal(portfolio.rollDayIfNeeded(900_000n, new Date("2026-01-02T00:01:00Z")), true);
  assert.equal(portfolio.dailyLoss(900_000n), 0n);
});

test("rejects a buy when cash is insufficient", () => {
  const portfolio = new Portfolio(100n);
  assert.throws(() => portfolio.applyBuy("mintA", "AAA", 100n, 10n, 0n), /Insufficient cash/);
});

test("restores a reconciled snapshot and refuses invalid ones", () => {
  const portfolio = new Portfolio(1_000n);
  portfolio.restoreFromSnapshot({
    cashLamports: 500n,
    positions: [{ mint: "mintA", symbol: "AAA", quantityTokens: 7n, averageEntryLamports: 50n, openedAt: "2026-01-01T00:00:00.000Z" }],
    realizedPnlLamports: -10n,
    feesPaidLamports: 3n,
    dayStartEquityLamports: 1_000n,
    utcDay: "2026-01-02"
  });
  assert.equal(portfolio.cashLamports(), 500n);
  assert.equal(portfolio.openPositionsCount(), 1);
  assert.equal(portfolio.getPosition("mintA")?.quantityTokens, 7n);
  assert.equal(portfolio.snapshot().utcDay, "2026-01-02");

  assert.throws(
    () =>
      portfolio.restoreFromSnapshot({
        cashLamports: -1n,
        positions: [],
        realizedPnlLamports: 0n,
        feesPaidLamports: 0n,
        dayStartEquityLamports: 0n,
        utcDay: "2026-01-02"
      }),
    /must not be negative/
  );
  assert.equal(portfolio.cashLamports(), 500n);
});

test("memory ledger appends immutable entries with ids", async () => {
  const ledger = new MemoryLedger();
  const first = await ledger.append({ type: "intent", data: { side: "buy" } });
  const second = await ledger.append({ type: "fill", data: { side: "buy" } });
  assert.notEqual(first.id, second.id);
  assert.equal((await ledger.readAll()).length, 2);
});
