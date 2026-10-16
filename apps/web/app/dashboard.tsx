"use client";

import { useCallback, useEffect, useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8787";
const POLL_MS = 5000;

interface TraderStatus {
  mode: string;
  network: string;
  paused: boolean;
  pauseReason: string | null;
  lastTickAt: string | null;
  ticks: number;
  rpcFailureStreak: number;
  openPositions: number;
  cashLamports: string;
  equityLamports: string;
  realizedPnlLamports: string;
  feesPaidLamports: string;
  dailyLossLamports: string;
  maxDailyLossLamports: string;
  maxPositionLamports: string;
  maxOpenPositions: number;
  maxSlippageBps: number;
  positions: readonly Position[];
}

interface Position {
  mint: string;
  symbol: string;
  quantityTokens: string;
  averageEntryLamports: string;
  markPriceLamports: string;
  openedAt: string;
}

interface MarketRow {
  mint: string;
  symbol: string;
  priceLamports: string;
  liquidityLamports: string;
  lpBurnedOrLocked: boolean;
  updatedAt: string;
}

interface TradeEvent {
  at: string;
  level: string;
  action: string;
  mint: string | null;
  detail: Record<string, string | number | boolean | null>;
}

function lamportsToSol(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0.0000";
  return (numeric / 1_000_000_000).toFixed(4);
}

function shortMint(mint: string): string {
  return mint.length > 10 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

export default function Dashboard() {
  const [status, setStatus] = useState<TraderStatus | null>(null);
  const [markets, setMarkets] = useState<readonly MarketRow[]>([]);
  const [events, setEvents] = useState<readonly TradeEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [controlToken, setControlToken] = useState("");
  const [controlMessage, setControlMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [statusResponse, marketsResponse, eventsResponse] = await Promise.all([
        fetch(`${BACKEND_URL}/api/status`),
        fetch(`${BACKEND_URL}/api/markets`),
        fetch(`${BACKEND_URL}/api/events`)
      ]);
      if (!statusResponse.ok || !marketsResponse.ok || !eventsResponse.ok) {
        throw new Error("Backend responded with an error.");
      }
      setStatus((await statusResponse.json()) as TraderStatus);
      const marketBody = (await marketsResponse.json()) as { markets: MarketRow[] };
      setMarkets(marketBody.markets);
      const eventBody = (await eventsResponse.json()) as { events: TradeEvent[] };
      setEvents(eventBody.events.slice().reverse().slice(0, 12));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to reach backend.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const control = useCallback(
    async (action: "pause" | "resume" | "panic") => {
      setControlMessage(null);
      try {
        const response = await fetch(`${BACKEND_URL}/api/control/${action}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(controlToken ? { authorization: `Bearer ${controlToken}` } : {})
          },
          body: JSON.stringify({ reason: "dashboard" })
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
          throw new Error(body.detail ?? body.error ?? `Request failed (${response.status}).`);
        }
        setControlMessage(`${action} accepted.`);
        await refresh();
      } catch (cause) {
        setControlMessage(cause instanceof Error ? cause.message : "Control request failed.");
      }
    },
    [controlToken, refresh]
  );

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">SOLANA AUTONOMOUS TRADING · {status?.network?.toUpperCase() ?? "DEVNET"}</p>
          <h1>Operations dashboard</h1>
        </div>
        <span className={`badge ${status?.paused ? "badge-warn" : "badge-ok"}`}>
          {status ? (status.paused ? `PAUSED · ${status.pauseReason ?? ""}` : "RUNNING") : "CONNECTING"}
        </span>
      </header>

      <section className="notice" role="note">
        <strong>{status?.mode === "paper" ? "PAPER / SIMULATION MODE" : "MODE UNKNOWN"}</strong>
        <span> Simulated fills only. No real transactions are submitted. Not a profit guarantee.</span>
      </section>

      {error ? <p className="error" role="alert">Backend unreachable at {BACKEND_URL}: {error}</p> : null}

      {status ? (
        <>
          <section className="grid" aria-label="Account summary">
            <Stat label="Equity (SOL)" value={lamportsToSol(status.equityLamports)} />
            <Stat label="Cash (SOL)" value={lamportsToSol(status.cashLamports)} />
            <Stat label="Realized PnL (SOL)" value={lamportsToSol(status.realizedPnlLamports)} />
            <Stat label="Open positions" value={`${status.openPositions} / ${status.maxOpenPositions}`} />
            <Stat label="Daily loss (SOL)" value={`${lamportsToSol(status.dailyLossLamports)} / ${lamportsToSol(status.maxDailyLossLamports)}`} />
            <Stat label="Max slippage" value={`${status.maxSlippageBps} bps`} />
          </section>

          <section className="panel" aria-labelledby="positions-heading">
            <h2 id="positions-heading">Positions</h2>
            {status.positions.length === 0 ? (
              <p className="muted">No open positions.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Symbol</th><th>Mint</th><th>Qty</th><th>Entry</th><th>Mark</th></tr>
                  </thead>
                  <tbody>
                    {status.positions.map((position) => (
                      <tr key={position.mint}>
                        <td>{position.symbol}</td>
                        <td title={position.mint}>{shortMint(position.mint)}</td>
                        <td>{position.quantityTokens}</td>
                        <td>{lamportsToSol(position.averageEntryLamports)}</td>
                        <td>{lamportsToSol(position.markPriceLamports)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="markets-heading">
            <h2 id="markets-heading">Markets</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Symbol</th><th>Price (SOL)</th><th>Liquidity (SOL)</th><th>LP locked</th></tr>
                </thead>
                <tbody>
                  {markets.map((market) => (
                    <tr key={market.mint}>
                      <td>{market.symbol}</td>
                      <td>{lamportsToSol(market.priceLamports)}</td>
                      <td>{lamportsToSol(market.liquidityLamports)}</td>
                      <td>{market.lpBurnedOrLocked ? "yes" : "unknown"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel" aria-labelledby="controls-heading">
            <h2 id="controls-heading">Controls</h2>
            <p className="muted">
              Controls fail closed unless the backend is started with ENABLE_CONTROL_API=true and a control token.
            </p>
            <input
              className="token-input"
              type="password"
              inputMode="text"
              placeholder="Control API token (never stored on the server)"
              value={controlToken}
              onChange={(changeEvent) => setControlToken(changeEvent.target.value)}
            />
            <div className="buttons">
              <button type="button" onClick={() => void control("pause")}>Pause</button>
              <button type="button" onClick={() => void control("resume")}>Resume</button>
              <button type="button" className="danger" onClick={() => void control("panic")}>Panic (lock)</button>
            </div>
            {controlMessage ? <p className="muted">{controlMessage}</p> : null}
          </section>

          <section className="panel" aria-labelledby="events-heading">
            <h2 id="events-heading">Recent events</h2>
            {events.length === 0 ? (
              <p className="muted">No events yet.</p>
            ) : (
              <ul className="events">
                {events.map((event, index) => (
                  <li key={`${event.at}-${index}`} className={`event event-${event.level}`}>
                    <span className="event-action">{event.action}</span>
                    <span className="event-mint">{event.mint ? shortMint(event.mint) : "—"}</span>
                    <span className="event-time">{new Date(event.at).toLocaleTimeString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
