import assert from "node:assert/strict";
import test from "node:test";
import { MomentumStrategy, type MarketQuote, type PricePoint } from "../src/index.js";

const mint = "So11111111111111111111111111111111111111112";

function history(prices: readonly number[]): PricePoint[] {
  return prices.map((price, index) => ({
    at: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
    priceLamports: BigInt(price),
    liquidityLamports: 1_000_000n
  }));
}

const quote: MarketQuote = {
  mint,
  symbol: "wSOL",
  priceLamports: 100n,
  liquidityLamports: 1_000_000n,
  lpBurnedOrLocked: true,
  updatedAt: new Date(1_700_000_000_000).toISOString()
};

test("holds when there is not enough history", () => {
  const signal = new MomentumStrategy().evaluate({
    quote,
    history: history([100, 101, 102]),
    regime: "risk_on",
    hasOpenPosition: false
  });
  assert.equal(signal.action, "hold");
  assert.deepEqual(signal.reasons, ["insufficient_history"]);
});

test("buys on an uptrend in a risk-on regime", () => {
  const signal = new MomentumStrategy().evaluate({
    quote,
    history: history([100, 100, 100, 100, 100, 100, 100, 100, 100, 120, 130, 140]),
    regime: "risk_on",
    hasOpenPosition: false
  });
  assert.equal(signal.action, "buy");
});

test("never buys in a risk-off regime", () => {
  const signal = new MomentumStrategy().evaluate({
    quote,
    history: history([100, 100, 100, 100, 100, 100, 100, 100, 100, 120, 130, 140]),
    regime: "risk_off",
    hasOpenPosition: false
  });
  assert.notEqual(signal.action, "buy");
});

test("sells an open position on a downtrend", () => {
  const signal = new MomentumStrategy().evaluate({
    quote,
    history: history([140, 130, 120, 110, 105, 100, 95, 90, 85, 80, 75, 70]),
    regime: "uncertain",
    hasOpenPosition: true
  });
  assert.equal(signal.action, "sell");
});
