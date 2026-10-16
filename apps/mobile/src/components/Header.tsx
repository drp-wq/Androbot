import { ActivityIndicator, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ConnectionState } from "../types";

interface HeaderProps {
  readonly connection: ConnectionState;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
}

export function Header({ connection, isRefreshing, onRefresh }: HeaderProps) {
  const statusColor = connection.isConnected ? "#10b981" : connection.isChecking ? "#f59e0b" : "#ef4444";
  const statusLabel = connection.isConnected
    ? "ONLINE"
    : connection.isChecking
      ? "SYNCING"
      : "OFFLINE";

  return (
    <View style={styles.header}>
      <View style={styles.leftContainer}>
        <View style={styles.titleRow}>
          <Text style={styles.appTitle}>ANDROBOT</Text>
          <View style={styles.paperBadge}>
            <Text style={styles.paperBadgeText}>PAPER ONLY</Text>
          </View>
        </View>
        <Text style={styles.subTitle}>Solana Autonomous Trading System</Text>
      </View>

      <View style={styles.rightContainer}>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={onRefresh}
          disabled={isRefreshing}
          activeOpacity={0.7}
        >
          {isRefreshing ? (
            <ActivityIndicator size="small" color="#94a3b8" />
          ) : (
            <Text style={styles.refreshButtonText}>↻ Sync</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) + 8 : 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: "#0d1424",
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  leftContainer: {
    flex: 1
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  appTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#f8fafc",
    letterSpacing: 1.5
  },
  paperBadge: {
    backgroundColor: "#1e3a8a",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#3b82f6"
  },
  paperBadgeText: {
    color: "#bfdbfe",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5
  },
  subTitle: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2
  },
  rightContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
    gap: 5
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5
  },
  refreshButton: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    alignItems: "center"
  },
  refreshButtonText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "600"
  }
});
