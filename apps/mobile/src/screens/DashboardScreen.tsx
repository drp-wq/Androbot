import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import type { BackendReady, ConnectionState, TraderStatus } from "../types";
import { formatBps, formatTime, lamportsToSol } from "../utils/format";

interface DashboardScreenProps {
  readonly status: TraderStatus | null;
  readonly ready: BackendReady | null;
  readonly connection: ConnectionState;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly onControlAction: (action: "pause" | "resume" | "panic", token?: string) => Promise<void>;
  readonly onNavigateToSettings: () => void;
}

export function DashboardScreen({
  status,
  ready,
  connection,
  isRefreshing,
  onRefresh,
  onControlAction,
  onNavigateToSettings
}: DashboardScreenProps) {
  const [controlToken, setControlToken] = useState("");
  const [isSubmittingControl, setIsSubmittingControl] = useState(false);

  const isLocked = ready?.locked ?? status?.locked ?? false;
  const isPaused = status?.paused ?? false;
  const pauseReason = status?.pauseReason ?? ready?.lockReason ?? null;

  const handleAction = async (action: "pause" | "resume" | "panic") => {
    if (action === "panic") {
      Alert.alert(
        "🚨 Emergency Killswitch",
        "Are you sure you want to trigger the emergency killswitch? Trading will halt immediately, write a durable lock file, and cancel open paper operations.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Engage Panic",
            style: "destructive",
            onPress: async () => {
              setIsSubmittingControl(true);
              try {
                await onControlAction("panic", controlToken);
              } finally {
                setIsSubmittingControl(false);
              }
            }
          }
        ]
      );
      return;
    }

    setIsSubmittingControl(true);
    try {
      await onControlAction(action, controlToken);
    } finally {
      setIsSubmittingControl(false);
    }
  };

  const realizedPnlNum = Number(status?.realizedPnlLamports ?? "0");
  const pnlColor = realizedPnlNum > 0 ? "#10b981" : realizedPnlNum < 0 ? "#ef4444" : "#cbd5e1";
  const pnlSign = realizedPnlNum > 0 ? "+" : "";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#60a5fa" />}
      keyboardShouldPersistTaps="handled"
    >
      {/* Offline Alert Banner */}
      {!connection.isConnected && (
        <View style={styles.offlineBanner}>
          <View style={styles.bannerRow}>
            <Text style={styles.offlineIcon}>⚠️</Text>
            <View style={styles.bannerTextContainer}>
              <Text style={styles.offlineTitle}>Backend Service Unavailable</Text>
              <Text style={styles.offlineText}>
                {connection.errorMessage ?? "Cannot establish connection to trading engine."}
              </Text>
            </View>
          </View>
          <View style={styles.bannerActions}>
            <TouchableOpacity style={styles.bannerButton} onPress={onRefresh} activeOpacity={0.7}>
              <Text style={styles.bannerButtonText}>Retry Connection</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bannerButton, styles.bannerSecondaryButton]}
              onPress={onNavigateToSettings}
              activeOpacity={0.7}
            >
              <Text style={styles.bannerSecondaryButtonText}>Configure Host</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Safety Notice */}
      <View style={styles.safetyNotice}>
        <Text style={styles.safetyIcon}>🛡️</Text>
        <View style={styles.safetyTextContainer}>
          <Text style={styles.safetyTitle}>DEVNET · PAPER SIMULATION MODE</Text>
          <Text style={styles.safetyDescription}>
            Fills are simulated locally. No real money or private key transactions are permitted.
          </Text>
        </View>
      </View>

      {/* System Status Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Engine Safety State</Text>
          {isLocked ? (
            <View style={[styles.badge, styles.badgeDanger]}>
              <Text style={styles.badgeDangerText}>KILLSWITCH LOCKED</Text>
            </View>
          ) : isPaused ? (
            <View style={[styles.badge, styles.badgeWarn]}>
              <Text style={styles.badgeWarnText}>PAUSED</Text>
            </View>
          ) : (
            <View style={[styles.badge, styles.badgeSuccess]}>
              <Text style={styles.badgeSuccessText}>ACTIVE RUNNING</Text>
            </View>
          )}
        </View>

        {pauseReason && (
          <View style={styles.reasonBox}>
            <Text style={styles.reasonLabel}>Intervention Reason:</Text>
            <Text style={styles.reasonText}>{pauseReason}</Text>
          </View>
        )}

        <View style={styles.stateGrid}>
          <View style={styles.stateItem}>
            <Text style={styles.stateLabel}>Network</Text>
            <Text style={styles.stateValue}>{status?.network?.toUpperCase() ?? "DEVNET"}</Text>
          </View>
          <View style={styles.stateItem}>
            <Text style={styles.stateLabel}>Mode</Text>
            <Text style={styles.stateValue}>{status?.mode?.toUpperCase() ?? "PAPER"}</Text>
          </View>
          <View style={styles.stateItem}>
            <Text style={styles.stateLabel}>Ledger Reconciled</Text>
            <Text style={styles.stateValue}>{ready?.reconciled ? "Restored" : "Not restored"}</Text>
          </View>
          <View style={styles.stateItem}>
            <Text style={styles.stateLabel}>Fills Replayed</Text>
            <Text style={styles.stateValue}>{ready?.fillsReplayed ?? 0}</Text>
          </View>
          <View style={styles.stateItem}>
            <Text style={styles.stateLabel}>Scanner Ticks</Text>
            <Text style={styles.stateValue}>{status?.ticks ?? 0}</Text>
          </View>
          <View style={styles.stateItem}>
            <Text style={styles.stateLabel}>Last Tick</Text>
            <Text style={styles.stateValue}>{formatTime(status?.lastTickAt)}</Text>
          </View>
        </View>
      </View>

      {/* Account Performance Overview */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account Performance</Text>
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Portfolio Equity</Text>
            <Text style={styles.metricValuePrimary}>{lamportsToSol(status?.equityLamports)} SOL</Text>
            <Text style={styles.metricSub}>Total valuation</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Available Cash</Text>
            <Text style={styles.metricValue}>{lamportsToSol(status?.cashLamports)} SOL</Text>
            <Text style={styles.metricSub}>Uncommitted SOL</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Realized PnL</Text>
            <Text style={[styles.metricValue, { color: pnlColor }]}>
              {pnlSign}{lamportsToSol(status?.realizedPnlLamports)} SOL
            </Text>
            <Text style={styles.metricSub}>Closed trades</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Open Positions</Text>
            <Text style={styles.metricValue}>
              {status?.openPositions ?? 0} / {status?.maxOpenPositions ?? 3}
            </Text>
            <Text style={styles.metricSub}>Risk limit cap</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Daily Loss Limit</Text>
            <Text style={styles.metricValue}>
              {lamportsToSol(status?.dailyLossLamports)} / {lamportsToSol(status?.maxDailyLossLamports)} SOL
            </Text>
            <Text style={styles.metricSub}>Max daily risk</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Max Slippage</Text>
            <Text style={styles.metricValue}>{formatBps(status?.maxSlippageBps)}</Text>
            <Text style={styles.metricSub}>Hard enforcement</Text>
          </View>
        </View>
      </View>

      {/* Emergency Control Panel */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Operator Controls</Text>
        <Text style={styles.controlsHelp}>
          Commands are executed on the backend. Provide a Control API token if authentication is enabled.
        </Text>

        <TextInput
          style={styles.tokenInput}
          placeholder="Control Token (optional if enabled)"
          placeholderTextColor="#64748b"
          secureTextEntry
          value={controlToken}
          onChangeText={setControlToken}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {isSubmittingControl ? (
          <View style={styles.controlLoading}>
            <ActivityIndicator color="#60a5fa" />
            <Text style={styles.controlLoadingText}>Sending command to backend...</Text>
          </View>
        ) : (
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[styles.controlBtn, styles.pauseBtn]}
              onPress={() => void handleAction("pause")}
              activeOpacity={0.7}
            >
              <Text style={styles.pauseBtnText}>⏸️ Pause</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.controlBtn, styles.resumeBtn]}
              onPress={() => void handleAction("resume")}
              activeOpacity={0.7}
            >
              <Text style={styles.resumeBtnText}>▶️ Resume</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.controlBtn, styles.panicBtn]}
              onPress={() => void handleAction("panic")}
              activeOpacity={0.7}
            >
              <Text style={styles.panicBtnText}>🚨 Panic Lock</Text>
            </TouchableOpacity>
          </View>
        )}
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
  offlineBanner: {
    backgroundColor: "#29161d",
    borderColor: "#ef4444",
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16
  },
  bannerRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start"
  },
  offlineIcon: {
    fontSize: 22
  },
  bannerTextContainer: {
    flex: 1
  },
  offlineTitle: {
    color: "#fca5a5",
    fontSize: 14,
    fontWeight: "800"
  },
  offlineText: {
    color: "#cbd5e1",
    fontSize: 12,
    marginTop: 2,
    lineHeight: 18
  },
  bannerActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12
  },
  bannerButton: {
    backgroundColor: "#b91c1c",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6
  },
  bannerButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700"
  },
  bannerSecondaryButton: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#475569"
  },
  bannerSecondaryButtonText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "600"
  },
  safetyNotice: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0d1b33",
    borderColor: "#1d4ed8",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 10
  },
  safetyIcon: {
    fontSize: 18
  },
  safetyTextContainer: {
    flex: 1
  },
  safetyTitle: {
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5
  },
  safetyDescription: {
    color: "#bfdbfe",
    fontSize: 11,
    marginTop: 2,
    lineHeight: 16
  },
  card: {
    backgroundColor: "#0f172a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12
  },
  cardTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "800"
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6
  },
  badgeSuccess: {
    backgroundColor: "#064e3b",
    borderWidth: 1,
    borderColor: "#059669"
  },
  badgeSuccessText: {
    color: "#6ee7b7",
    fontSize: 10,
    fontWeight: "800"
  },
  badgeWarn: {
    backgroundColor: "#78350f",
    borderWidth: 1,
    borderColor: "#d97706"
  },
  badgeWarnText: {
    color: "#fde68a",
    fontSize: 10,
    fontWeight: "800"
  },
  badgeDanger: {
    backgroundColor: "#7f1d1d",
    borderWidth: 1,
    borderColor: "#dc2626"
  },
  badgeDangerText: {
    color: "#fca5a5",
    fontSize: 10,
    fontWeight: "800"
  },
  reasonBox: {
    backgroundColor: "#1e1e2d",
    borderLeftWidth: 3,
    borderLeftColor: "#f59e0b",
    padding: 10,
    borderRadius: 4,
    marginBottom: 12
  },
  reasonLabel: {
    color: "#fbbf24",
    fontSize: 10,
    fontWeight: "700"
  },
  reasonText: {
    color: "#f1f5f9",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2
  },
  stateGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4
  },
  stateItem: {
    width: "48%",
    backgroundColor: "#182238",
    padding: 10,
    borderRadius: 8
  },
  stateLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "600"
  },
  stateValue: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10
  },
  metricCard: {
    width: "48%",
    backgroundColor: "#141e33",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b"
  },
  metricLabel: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "600"
  },
  metricValuePrimary: {
    color: "#60a5fa",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 4
  },
  metricValue: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 4
  },
  metricSub: {
    color: "#64748b",
    fontSize: 10,
    marginTop: 2
  },
  controlsHelp: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 18
  },
  tokenInput: {
    backgroundColor: "#182238",
    borderColor: "#2d3c5e",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    color: "#f8fafc",
    fontSize: 13,
    marginBottom: 12
  },
  controlsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4
  },
  controlBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  pauseBtn: {
    backgroundColor: "#78350f",
    borderColor: "#d97706",
    borderWidth: 1
  },
  pauseBtnText: {
    color: "#fde68a",
    fontSize: 12,
    fontWeight: "700"
  },
  resumeBtn: {
    backgroundColor: "#064e3b",
    borderColor: "#059669",
    borderWidth: 1
  },
  resumeBtnText: {
    color: "#6ee7b7",
    fontSize: 12,
    fontWeight: "700"
  },
  panicBtn: {
    backgroundColor: "#991b1b",
    borderColor: "#ef4444",
    borderWidth: 1
  },
  panicBtnText: {
    color: "#fee2e2",
    fontSize: 12,
    fontWeight: "800"
  },
  controlLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 12
  },
  controlLoadingText: {
    color: "#94a3b8",
    fontSize: 12
  }
});
