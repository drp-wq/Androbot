import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import {
  DEFAULT_BACKEND_URL,
  checkBackendHealth,
  fetchBackendReady,
  fetchEvents,
  fetchMarkets,
  fetchTraderStatus,
  sendControlAction
} from "./src/api/client";
import { Header } from "./src/components/Header";
import { NavigationTabs } from "./src/components/NavigationTabs";
import { ActivityScreen } from "./src/screens/ActivityScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { MarketsScreen } from "./src/screens/MarketsScreen";
import { PortfolioScreen } from "./src/screens/PortfolioScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import type { BackendReady, ConnectionState, MarketRow, TabName, TradeEvent, TraderStatus } from "./src/types";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabName>("dashboard");
  const [backendUrl, setBackendUrl] = useState<string>(DEFAULT_BACKEND_URL);
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(5000);

  const [status, setStatus] = useState<TraderStatus | null>(null);
  const [ready, setReady] = useState<BackendReady | null>(null);
  const [markets, setMarkets] = useState<readonly MarketRow[]>([]);
  const [events, setEvents] = useState<readonly TradeEvent[]>([]);

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [connection, setConnection] = useState<ConnectionState>({
    isConnected: false,
    isChecking: true,
    lastCheckedAt: null,
    errorMessage: null,
    latencyMs: null
  });

  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const syncData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setIsRefreshing(true);
    }

    setConnection((prev) => ({ ...prev, isChecking: true }));

    try {
      const healthCheck = await checkBackendHealth(backendUrl);

      if (!isMountedRef.current) return;

      if (!healthCheck.ok) {
        setConnection({
          isConnected: false,
          isChecking: false,
          lastCheckedAt: new Date().toISOString(),
          errorMessage: healthCheck.error ?? "Backend offline or unreachable.",
          latencyMs: healthCheck.latencyMs
        });
        if (isManualRefresh) setIsRefreshing(false);
        return;
      }

      // Fetch primary trading data in parallel
      const [statusRes, readyRes, marketsRes, eventsRes] = await Promise.allSettled([
        fetchTraderStatus(backendUrl),
        fetchBackendReady(backendUrl),
        fetchMarkets(backendUrl),
        fetchEvents(backendUrl)
      ]);

      if (!isMountedRef.current) return;

      if (statusRes.status === "fulfilled") {
        setStatus(statusRes.value);
      }
      if (readyRes.status === "fulfilled") {
        setReady(readyRes.value);
      }
      if (marketsRes.status === "fulfilled") {
        setMarkets(marketsRes.value);
      }
      if (eventsRes.status === "fulfilled") {
        setEvents(eventsRes.value);
      }

      setConnection({
        isConnected: true,
        isChecking: false,
        lastCheckedAt: new Date().toISOString(),
        errorMessage: null,
        latencyMs: healthCheck.latencyMs
      });
    } catch (err) {
      if (!isMountedRef.current) return;
      setConnection({
        isConnected: false,
        isChecking: false,
        lastCheckedAt: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : "Sync error",
        latencyMs: null
      });
    } finally {
      if (isMountedRef.current && isManualRefresh) {
        setIsRefreshing(false);
      }
    }
  }, [backendUrl]);

  // Initial sync & interval timer
  useEffect(() => {
    void syncData(false);

    if (pollIntervalMs > 0) {
      const timer = setInterval(() => {
        void syncData(false);
      }, pollIntervalMs);
      return () => clearInterval(timer);
    }
    return undefined;
  }, [syncData, pollIntervalMs]);

  const handleControlAction = async (action: "pause" | "resume" | "panic", token?: string) => {
    const result = await sendControlAction(backendUrl, action, token);
    if (result.success) {
      Alert.alert("Action Executed", result.message);
    } else {
      Alert.alert("Action Failed", result.message);
    }
    await syncData(true);
  };

  const renderActiveScreen = () => {
    switch (activeTab) {
      case "dashboard":
        return (
          <DashboardScreen
            status={status}
            ready={ready}
            connection={connection}
            isRefreshing={isRefreshing}
            onRefresh={() => void syncData(true)}
            onControlAction={handleControlAction}
            onNavigateToSettings={() => setActiveTab("settings")}
          />
        );
      case "portfolio":
        return (
          <PortfolioScreen
            status={status}
            isRefreshing={isRefreshing}
            onRefresh={() => void syncData(true)}
          />
        );
      case "markets":
        return (
          <MarketsScreen
            markets={markets}
            isRefreshing={isRefreshing}
            onRefresh={() => void syncData(true)}
          />
        );
      case "activity":
        return (
          <ActivityScreen
            events={events}
            isRefreshing={isRefreshing}
            onRefresh={() => void syncData(true)}
          />
        );
      case "settings":
        return (
          <SettingsScreen
            currentBackendUrl={backendUrl}
            connection={connection}
            pollIntervalMs={pollIntervalMs}
            onSaveBackendUrl={(newUrl) => {
              setBackendUrl(newUrl);
            }}
            onChangePollInterval={setPollIntervalMs}
          />
        );
    }
  };

  return (
    <View style={styles.appContainer}>
      <StatusBar style="light" />
      <Header
        connection={connection}
        isRefreshing={isRefreshing}
        onRefresh={() => void syncData(true)}
      />

      <View style={styles.body}>{renderActiveScreen()}</View>

      <NavigationTabs
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        openPositionsCount={status?.openPositions ?? 0}
        marketsCount={markets.length}
        eventsCount={events.length}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: "#080c18"
  },
  body: {
    flex: 1
  }
});
