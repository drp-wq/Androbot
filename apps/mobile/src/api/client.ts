import { Platform } from "react-native";
import type { BackendHealth, BackendReady, MarketRow, TradeEvent, TraderStatus } from "../types";

export const DEFAULT_BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ??
  (Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://127.0.0.1:8787");

const REQUEST_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkBackendHealth(
  baseUrl: string
): Promise<{ ok: boolean; health: BackendHealth | null; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const cleanUrl = baseUrl.replace(/\/+$/, "");
    const res = await fetchWithTimeout(`${cleanUrl}/health`);
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return { ok: false, health: null, latencyMs, error: `HTTP ${res.status}: ${res.statusText}` };
    }

    const health = (await res.json()) as BackendHealth;
    return { ok: true, health, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : "Unable to reach backend";
    return { ok: false, health: null, latencyMs, error: message };
  }
}

export async function fetchTraderStatus(baseUrl: string): Promise<TraderStatus> {
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  const res = await fetchWithTimeout(`${cleanUrl}/api/status`);
  if (!res.ok) {
    throw new Error(`Failed to fetch status: HTTP ${res.status}`);
  }
  return (await res.json()) as TraderStatus;
}

export async function fetchBackendReady(baseUrl: string): Promise<BackendReady> {
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  const res = await fetchWithTimeout(`${cleanUrl}/ready`);
  if (!res.ok) {
    throw new Error(`Failed to fetch readiness: HTTP ${res.status}`);
  }
  return (await res.json()) as BackendReady;
}

export async function fetchMarkets(baseUrl: string): Promise<MarketRow[]> {
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  const res = await fetchWithTimeout(`${cleanUrl}/api/markets`);
  if (!res.ok) {
    throw new Error(`Failed to fetch markets: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { markets: MarketRow[] };
  return body.markets ?? [];
}

export async function fetchEvents(baseUrl: string): Promise<TradeEvent[]> {
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  const res = await fetchWithTimeout(`${cleanUrl}/api/events`);
  if (!res.ok) {
    throw new Error(`Failed to fetch events: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { events: TradeEvent[] };
  return body.events ?? [];
}

export async function sendControlAction(
  baseUrl: string,
  action: "pause" | "resume" | "panic",
  token?: string,
  reason = "mobile_operator"
): Promise<{ success: boolean; message: string }> {
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (token && token.trim().length > 0) {
    headers["authorization"] = `Bearer ${token.trim()}`;
    headers["x-control-token"] = token.trim();
  }

  const res = await fetchWithTimeout(`${cleanUrl}/api/control/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reason })
  });

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    detail?: string;
    paused?: boolean;
    locked?: boolean;
    reason?: string;
  };

  if (!res.ok) {
    const errorMsg = body.detail ?? body.error ?? `Control action failed (HTTP ${res.status})`;
    return { success: false, message: errorMsg };
  }

  if (action === "panic") {
    return { success: true, message: `Emergency panic engaged. Trading locked (${body.reason ?? reason}).` };
  } else if (action === "pause") {
    return { success: true, message: `Trading paused successfully (${body.reason ?? reason}).` };
  } else {
    return { success: true, message: "Trading resumed successfully." };
  }
}
