import { SafetyError } from "@solana-system/shared";
import type { ExecutionRequest, ExecutionResult, ExecutionRouter } from "./types.js";
import { firstExecutionRequestProblem } from "./validation.js";

export interface PaperExecutionConfig {
  readonly feeBps: number;
  readonly slippageBps: number;
}

const DEFAULT_PAPER_CONFIG: PaperExecutionConfig = { feeBps: 30, slippageBps: 50 };

function reject(reason: string): ExecutionResult {
  return { status: "rejected", reason, quantityTokens: 0n, priceLamports: 0n, notionalLamports: 0n, feeLamports: 0n, txRef: null };
}

/**
 * Deterministic paper fill engine. Slippage is always applied against the trader and
 * is capped by the request's max slippage. No transaction is ever submitted.
 */
export class PaperExecutionRouter implements ExecutionRouter {
  readonly isLive = false;
  private readonly config: PaperExecutionConfig;

  constructor(config: Partial<PaperExecutionConfig> = {}) {
    this.config = { ...DEFAULT_PAPER_CONFIG, ...config };
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const problem = firstExecutionRequestProblem(request);
    if (problem !== null) return reject(problem);
    const slippage = Math.min(this.config.slippageBps, request.maxSlippageBps);
    const txRef = `paper:${request.idempotencyKey.slice(0, 8)}`;

    if (request.side === "buy") {
      if (request.notionalLamports <= 0n) return reject("invalid_notional");
      const fillPrice = (request.referencePriceLamports * BigInt(10_000 + slippage)) / 10_000n;
      if (fillPrice <= 0n) return reject("invalid_fill_price");
      const quantity = request.notionalLamports / fillPrice;
      if (quantity <= 0n) return reject("notional_below_one_unit");
      const fee = (request.notionalLamports * BigInt(this.config.feeBps)) / 10_000n;
      return {
        status: "filled",
        reason: "paper_fill",
        quantityTokens: quantity,
        priceLamports: fillPrice,
        notionalLamports: quantity * fillPrice,
        feeLamports: fee,
        txRef
      };
    }

    if (request.quantityTokens <= 0n) return reject("invalid_quantity");
    const fillPrice = (request.referencePriceLamports * BigInt(10_000 - slippage)) / 10_000n;
    if (fillPrice <= 0n) return reject("invalid_fill_price");
    const notional = request.quantityTokens * fillPrice;
    const fee = (notional * BigInt(this.config.feeBps)) / 10_000n;
    return {
      status: "filled",
      reason: "paper_fill",
      quantityTokens: request.quantityTokens,
      priceLamports: fillPrice,
      notionalLamports: notional,
      feeLamports: fee,
      txRef
    };
  }
}

/**
 * Live execution is deliberately not implemented. Constructing it requires an explicit
 * acknowledgement, and every execution is rejected. This is the correct fail-closed
 * posture until a reviewed signer and DEX router are integrated.
 */
export class LiveExecutionRouter implements ExecutionRouter {
  readonly isLive = true;

  constructor(acknowledged: boolean) {
    if (!acknowledged) {
      throw new SafetyError("Live execution cannot be constructed without explicit acknowledgement.");
    }
  }

  async execute(_request: ExecutionRequest): Promise<ExecutionResult> {
    return reject("live_execution_not_implemented");
  }
}
