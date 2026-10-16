import type { MarketRegime } from "@solana-system/ai";

export type Mint = string;

/** On-chain facts about a mint, read from the Solana RPC (or a paper substitute). */
export interface TokenAccountFacts {
  readonly mint: Mint;
  readonly mintAuthorityRevoked: boolean;
  readonly freezeAuthorityRevoked: boolean;
  readonly decimals: number;
  readonly holderConcentrationBps: number;
}

export interface SellSimulation {
  readonly passed: boolean;
  readonly reason: string;
}

/**
 * Read-only Solana connectivity. Implementations must fail closed: a thrown error
 * or ambiguous value means "do not trade", never "assume safe".
 */
export interface SolanaClient {
  readonly id: string;
  readonly isLive: boolean;
  getSlot(): Promise<number>;
  getBalanceLamports(publicKey: string): Promise<bigint>;
  getTokenFacts(mint: Mint): Promise<TokenAccountFacts>;
  simulateSell(mint: Mint, amountTokens: bigint): Promise<SellSimulation>;
}

export interface MarketQuote {
  readonly mint: Mint;
  readonly symbol: string;
  readonly priceLamports: bigint;
  readonly liquidityLamports: bigint;
  readonly lpBurnedOrLocked: boolean;
  readonly updatedAt: string;
}

export interface PricePoint {
  readonly at: string;
  readonly priceLamports: bigint;
  readonly liquidityLamports: bigint;
}

export interface MarketDataSource {
  readonly id: string;
  readonly isLive: boolean;
  listMarkets(): Promise<readonly Mint[]>;
  getQuote(mint: Mint): Promise<MarketQuote>;
  getHistory(mint: Mint): Promise<readonly PricePoint[]>;
}

export interface SafetyPolicy {
  readonly minLiquidityLamports: bigint;
  readonly maxHolderConcentrationBps: number;
  readonly requireMintAuthorityRevoked: boolean;
  readonly requireFreezeAuthorityRevoked: boolean;
  readonly requireLpBurnedOrLocked: boolean;
  readonly requireSellSimulation: boolean;
}

export interface SafetyInput {
  readonly mint: Mint;
  readonly facts: TokenAccountFacts;
  readonly liquidityLamports: bigint;
  readonly lpBurnedOrLocked: boolean;
  readonly sellSimulationPassed: boolean;
}

export interface SafetyDecision {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

export interface StrategyInput {
  readonly quote: MarketQuote;
  readonly history: readonly PricePoint[];
  readonly regime: MarketRegime;
  readonly hasOpenPosition: boolean;
}

export interface StrategySignal {
  readonly action: "buy" | "sell" | "hold";
  readonly confidenceBps: number;
  readonly reasons: readonly string[];
}

export interface Strategy {
  evaluate(input: StrategyInput): StrategySignal;
}

export interface Position {
  readonly mint: Mint;
  readonly symbol: string;
  readonly quantityTokens: bigint;
  readonly averageEntryLamports: bigint;
  readonly openedAt: string;
}

export interface PortfolioSnapshot {
  readonly cashLamports: bigint;
  readonly positions: readonly Position[];
  readonly realizedPnlLamports: bigint;
  readonly feesPaidLamports: bigint;
  readonly dayStartEquityLamports: bigint;
  readonly utcDay: string;
}

export type LedgerEntryType = "intent" | "fill" | "reject" | "event" | "risk";

export interface LedgerEntry {
  readonly id: string;
  readonly at: string;
  readonly type: LedgerEntryType;
  readonly data: Readonly<Record<string, unknown>>;
  /**
   * Tamper-evident hash chain. `prevHash` links to the previous entry's `hash`
   * (or the genesis hash for the first entry). Entries written before chaining
   * was introduced may omit these; `FileLedger.readAll` rejects unchained entries.
   */
  readonly prevHash?: string;
  readonly hash?: string;
}

export interface Ledger {
  append(entry: Omit<LedgerEntry, "id" | "at">): Promise<LedgerEntry>;
  readAll(): Promise<readonly LedgerEntry[]>;
}

export interface ExecutionRequest {
  readonly mint: Mint;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  /** Notional lamports to spend (buy only). */
  readonly notionalLamports: bigint;
  /** Tokens to sell (sell only). */
  readonly quantityTokens: bigint;
  readonly referencePriceLamports: bigint;
  readonly maxSlippageBps: number;
  readonly idempotencyKey: string;
}

export interface ExecutionResult {
  readonly status: "filled" | "rejected";
  readonly reason: string;
  readonly quantityTokens: bigint;
  readonly priceLamports: bigint;
  readonly notionalLamports: bigint;
  readonly feeLamports: bigint;
  readonly txRef: string | null;
}

export interface ExecutionRouter {
  readonly isLive: boolean;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}

export interface TradeEvent {
  readonly at: string;
  readonly level: "info" | "warn" | "error";
  readonly action: string;
  readonly mint: Mint | null;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}
