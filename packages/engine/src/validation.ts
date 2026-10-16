import { isValidSolanaAddress } from "@solana-system/shared";
import type { ExecutionRequest } from "./types.js";

// Accept any RFC-4122-shaped UUID. The engine only generates v4 keys, but being
// version-agnostic keeps the boundary tolerant of externally supplied keys.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MIN_SLIPPAGE_BPS = 1;
export const MAX_SLIPPAGE_BPS = 1_000;
export const MAX_SYMBOL_LENGTH = 32;

function isPositiveBigInt(value: unknown): value is bigint {
  return typeof value === "bigint" && value > 0n;
}

/**
 * Validates an execution request at the boundary where it enters an execution
 * router. Returns a list of stable reason codes; an empty list means valid.
 *
 * This is deliberately defensive: it re-checks runtime types so a malformed value
 * that bypassed the TypeScript type (e.g. deserialized JSON) is rejected rather
 * than trusted. Callers must fail closed on any non-empty result.
 */
export function validateExecutionRequest(request: ExecutionRequest): readonly string[] {
  const reasons: string[] = [];

  if (!isValidSolanaAddress(request.mint)) reasons.push("invalid_mint");
  if (request.side !== "buy" && request.side !== "sell") reasons.push("invalid_side");
  if (typeof request.symbol !== "string" || request.symbol.trim() === "" || request.symbol.length > MAX_SYMBOL_LENGTH) {
    reasons.push("invalid_symbol");
  }
  if (!isPositiveBigInt(request.referencePriceLamports)) reasons.push("invalid_reference_price");
  if (
    !Number.isSafeInteger(request.maxSlippageBps) ||
    request.maxSlippageBps < MIN_SLIPPAGE_BPS ||
    request.maxSlippageBps > MAX_SLIPPAGE_BPS
  ) {
    reasons.push("invalid_slippage_cap");
  }
  if (typeof request.idempotencyKey !== "string" || !UUID_PATTERN.test(request.idempotencyKey)) {
    reasons.push("invalid_idempotency_key");
  }
  if (request.side === "buy" && !isPositiveBigInt(request.notionalLamports)) reasons.push("invalid_notional");
  if (request.side === "sell" && !isPositiveBigInt(request.quantityTokens)) reasons.push("invalid_quantity");

  return reasons;
}

/**
 * Convenience wrapper. Returns the first reason code when invalid, or null when the
 * request is valid. The single reason is used verbatim by routers so existing
 * reason codes (for example `invalid_slippage_cap`) remain stable.
 */
export function firstExecutionRequestProblem(request: ExecutionRequest): string | null {
  const reasons = validateExecutionRequest(request);
  if (reasons.length === 0) return null;
  if (reasons.length === 1) return reasons[0] ?? null;
  return `invalid_execution_request:${reasons.join(",")}`;
}
