import { PAPER_MARKETS } from "./market.js";
import { fetchWithRetry, parseJsonWithLimit, resolveHttpPolicy, type HttpPolicy } from "./http.js";
import type { Mint, SellSimulation, SolanaClient, TokenAccountFacts } from "./types.js";

const PAPER_DECIMALS: Record<Mint, number> = {
  [PAPER_MARKETS[0]?.mint ?? "So11111111111111111111111111111111111111112"]: 9,
  [PAPER_MARKETS[1]?.mint ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]: 6,
  [PAPER_MARKETS[2]?.mint ?? "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"]: 5
};

/**
 * Offline Solana substitute used in paper mode. It returns deterministic, clearly
 * synthetic facts and never contacts a network or signs a transaction.
 */
export class PaperSolanaClient implements SolanaClient {
  readonly id = "paper-solana";
  readonly isLive = false;
  private slot = 100_000_000;

  async getSlot(): Promise<number> {
    this.slot += 1;
    return this.slot;
  }

  async getBalanceLamports(_publicKey: string): Promise<bigint> {
    return 0n;
  }

  async getTokenFacts(mint: Mint): Promise<TokenAccountFacts> {
    const known = PAPER_MARKETS.some((market) => market.mint === mint);
    if (!known) throw new Error(`Unknown paper mint ${mint}.`);
    return {
      mint: mint,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      decimals: PAPER_DECIMALS[mint] ?? 9,
      holderConcentrationBps: 1_200
    };
  }

  async simulateSell(mint: Mint, amountTokens: bigint): Promise<SellSimulation> {
    if (amountTokens <= 0n) return { passed: false, reason: "zero_amount" };
    const known = PAPER_MARKETS.some((market) => market.mint === mint);
    return known ? { passed: true, reason: "paper_simulation_ok" } : { passed: false, reason: "unknown_mint" };
  }
}

interface JsonRpcResponse {
  readonly result?: unknown;
  readonly error?: { readonly message?: unknown };
}

export interface RpcSolanaConfig {
  readonly id: string;
  readonly rpcUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly policy?: Partial<HttpPolicy>;
}

/**
 * Read-only JSON-RPC Solana client for live monitoring. Trading-related methods
 * fail closed because transaction simulation and signing are intentionally not
 * implemented in this milestone.
 */
export class RpcSolanaClient implements SolanaClient {
  readonly id: string;
  readonly isLive = true;
  private readonly fetchImpl: typeof fetch;
  private readonly policy: HttpPolicy;

  constructor(private readonly config: RpcSolanaConfig) {
    this.id = config.id;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.policy = resolveHttpPolicy(config.policy);
  }

  private async call(method: string, params: readonly unknown[]): Promise<unknown> {
    const response = await fetchWithRetry(
      this.fetchImpl,
      this.config.rpcUrl,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
      },
      this.policy
    );
    if (!response.ok) throw new Error(`RPC responded ${response.status} for ${method}.`);
    const payload = (await parseJsonWithLimit(response, this.policy.maxResponseBytes)) as JsonRpcResponse;
    if (payload.error !== undefined || payload.result === undefined) {
      throw new Error(`RPC error for ${method}: ${String(payload.error?.message ?? "missing result")}.`);
    }
    return payload.result;
  }

  async getSlot(): Promise<number> {
    const result = await this.call("getSlot", []);
    if (typeof result !== "number" || !Number.isSafeInteger(result)) throw new Error("Invalid slot response.");
    return result;
  }

  async getBalanceLamports(publicKey: string): Promise<bigint> {
    const result = (await this.call("getBalance", [publicKey])) as { value?: unknown };
    if (typeof result.value !== "number" || !Number.isSafeInteger(result.value)) {
      throw new Error("Balance response is missing a safe integer lamport value.");
    }
    return BigInt(result.value);
  }

  async getTokenFacts(mint: Mint): Promise<TokenAccountFacts> {
    const result = (await this.call("getAccountInfo", [mint, { encoding: "jsonParsed" }])) as {
      value?: { data?: { parsed?: { info?: Record<string, unknown> } } };
    };
    const info = result.value?.data?.parsed?.info;
    if (info === undefined) throw new Error(`Mint ${mint} is not a parseable token mint.`);
    const decimals = info["decimals"];
    if (typeof decimals !== "number" || !Number.isSafeInteger(decimals)) throw new Error("Mint decimals unavailable.");
    return {
      mint,
      mintAuthorityRevoked: info["mintAuthority"] === null,
      freezeAuthorityRevoked: info["freezeAuthority"] === null,
      decimals,
      holderConcentrationBps: await this.getHolderConcentrationBps(mint)
    };
  }

  private async getHolderConcentrationBps(mint: Mint): Promise<number> {
    const largest = (await this.call("getTokenLargestAccounts", [mint])) as { value?: readonly { amount?: unknown }[] };
    const supply = (await this.call("getTokenSupply", [mint])) as { value?: { amount?: unknown } };
    const total = supply.value?.amount;
    const top = largest.value?.[0]?.amount;
    if (typeof total !== "string" || typeof top !== "string") throw new Error("Holder concentration data unavailable.");
    const totalSupply = BigInt(total);
    if (totalSupply <= 0n) throw new Error("Token supply is zero.");
    return Number((BigInt(top) * 10_000n) / totalSupply);
  }

  async simulateSell(_mint: Mint, _amountTokens: bigint): Promise<SellSimulation> {
    return { passed: false, reason: "live_simulation_not_implemented" };
  }
}
