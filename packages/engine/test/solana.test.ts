import assert from "node:assert/strict";
import test from "node:test";
import { PAPER_MARKETS, PaperSolanaClient, RpcSolanaClient } from "../src/index.js";

const MINT = PAPER_MARKETS[0]?.mint ?? "So11111111111111111111111111111111111111112";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function rpcFetch(handlers: Record<string, (params: readonly unknown[]) => unknown>): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as { method: string; params: readonly unknown[] };
    const handler = handlers[request.method];
    if (handler === undefined) return jsonResponse({ error: { message: `no handler for ${request.method}` } });
    return jsonResponse({ result: handler(request.params) });
  }) as unknown as typeof fetch;
}

test("paper Solana client reports synthetic facts and fails closed on unknown mints", async () => {
  const client = new PaperSolanaClient();
  const facts = await client.getTokenFacts(MINT);
  assert.equal(facts.mintAuthorityRevoked, true);
  assert.equal(facts.freezeAuthorityRevoked, true);
  await assert.rejects(() => client.getTokenFacts("unknown-mint"), /Unknown paper mint/);
  assert.equal((await client.simulateSell(MINT, 0n)).passed, false);
  assert.equal((await client.simulateSell(MINT, 1n)).passed, true);
});

test("RPC client rejects live sell simulation (not implemented)", async () => {
  const client = new RpcSolanaClient({ id: "rpc", rpcUrl: "http://rpc.invalid", fetchImpl: rpcFetch({}) });
  const simulation = await client.simulateSell(MINT, 1n);
  assert.equal(simulation.passed, false);
  assert.equal(simulation.reason, "live_simulation_not_implemented");
});

test("RPC client parses slot, balance and mint facts", async () => {
  const client = new RpcSolanaClient({
    id: "rpc",
    rpcUrl: "http://rpc.invalid",
    fetchImpl: rpcFetch({
      getSlot: () => 42,
      getBalance: () => ({ value: 1234 }),
      getAccountInfo: () => ({
        value: { data: { parsed: { info: { decimals: 9, mintAuthority: null, freezeAuthority: null } } } }
      }),
      getTokenLargestAccounts: () => ({ value: [{ amount: "2500" }] }),
      getTokenSupply: () => ({ value: { amount: "10000" } })
    })
  });
  assert.equal(await client.getSlot(), 42);
  assert.equal(await client.getBalanceLamports("any"), 1234n);
  const facts = await client.getTokenFacts(MINT);
  assert.equal(facts.decimals, 9);
  assert.equal(facts.mintAuthorityRevoked, true);
  assert.equal(facts.holderConcentrationBps, 2500);
});

test("RPC client fails closed on malformed responses", async () => {
  const badSlot = new RpcSolanaClient({
    id: "rpc",
    rpcUrl: "http://rpc.invalid",
    fetchImpl: rpcFetch({ getSlot: () => "not-a-number" })
  });
  await assert.rejects(() => badSlot.getSlot(), /Invalid slot response/);

  const badMint = new RpcSolanaClient({
    id: "rpc",
    rpcUrl: "http://rpc.invalid",
    fetchImpl: rpcFetch({ getAccountInfo: () => ({ value: {} }) })
  });
  await assert.rejects(() => badMint.getTokenFacts(MINT), /not a parseable token mint/);

  const http500 = new RpcSolanaClient({
    id: "rpc",
    rpcUrl: "http://rpc.invalid",
    fetchImpl: (async () => jsonResponse({}, false, 500)) as unknown as typeof fetch
  });
  await assert.rejects(() => http500.getSlot(), /RPC responded 500/);
});
