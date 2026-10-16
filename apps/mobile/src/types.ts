export type TabName = "dashboard" | "portfolio" | "markets" | "activity" | "settings";

export interface Position {
  readonly mint: string;
  readonly symbol: string;
  readonly quantityTokens: string;
  readonly averageEntryLamports: string;
  readonly markPriceLamports: string;
  readonly openedAt: string;
}

export interface TraderStatus {
  readonly mode: string;
  readonly network: string;
  readonly paused: boolean;
  readonly pauseReason: string | null;
  readonly locked?: boolean;
  readonly lockReason?: string | null;
  readonly lastTickAt: string | null;
  readonly ticks: number;
  readonly rpcFailureStreak: number;
  readonly openPositions: number;
  readonly cashLamports: string;
  readonly equityLamports: string;
  readonly realizedPnlLamports: string;
  readonly feesPaidLamports: string;
  readonly dailyLossLamports: string;
  readonly maxDailyLossLamports: string;
  readonly maxPositionLamports: string;
  readonly maxOpenPositions: number;
  readonly maxSlippageBps: number;
  readonly positions: readonly Position[];
}

export interface MarketRow {
  readonly mint: string;
  readonly symbol: string;
  readonly priceLamports: string;
  readonly liquidityLamports: string;
  readonly lpBurnedOrLocked: boolean;
  readonly updatedAt: string;
}

export interface TradeEvent {
  readonly at: string;
  readonly level: string;
  readonly action: string;
  readonly mint: string | null;
  readonly detail: Record<string, unknown>;
}

export interface BackendHealth {
  readonly status: string;
  readonly service: string;
  readonly network: string;
  readonly mode: string;
  readonly tradingEnabled: boolean;
  readonly liveExecutionEnabled: boolean;
  readonly timestamp: string;
}

export interface BackendReady {
  readonly ready: boolean;
  readonly locked: boolean;
  readonly lockReason: string | null;
  readonly mode: string;
  readonly reconciled: boolean | null;
  readonly fillsReplayed: number;
  readonly note: string;
}

export interface ConnectionState {
  readonly isConnected: boolean;
  readonly isChecking: boolean;
  readonly lastCheckedAt: string | null;
  readonly errorMessage: string | null;
  readonly latencyMs: number | null;
}
