export function lamportsToSol(
  lamports: string | number | bigint | undefined | null,
  decimals = 4
): string {
  if (lamports === undefined || lamports === null || lamports === "") return "0.0000";
  try {
    const raw = typeof lamports === "bigint" ? lamports.toString() : String(lamports).trim();
    const num = Number(raw);
    if (!Number.isFinite(num)) return "0.0000";
    return (num / 1_000_000_000).toFixed(decimals);
  } catch {
    return "0.0000";
  }
}

export function shortAddress(address: string | null | undefined, leading = 4, trailing = 4): string {
  if (!address || typeof address !== "string") return "—";
  if (address.length <= leading + trailing + 2) return address;
  return `${address.slice(0, leading)}…${address.slice(-trailing)}`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "—";
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return "—";
  }
}

export function calculateUnrealizedPnl(
  quantityTokens: string,
  entryLamports: string,
  markLamports: string
): { pnlSol: string; pnlPercent: string; isProfit: boolean } {
  try {
    const qty = Number(quantityTokens);
    const entry = Number(entryLamports);
    const mark = Number(markLamports);

    if (!Number.isFinite(qty) || !Number.isFinite(entry) || !Number.isFinite(mark) || qty <= 0 || entry <= 0) {
      return { pnlSol: "0.0000", pnlPercent: "0.00%", isProfit: false };
    }

    const diffLamports = (mark - entry) * qty;
    const pnlSol = (diffLamports / 1_000_000_000).toFixed(4);
    const pct = ((mark - entry) / entry) * 100;
    const sign = diffLamports >= 0 ? "+" : "";

    return {
      pnlSol: `${sign}${pnlSol}`,
      pnlPercent: `${sign}${pct.toFixed(2)}%`,
      isProfit: diffLamports >= 0
    };
  } catch {
    return { pnlSol: "0.0000", pnlPercent: "0.00%", isProfit: false };
  }
}

export function formatBps(bps: number | undefined | null): string {
  if (bps === undefined || bps === null || !Number.isFinite(bps)) return "—";
  return `${bps} bps (${(bps / 100).toFixed(2)}%)`;
}
