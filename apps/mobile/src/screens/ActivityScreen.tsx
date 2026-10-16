import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TradeEvent } from "../types";
import { formatDateTime, shortAddress } from "../utils/format";

interface ActivityScreenProps {
  readonly events: readonly TradeEvent[];
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
}

export function ActivityScreen({ events, isRefreshing, onRefresh }: ActivityScreenProps) {
  const sortedEvents = [...events].reverse();

  const getLevelStyle = (level: string) => {
    switch (level?.toLowerCase()) {
      case "error":
        return { bg: "#7f1d1d", text: "#fca5a5", border: "#dc2626" };
      case "warn":
        return { bg: "#78350f", text: "#fde68a", border: "#d97706" };
      default:
        return { bg: "#1e3a8a", text: "#bfdbfe", border: "#2563eb" };
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#60a5fa" />}
    >
      <View style={styles.headerBox}>
        <View>
          <Text style={styles.title}>System Audit Log</Text>
          <Text style={styles.subtitle}>Immutable ledger & trade intent activity</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{events.length} records</Text>
        </View>
      </View>

      {sortedEvents.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>📝</Text>
          <Text style={styles.emptyTitle}>No Activity Recorded</Text>
          <Text style={styles.emptyText}>
            Trading activity, simulation fills, and risk events will be recorded here in real time.
          </Text>
        </View>
      ) : (
        sortedEvents.map((evt, idx) => {
          const levelStyle = getLevelStyle(evt.level);
          const detailEntries = Object.entries(evt.detail ?? {});

          return (
            <View key={`${evt.at}-${idx}`} style={styles.eventCard}>
              <View style={styles.eventTop}>
                <View style={styles.actionRow}>
                  <View
                    style={[
                      styles.levelBadge,
                      { backgroundColor: levelStyle.bg, borderColor: levelStyle.border }
                    ]}
                  >
                    <Text style={[styles.levelBadgeText, { color: levelStyle.text }]}>
                      {evt.level?.toUpperCase() ?? "INFO"}
                    </Text>
                  </View>
                  <Text style={styles.actionText}>{evt.action.replace(/_/g, " ").toUpperCase()}</Text>
                </View>
                <Text style={styles.timeText}>{formatDateTime(evt.at)}</Text>
              </View>

              {evt.mint && (
                <View style={styles.mintRow}>
                  <Text style={styles.mintLabel}>Mint:</Text>
                  <Text style={styles.mintValue}>{shortAddress(evt.mint, 6, 6)}</Text>
                </View>
              )}

              {detailEntries.length > 0 && (
                <View style={styles.detailBox}>
                  {detailEntries.map(([key, val]) => (
                    <View key={key} style={styles.detailRow}>
                      <Text style={styles.detailKey}>{key}:</Text>
                      <Text style={styles.detailVal}>
                        {typeof val === "object" && val !== null ? JSON.stringify(val) : String(val)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })
      )}
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
  eventCard: {
    backgroundColor: "#0f172a",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10
  },
  eventTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1
  },
  levelBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1
  },
  levelBadgeText: {
    fontSize: 9,
    fontWeight: "800"
  },
  actionText: {
    color: "#f1f5f9",
    fontSize: 13,
    fontWeight: "700"
  },
  timeText: {
    color: "#64748b",
    fontSize: 10
  },
  mintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8
  },
  mintLabel: {
    color: "#64748b",
    fontSize: 11
  },
  mintValue: {
    color: "#94a3b8",
    fontSize: 11,
    fontFamily: "monospace"
  },
  detailBox: {
    backgroundColor: "#090e1a",
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
    gap: 4
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  detailKey: {
    color: "#64748b",
    fontSize: 10,
    fontFamily: "monospace"
  },
  detailVal: {
    color: "#cbd5e1",
    fontSize: 10,
    fontFamily: "monospace"
  }
});
