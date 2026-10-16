import { randomUUID } from "node:crypto";
import { z } from "zod";

export const NetworkSchema = z.enum(["devnet", "mainnet"]);
export type Network = z.infer<typeof NetworkSchema>;

export const TradingModeSchema = z.enum(["paper", "live"]);
export type TradingMode = z.infer<typeof TradingModeSchema>;

/**
 * Exact acknowledgement value required to leave paper mode. This is intentionally
 * awkward to type so that live trading cannot be enabled accidentally.
 */
export const LIVE_TRADING_ACK_PHRASE = "I_UNDERSTAND_LIVE_TRADING_IS_UNSAFE";

const LamportsSchema = z.number().int().positive().safe();

export const RuntimeConfigSchema = z
  .object({
    nodeEnv: z.enum(["development", "test", "production"]).default("development"),
    network: NetworkSchema.default("devnet"),
    tradingMode: TradingModeSchema.default("paper"),
    mainnetTradingEnabled: z.boolean().default(false),
    liveTradingAck: z.string().optional(),
    backendHost: z.string().min(1).default("127.0.0.1"),
    backendPort: z.number().int().min(1).max(65535).default(8787),
    solanaRpcUrl: z.string().url().default("https://api.devnet.solana.com"),
    paperStartingBalanceLamports: LamportsSchema.default(10_000_000_000),
    maxPositionLamports: LamportsSchema.default(300_000_000),
    maxDailyLossLamports: LamportsSchema.default(1_000_000_000),
    maxOpenPositions: z.number().int().min(1).max(100).default(3),
    maxSlippageBps: z.number().int().min(1).max(1000).default(100),
    scannerIntervalMs: z.number().int().min(100).max(3_600_000).default(5_000),
    enableControlApi: z.boolean().default(false),
    controlApiToken: z.string().min(16).optional(),
    stateDir: z.string().min(1).default(".local")
  })
  .strict();

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Boolean environment values must be exactly 'true' or 'false'.");
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

/**
 * Loads and validates runtime configuration. Fails closed: any attempt to reach
 * mainnet or live mode without the explicit safety acknowledgement throws.
 */
export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const config = RuntimeConfigSchema.parse({
    nodeEnv: env.NODE_ENV ?? "development",
    network: env.NETWORK ?? "devnet",
    tradingMode: env.TRADING_MODE ?? "paper",
    mainnetTradingEnabled: parseBoolean(env.MAINNET_TRADING_ENABLED, false),
    ...(env.LIVE_TRADING_ACK === undefined ? {} : { liveTradingAck: env.LIVE_TRADING_ACK }),
    backendHost: env.BACKEND_HOST ?? "127.0.0.1",
    backendPort: parsePositiveInt(env.BACKEND_PORT, 8787, "BACKEND_PORT"),
    solanaRpcUrl: env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    paperStartingBalanceLamports: parsePositiveInt(
      env.PAPER_STARTING_BALANCE_LAMPORTS,
      10_000_000_000,
      "PAPER_STARTING_BALANCE_LAMPORTS"
    ),
    maxPositionLamports: parsePositiveInt(env.MAX_POSITION_LAMPORTS, 300_000_000, "MAX_POSITION_LAMPORTS"),
    maxDailyLossLamports: parsePositiveInt(env.MAX_DAILY_LOSS_LAMPORTS, 1_000_000_000, "MAX_DAILY_LOSS_LAMPORTS"),
    maxOpenPositions: parsePositiveInt(env.MAX_OPEN_POSITIONS, 3, "MAX_OPEN_POSITIONS"),
    maxSlippageBps: parsePositiveInt(env.MAX_SLIPPAGE_BPS, 100, "MAX_SLIPPAGE_BPS"),
    scannerIntervalMs: parsePositiveInt(env.SCANNER_INTERVAL_MS, 5_000, "SCANNER_INTERVAL_MS"),
    enableControlApi: parseBoolean(env.ENABLE_CONTROL_API, false),
    ...(env.CONTROL_API_TOKEN === undefined ? {} : { controlApiToken: env.CONTROL_API_TOKEN }),
    stateDir: env.STATE_DIR ?? ".local"
  });

  if (config.network === "mainnet" && !config.mainnetTradingEnabled) {
    throw new Error(
      "Mainnet is disabled. Set MAINNET_TRADING_ENABLED=true only after completing the production safety review."
    );
  }
  if (config.network !== "mainnet" && config.mainnetTradingEnabled) {
    throw new Error("MAINNET_TRADING_ENABLED can only be true when NETWORK=mainnet.");
  }
  if (config.tradingMode === "live") {
    if (config.network !== "mainnet" || !config.mainnetTradingEnabled) {
      throw new Error("Live trading requires NETWORK=mainnet and MAINNET_TRADING_ENABLED=true.");
    }
    if (config.liveTradingAck !== LIVE_TRADING_ACK_PHRASE) {
      throw new Error(`Live trading requires LIVE_TRADING_ACK=${LIVE_TRADING_ACK_PHRASE}.`);
    }
  }
  if (config.enableControlApi && config.controlApiToken === undefined) {
    throw new Error("ENABLE_CONTROL_API=true requires CONTROL_API_TOKEN to authenticate control requests.");
  }
  if (config.maxSlippageBps > 1000) {
    throw new Error("MAX_SLIPPAGE_BPS must not exceed 1000 (10%).");
  }
  return config;
}

export function isPaperMode(config: RuntimeConfig): boolean {
  return config.tradingMode === "paper";
}

export function newIdempotencyKey(): string {
  return randomUUID();
}

export interface TransactionSigner {
  readonly publicKey: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export interface AuditEvent {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly action: string;
  readonly outcome: "accepted" | "rejected" | "failed";
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}

export const TradeIntentSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    mintAddress: z.string().min(32).max(44),
    side: z.enum(["buy", "sell"]),
    amountLamports: z.number().int().positive().safe(),
    maxSlippageBps: z.number().int().min(1).max(1000)
  })
  .strict();

export type TradeIntent = z.infer<typeof TradeIntentSchema>;

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------

export type LogFields = Record<string, unknown>;

const SECRET_KEY_PATTERN = /(secret|private|seed|mnemonic|passphrase|password|authorization|cookie|api[-_]?key|token)/i;

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, depth + 1));
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactSecrets(entry, depth + 1);
    }
    return result;
  }
  return value;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface StructuredLogger {
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
  child(bindings: LogFields): StructuredLogger;
}

export function createJsonLogger(
  level: LogLevel = "info",
  bindings: LogFields = {},
  sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`)
): StructuredLogger {
  const threshold = LEVEL_ORDER[level];
  const emit = (entryLevel: LogLevel, fields: LogFields, message: string): void => {
    if (LEVEL_ORDER[entryLevel] < threshold) return;
    const record = redactSecrets({ ...bindings, ...fields, level: entryLevel, message, time: new Date().toISOString() });
    sink(JSON.stringify(record));
  };
  return {
    debug: (fields, message) => emit("debug", fields, message),
    info: (fields, message) => emit("info", fields, message),
    warn: (fields, message) => emit("warn", fields, message),
    error: (fields, message) => emit("error", fields, message),
    child: (extra) => createJsonLogger(level, { ...bindings, ...extra }, sink)
  };
}

export class SafetyError extends Error {
  override readonly name = "SafetyError";
}
