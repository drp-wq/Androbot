import type { ReadableStream } from "node:stream/web";

/**
 * Bounds for every outbound HTTP request. All upstream clients are read-only and
 * are never allowed to stall the tick loop or exhaust memory: a hung endpoint is
 * aborted by the timeout, a large body is rejected by the size cap, and transient
 * failures are retried a bounded number of times with backoff.
 */
export interface HttpPolicy {
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
}

export const DEFAULT_HTTP_POLICY: HttpPolicy = {
  timeoutMs: 5_000,
  maxResponseBytes: 1_000_000,
  maxRetries: 2,
  retryBaseDelayMs: 50
};

export function resolveHttpPolicy(overrides: Partial<HttpPolicy> = {}): HttpPolicy {
  return { ...DEFAULT_HTTP_POLICY, ...overrides };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches with a per-attempt timeout and bounded, exponential-backoff retries.
 * Retries network errors and transient statuses only; a definitive 4xx response is
 * returned immediately so the caller can fail closed without pointless retries.
 */
export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: Omit<RequestInit, "signal">,
  policy: HttpPolicy
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(policy.timeoutMs) });
      if (isRetryableStatus(response.status) && attempt < policy.maxRetries) {
        await delay(policy.retryBaseDelayMs * 2 ** attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < policy.maxRetries) {
        await delay(policy.retryBaseDelayMs * 2 ** attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("upstream request failed");
}

async function readStreamWithLimit(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        total += value.byteLength;
        if (total > maxBytes) throw new Error(`response body exceeds the ${maxBytes}-byte limit`);
        text += decoder.decode(value, { stream: true });
      }
    }
  } finally {
    reader.releaseLock();
  }
  text += decoder.decode();
  return text;
}

/**
 * Parses a JSON response while enforcing a maximum body size. The declared
 * content-length is checked first, then the stream is read incrementally so a
 * hostile endpoint cannot lie about (or omit) the length. Test doubles that do not
 * expose a body stream fall back to `response.json()`.
 */
export async function parseJsonWithLimit(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = response.headers?.get?.("content-length");
  if (typeof contentLength === "string" && contentLength !== "") {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`response body exceeds the ${maxBytes}-byte limit`);
    }
  }

  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (body !== null && body !== undefined && typeof body.getReader === "function") {
    return JSON.parse(await readStreamWithLimit(body, maxBytes));
  }
  return response.json();
}
