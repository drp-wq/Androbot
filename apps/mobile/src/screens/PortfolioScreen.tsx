import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Position, TraderStatus } from "../types";
import { calculateUnrealizedPnl, formatTime, lamportsToSol, shortAddress } from "../utils/format";

interface PortfolioScreenProps {
  readonly status: TraderStatus | null;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
}

export function PortfolioScreen({ status, isRefreshing, onRefresh }: PortfolioScreenProps) {
  const positions = status?.positions ?? [];

  const handleMintPress = (mint: string, symbol: string) => {
    Alert.alert(`Token: ${symbol}`, `Mint Address:\n${mint}`, [{ text: "OK" }]);
  };

  const realizedPnlNum = Number(status?.realizedPnlLamports ?? "0");
  const pnlColor = realizedPnlNum > 0 ? "#10b981" : realizedPnlNum < 0 ? "#ef4444" : "#cbd5e1";
  const pnlSign = realizedPnlNum > 0 ? "+" : "";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#60a5fa" />}
    >
      {/* Portfolio Balance Summary */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Paper Portfolio Summary</Text>
        <Text style={styles.cardSubtitle}>Autonomous Devnet Simulation Vault</Text>

        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Total Equity</Text>
            <Text style={styles.equityValue}>{lamportsToSol(status?.equityLamports)} SOL</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Available Cash</Text>
            <Text style={styles.cashValue}>{lamportsToSol(status?.cashLamports)} SOL</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.detailsGrid}>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Realized PnL</Text>
            <Text style={[styles.detailValue, { color: pnlColor }]}>
              {pnlSign}{lamportsToSol(status?.realizedPnlLamports)} SOL
            </Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Fees Paid</Text>
            <Text style={styles.detailValue}>{lamportsToSol(status?.feesPaidLamports)} SOL</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Daily Loss</Text>
            <Text style={styles.detailValue}>{lamportsToSol(status?.dailyLossLamports)} SOL</Text>
          </View>
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Open Count</Text>
            <Text style={styles.detailValue}>{positions.length} active</Text>
          </View>
        </View>
      </View>

      {/* Positions Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Open Positions ({positions.length})</Text>
        <Text style={styles.sectionSub}>Cap: {status?.maxOpenPositions ?? 3} concurrent</Text>
      </View>

      {positions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTitle}>No Open Positions</Text>
          <Text style={styles.emptyText}>
            The paper trading engine is scanning Devnet DEX pools. When market regime conditions and anti-rug checks pass, simulated buy orders will appear here.
          </Text>
          <TouchableOpacity style={styles.refreshEmptyBtn} onPress={onRefresh} activeOpacity={0.7}>
            <Text style={styles.refreshEmptyBtnText}>↻ Check Scanner</Text>
          </TouchableOpacity>
        </View>
      ) : (
        positions.map((pos: Position) => {
          const pnl = calculateUnrealizedPnl(
            pos.quantityTokens,
            pos.averageEntryLamports,
            pos.markPriceLamports
          );
          const posPnlColor = pnl.isProfit ? "#10b981" : "#ef4444";

          return (
            <View key={pos.mint} style={styles.positionCard}>
              <View style={styles.posHeader}>
                <View style={styles.symbolRow}>
                  <Text style={styles.symbolText}>{pos.symbol}</Text>
                  <TouchableOpacity
                    style={styles.mintChip}
                    onPress={() => handleMintPress(pos.mint, pos.symbol)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.mintText}>{shortAddress(pos.mint, 4, 4)}</Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.pnlBadge, { backgroundColor: pnl.isProfit ? "#064e3b" : "#7f1d1d" }]}>
                  <Text style={[styles.pnlBadgeText, { color: posPnlColor }]}>
                    {pnl.pnlSol} SOL ({pnl.pnlPercent})
                  </Text>
                </View>
              </View>

              <View style={styles.posGrid}>
                <View style={styles.posGridItem}>
                  <Text style={styles.posLabel}>Holdings</Text>
                  <Text style={styles.posValue}>{pos.quantityTokens}</Text>
                </View>
                <View style={styles.posGridItem}>
                  <Text style={styles.posLabel}>Entry Price</Text>
                  <Text style={styles.posValue}>{lamportsToSol(pos.averageEntryLamports)} SOL</Text>
                </View>
                <View style={styles.posGridItem}>
                  <Text style={styles.posLabel}>Mark Price</Text>
                  <Text style={styles.posValue}>{lamportsToSol(pos.markPriceLamports)} SOL</Text>
                </View>
                <View style={styles.posGridItem}>
                  <Text style={styles.posLabel}>Opened At</Text>
                  <Text style={styles.posValue}>{formatTime(pos.openedAt)}</Text>
                </View>
              </View>
            </View>
          );
        })
      )}

      {/* Deterministic Risk Limits & Guardrails */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Enforced Risk Controls</Text>
        <Text style={styles.riskHelp}>
          Deterministic rules enforced locally by the trading engine and on-chain Anchor vault.
        </Text>

        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Max Position Size</Text>
          <Text style={styles.riskValue}>{lamportsToSol(status?.maxPositionLamports)} SOL</Text>
        </View>
        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Max Daily Loss Limit</Text>
          <Text style={styles.riskValue}>{lamportsToSol(status?.maxDailyLossLamports)} SOL</Text>
        </View>
        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Max Open Positions</Text>
          <Text style={styles.riskValue}>{status?.maxOpenPositions ?? 3}</Text>
        </View>
        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Max Slippage Tolerance</Text>
          <Text style={styles.riskValue}>{status?.maxSlippageBps ?? 100} bps (1%)</Text>
        </View>
        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Anti-Rug LP Burn Verification</Text>
          <Text style={[styles.riskValue, { color: "#10b981" }]}>Mandatory (Fail Closed)</Text>
        </View>
        <View style={styles.riskRow}>
          <Text style={styles.riskLabel}>Mode Enforcement</Text>
          <Text style={[styles.riskValue, { color: "#60a5fa" }]}>Devnet Paper Simulation</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#080c18"
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32
  },
  card: {
    backgroundColor: "#0f172a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16
  },
  cardTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "800"
  },
  cardSubtitle: {
    color: "#64748b",
    fontSize: 11,
    marginTop: 2
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16
  },
  summaryItem: {
    flex: 1
  },
  summaryLabel: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "600"
  },
  equityValue: {
    color: "#60a5fa",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 4
  },
  cashValue: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 4
  },
  divider: {
    height: 1,
    backgroundColor: "#1e293b",
    marginVertical: 14
  },
  detailsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  detailItem: {
    width: "48%",
    backgroundColor: "#141e33",
    padding: 10,
    borderRadius: 8
  },
  detailLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "600"
  },
  detailValue: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10
  },
  sectionTitle: {
    color: "#f1f5f9",
    fontSize: 15,
    fontWeight: "800"
  },
  sectionSub: {
    color: "#64748b",
    fontSize: 11
  },
  emptyCard: {
    backgroundColor: "#0f172a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    marginBottom: 16
  },
  emptyIcon: {
    fontSize: 32
  },
  emptyTitle: {
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 10
  },
  emptyText: {
    color: "#94a3b8",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 6
  },
  refreshEmptyBtn: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#334155",
    marginTop: 14
  },
  refreshEmptyBtnText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "600"
  },
  positionCard: {
    backgroundColor: "#0f172a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12
  },
  posHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10
  },
  symbolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  symbolText: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "800"
  },
  mintChip: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  mintText: {
    color: "#94a3b8",
    fontSize: 10,
    fontFamily: "monospace"
  },
  pnlBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6
  },
  pnlBadgeText: {
    fontSize: 11,
    fontWeight: "800"
  },
  posGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  posGridItem: {
    width: "48%",
    backgroundColor: "#141e33",
    padding: 8,
    borderRadius: 6
  },
  posLabel: {
    color: "#64748b",
    fontSize: 10
  },
  posValue: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2
  },
  riskHelp: {
    color: "#94a3b8",
    fontSize: 11,
    marginTop: 2,
    marginBottom: 10
  },
  riskRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b"
  },
  riskLabel: {
    color: "#cbd5e1",
    fontSize: 12
  },
  riskValue: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "700"
  }
});
