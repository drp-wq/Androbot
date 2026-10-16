import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { MarketRow } from "../types";
import { formatTime, lamportsToSol, shortAddress } from "../utils/format";

interface MarketsScreenProps {
  readonly markets: readonly MarketRow[];
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
}

export function MarketsScreen({ markets, isRefreshing, onRefresh }: MarketsScreenProps) {
  const handleMarketPress = (market: MarketRow) => {
    Alert.alert(
      `Market: ${market.symbol}`,
      `Token Mint:\n${market.mint}\n\nPrice: ${lamportsToSol(market.priceLamports)} SOL\nLiquidity: ${lamportsToSol(market.liquidityLamports)} SOL\nLP Status: ${market.lpBurnedOrLocked ? "Burned / Locked" : "Unverified"}\nUpdated: ${formatTime(market.updatedAt)}`,
      [{ text: "Close" }]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#60a5fa" />}
    >
      <View style={styles.headerBox}>
        <View>
          <Text style={styles.title}>Tracked DEX Markets</Text>
          <Text style={styles.subtitle}>24/7 autonomous Devnet orderbook / AMM scanner</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{markets.length} pairs</Text>
        </View>
      </View>

      {markets.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>📉</Text>
          <Text style={styles.emptyTitle}>No Market Quotes Received</Text>
          <Text style={styles.emptyText}>
            The DEX scanner has not returned active quotes. Verify that the backend is running and the scanner interval is active.
          </Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh} activeOpacity={0.7}>
            <Text style={styles.refreshBtnText}>↻ Refresh Markets</Text>
          </TouchableOpacity>
        </View>
      ) : (
        markets.map((market: MarketRow) => {
          return (
            <TouchableOpacity
              key={market.mint}
              style={styles.marketCard}
              onPress={() => handleMarketPress(market)}
              activeOpacity={0.8}
            >
              <View style={styles.cardTopRow}>
                <View style={styles.symbolGroup}>
                  <Text style={styles.symbolText}>{market.symbol}</Text>
                  <Text style={styles.mintText}>{shortAddress(market.mint, 4, 4)}</Text>
                </View>
                <View style={styles.priceGroup}>
                  <Text style={styles.priceText}>{lamportsToSol(market.priceLamports)} SOL</Text>
                  <Text style={styles.updatedText}>{formatTime(market.updatedAt)}</Text>
                </View>
              </View>

              <View style={styles.cardBottomRow}>
                <View style={styles.liquidityBox}>
                  <Text style={styles.bottomLabel}>Liquidity</Text>
                  <Text style={styles.bottomValue}>{lamportsToSol(market.liquidityLamports)} SOL</Text>
                </View>

                <View style={styles.securityBox}>
                  <Text style={styles.bottomLabel}>Anti-Rug Check</Text>
                  {market.lpBurnedOrLocked ? (
                    <View style={styles.lpVerified}>
                      <Text style={styles.lpVerifiedText}>✓ LP BURNED/LOCKED</Text>
                    </View>
                  ) : (
                    <View style={styles.lpUnverified}>
                      <Text style={styles.lpUnverifiedText}>⚠ UNVERIFIED</Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        })
      )}

      {/* Safety Notice Card */}
      <View style={styles.noteCard}>
        <Text style={styles.noteTitle}>Anti-Rug Pre-Trade Verification</Text>
        <Text style={styles.noteText}>
          The engine validates freeze/mint authority revocation, Token-2022 transfer fees, LP burned/locked proofs, and top-holder concentration before simulating trade entry.
        </Text>
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
  headerBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14
  },
  title: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "800"
  },
  subtitle: {
    color: "#64748b",
    fontSize: 11,
    marginTop: 2
  },
  countBadge: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6
  },
  countBadgeText: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700"
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
  refreshBtn: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#334155",
    marginTop: 14
  },
  refreshBtnText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "600"
  },
  marketCard: {
    backgroundColor: "#0f172a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12
  },
  symbolGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  symbolText: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "800"
  },
  mintText: {
    color: "#64748b",
    fontSize: 11,
    fontFamily: "monospace"
  },
  priceGroup: {
    alignItems: "flex-end"
  },
  priceText: {
    color: "#60a5fa",
    fontSize: 15,
    fontWeight: "800"
  },
  updatedText: {
    color: "#64748b",
    fontSize: 10,
    marginTop: 2
  },
  cardBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingTop: 10
  },
  liquidityBox: {
    flex: 1
  },
  securityBox: {
    alignItems: "flex-end"
  },
  bottomLabel: {
    color: "#64748b",
    fontSize: 10,
    marginBottom: 2
  },
  bottomValue: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700"
  },
  lpVerified: {
    backgroundColor: "#064e3b",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  lpVerifiedText: {
    color: "#6ee7b7",
    fontSize: 9,
    fontWeight: "800"
  },
  lpUnverified: {
    backgroundColor: "#78350f",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  lpUnverifiedText: {
    color: "#fde68a",
    fontSize: 9,
    fontWeight: "800"
  },
  noteCard: {
    backgroundColor: "#0d1b33",
    borderColor: "#1d4ed8",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 4
  },
  noteTitle: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "800"
  },
  noteText: {
    color: "#bfdbfe",
    fontSize: 11,
    marginTop: 4,
    lineHeight: 16
  }
});
