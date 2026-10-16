import type { MarketDataSource, MarketQuote, Mint, PricePoint } from "./types.js";
import { fetchWithRetry, parseJsonWithLimit, resolveHttpPolicy, type HttpPolicy } from "./http.js";

interface SimulatedMarket {
  readonly mint: Mint;
  readonly symbol: string;
  readonly startPriceLamports: bigint;
  readonly drift: number;
  readonly volatility: number;
  readonly liquidityLamports: bigint;
}

export const PAPER_MARKETS: readonly SimulatedMarket[] = [
  {
    mint: "So11111111111111111111111111111111111111112",
    symbol: "wSOL",
    startPriceLamports: 1_000_000_000n,
    drift: 0.001,
    volatility: 0.02,
    liquidityLamports: 500_000_000_000n
  },
  {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    startPriceLamports: 5_000_000n,
    drift: 0.0,
    volatility: 0.004,
    liquidityLamports: 900_000_000_000n
  },
  {
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    symbol: "BONK",
    startPriceLamports: 30n,
    drift: 0.002,
    volatility: 0.09,
    liquidityLamports: 40_000_000_000n
  }
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Deterministic simulated market feed used in paper mode. The exact same series is
 * produced for a given seed so tests and demos are reproducible. It performs no
 * network I/O and never represents real market data.
 */
export class SimulatedMarketDataSource implements MarketDataSource {
  readonly id = "simulated";
  readonly isLive = false;
  private readonly baseTimestamp: number;

  constructor(private readonly seed = 1337, nowMs: number = Date.now()) {
    this.baseTimestamp = nowMs;
  }

  async listMarkets(): Promise<readonly Mint[]> {
    return PAPER_MARKETS.map((market) => market.mint);
  }

  async getQuote(mint: Mint): Promise<MarketQuote> {
    const market = this.requireMarket(mint);
    const history = this.buildHistory(market);
    const last = history[history.length - 1];
    if (last === undefined) throw new Error(`No simulated history for ${mint}.`);
    return {
      mint,
      symbol: market.symbol,
      priceLamports: last.priceLamports,
      liquidityLamports: market.liquidityLamports,
      lpBurnedOrLocked: true,
      updatedAt: last.at
    };
  }

  async getHistory(mint: Mint): Promise<readonly PricePoint[]> {
    return this.buildHistory(this.requireMarket(mint));
  }

  private requireMarket(mint: Mint): SimulatedMarket {
    const market = PAPER_MARKETS.find((candidate) => candidate.mint === mint);
    if (market === undefined) throw new Error(`Unknown simulated market ${mint}.`);
    return market;
  }

  private buildHistory(market: SimulatedMarket): PricePoint[] {
    const random = mulberry32(hashSeed(market.mint) ^ this.seed);
    const points: PricePoint[] = [];
    let price = Number(market.startPriceLamports);
    const samples = 24;
    for (let index = 0; index < samples; index += 1) {
      const shock = (random() - 0.5) * 2 * market.volatility;
      price = Math.max(1, price * (1 + market.drift + shock));
      points.push({
        at: new Date(this.baseTimestamp - (samples - 1 - index) * 60_000).toISOString(),
        priceLamports: BigInt(Math.round(price)),
        liquidityLamports: market.liquidityLamports
      });
    }
    return points;
  }
}

export interface HttpMarketConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly markets: readonly Mint[];
  readonly fetchImpl?: typeof fetch;
  readonly policy?: Partial<HttpPolicy>;
}

interface HttpQuotePayload {
  readonly symbol?: unknown;
  readonly priceLamports?: unknown;
  readonly liquidityLamports?: unknown;
  readonly lpBurnedOrLocked?: unknown;
}

function parseLamports(value: unknown): bigint | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

/**
 * HTTP market feed for live deployments. It is never enabled automatically and
 * fails closed: any transport error, non-200 response or malformed payload throws.
 */
export class HttpMarketDataSource implements MarketDataSource {
  readonly id: string;
  readonly isLive = true;
  private readonly fetchImpl: typeof fetch;
  private readonly policy: HttpPolicy;

  constructor(private readonly config: HttpMarketConfig) {
    this.id = config.id;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.policy = resolveHttpPolicy(config.policy);
  }

  async listMarkets(): Promise<readonly Mint[]> {
    return this.config.markets;
  }

  async getQuote(mint: Mint): Promise<MarketQuote> {
    const url = new URL("/quote", this.config.baseUrl);
    url.searchParams.set("mint", mint);
    const response = await fetchWithRetry(this.fetchImpl, url.toString(), {}, this.policy);
    if (!response.ok) throw new Error(`Market feed responded ${response.status} for ${mint}.`);
    const payload = (await parseJsonWithLimit(response, this.policy.maxResponseBytes)) as HttpQuotePayload;
    const price = parseLamports(payload.priceLamports);
    const liquidity = parseLamports(payload.liquidityLamports);
    if (price === null || liquidity === null) throw new Error("Market feed payload is missing a valid price or liquidity.");
    return {
      mint,
      symbol: typeof payload.symbol === "string" ? payload.symbol : mint.slice(0, 6),
      priceLamports: price,
      liquidityLamports: liquidity,
      lpBurnedOrLocked: payload.lpBurnedOrLocked === true,
      updatedAt: new Date().toISOString()
    };
  }

  async getHistory(mint: Mint): Promise<readonly PricePoint[]> {
    const url = new URL("/history", this.config.baseUrl);
    url.searchParams.set("mint", mint);
    const response = await fetchWithRetry(this.fetchImpl, url.toString(), {}, this.policy);
    if (!response.ok) throw new Error(`Market feed responded ${response.status} for ${mint} history.`);
    const payload = await parseJsonWithLimit(response, this.policy.maxResponseBytes);
    if (!Array.isArray(payload)) throw new Error("Market history payload must be an array.");
    return payload.map((entry) => {
      const point = entry as { at?: unknown; priceLamports?: unknown; liquidityLamports?: unknown };
      const price = parseLamports(point.priceLamports);
      const liquidity = parseLamports(point.liquidityLamports);
      if (price === null || liquidity === null || typeof point.at !== "string") {
        throw new Error("Market history point is malformed.");
      }
      return { at: point.at, priceLamports: price, liquidityLamports: liquidity };
    });
  }
}
