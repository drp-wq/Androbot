import { z } from "zod";

export const NetworkSchema = z.enum(["devnet", "mainnet"]);
export type Network = z.infer<typeof NetworkSchema>;

export const RuntimeConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  network: NetworkSchema.default("devnet"),
  mainnetTradingEnabled: z.boolean().default(false),
  backendHost: z.string().min(1).default("127.0.0.1"),
  backendPort: z.number().int().min(1).max(65535).default(8787),
  solanaRpcUrl: z.string().url().default("https://api.devnet.solana.com")
}).strict();

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Boolean environment values must be exactly 'true' or 'false'.");
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const config = RuntimeConfigSchema.parse({
    nodeEnv: env.NODE_ENV ?? "development",
    network: env.NETWORK ?? "devnet",
    mainnetTradingEnabled: parseBoolean(env.MAINNET_TRADING_ENABLED, false),
    backendHost: env.BACKEND_HOST ?? "127.0.0.1",
    backendPort: Number(env.BACKEND_PORT ?? "8787"),
    solanaRpcUrl: env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com"
  });
  if (config.network === "mainnet" && !config.mainnetTradingEnabled) {
    throw new Error("Mainnet is disabled. Set MAINNET_TRADING_ENABLED=true only after completing the production safety review.");
  }
  if (config.network !== "mainnet" && config.mainnetTradingEnabled) {
    throw new Error("MAINNET_TRADING_ENABLED can only be true when NETWORK=mainnet.");
  }
  return config;
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

export const TradeIntentSchema = z.object({
  idempotencyKey: z.string().uuid(),
  mintAddress: z.string().min(32).max(44),
  side: z.enum(["buy", "sell"]),
  amountLamports: z.number().int().positive().safe(),
  maxSlippageBps: z.number().int().min(1).max(1000)
}).strict();

export type TradeIntent = z.infer<typeof TradeIntentSchema>;
