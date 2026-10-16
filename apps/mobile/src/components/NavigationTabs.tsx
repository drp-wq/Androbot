import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { TabName } from "../types";

interface NavigationTabsProps {
  readonly activeTab: TabName;
  readonly onSelectTab: (tab: TabName) => void;
  readonly openPositionsCount: number;
  readonly marketsCount: number;
  readonly eventsCount: number;
}

interface TabItem {
  readonly id: TabName;
  readonly label: string;
  readonly icon: string;
  readonly badge?: number | undefined;
}

export function NavigationTabs({
  activeTab,
  onSelectTab,
  openPositionsCount,
  marketsCount,
  eventsCount
}: NavigationTabsProps) {
  const tabs: readonly TabItem[] = [
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "portfolio", label: "Portfolio", icon: "💼", badge: openPositionsCount > 0 ? openPositionsCount : undefined },
    { id: "markets", label: "Markets", icon: "📈", badge: marketsCount > 0 ? marketsCount : undefined },
    { id: "activity", label: "Activity", icon: "⚡", badge: eventsCount > 0 ? eventsCount : undefined },
    { id: "settings", label: "Settings", icon: "⚙️" }
  ];

  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tabButton, isActive && styles.activeTabButton]}
            onPress={() => onSelectTab(tab.id)}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainer}>
              <Text style={styles.tabIcon}>{tab.icon}</Text>
              {tab.badge !== undefined && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{tab.badge > 99 ? "99+" : tab.badge}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.tabLabel, isActive && styles.activeTabLabel]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#0d1424",
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingBottom: 8,
    paddingTop: 6,
    justifyContent: "space-around"
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 4
  },
  activeTabButton: {
    borderTopWidth: 2,
    borderTopColor: "#3b82f6",
    marginTop: -2
  },
  iconContainer: {
    position: "relative",
    width: 28,
    height: 24,
    alignItems: "center",
    justifyContent: "center"
  },
  tabIcon: {
    fontSize: 16
  },
  tabLabel: {
    fontSize: 10,
    color: "#64748b",
    fontWeight: "600",
    marginTop: 2
  },
  activeTabLabel: {
    color: "#60a5fa",
    fontWeight: "700"
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -6,
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    minWidth: 14,
    alignItems: "center"
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 8,
    fontWeight: "800"
  }
});
