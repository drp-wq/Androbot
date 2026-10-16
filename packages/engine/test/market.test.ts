import assert from "node:assert/strict";
import test from "node:test";
import { HttpMarketDataSource, PAPER_MARKETS, SimulatedMarketDataSource } from "../src/index.js";

const MINT = PAPER_MARKETS[0]?.mint ?? "So11111111111111111111111111111111111111112";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

test("simulated market feed is deterministic for a fixed seed", async () => {
  const first = new SimulatedMarketDataSource(7, 1_700_000_000_000);
  const second = new SimulatedMarketDataSource(7, 1_700_000_000_000);
  assert.deepEqual(await first.listMarkets(), PAPER_MARKETS.map((market) => market.mint));
  assert.deepEqual(await first.getHistory(MINT), await second.getHistory(MINT));
  await assert.rejects(() => first.getQuote("unknown"), /Unknown simulated market/);
});

test("HTTP market feed parses a valid quote", async () => {
  const feed = new HttpMarketDataSource({
    id: "http",
    baseUrl: "http://feed.invalid",
    markets: [MINT],
    fetchImpl: (async () =>
      jsonResponse({ symbol: "WSOL", priceLamports: "1000", liquidityLamports: 5000, lpBurnedOrLocked: true })) as unknown as typeof fetch
  });
  const quote = await feed.getQuote(MINT);
  assert.equal(quote.priceLamports, 1000n);
  assert.equal(quote.liquidityLamports, 5000n);
  assert.equal(quote.lpBurnedOrLocked, true);
});

test("HTTP market feed fails closed on malformed or failed payloads", async () => {
  const malformed = new HttpMarketDataSource({
    id: "http",
    baseUrl: "http://feed.invalid",
    markets: [MINT],
    fetchImpl: (async () => jsonResponse({ priceLamports: "not-a-number" })) as unknown as typeof fetch
  });
  await assert.rejects(() => malformed.getQuote(MINT), /missing a valid price or liquidity/);

  const failing = new HttpMarketDataSource({
    id: "http",
    baseUrl: "http://feed.invalid",
    markets: [MINT],
    fetchImpl: (async () => jsonResponse({}, false, 503)) as unknown as typeof fetch
  });
  await assert.rejects(() => failing.getQuote(MINT), /responded 503/);

  const badHistory = new HttpMarketDataSource({
    id: "http",
    baseUrl: "http://feed.invalid",
    markets: [MINT],
    fetchImpl: (async () => jsonResponse([{ priceLamports: "10", liquidityLamports: "20", at: 5 }])) as unknown as typeof fetch
  });
  await assert.rejects(() => badHistory.getHistory(MINT), /malformed/);
});
