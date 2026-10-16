import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { checkBackendHealth } from "../api/client";
import type { ConnectionState } from "../types";

interface SettingsScreenProps {
  readonly currentBackendUrl: string;
  readonly connection: ConnectionState;
  readonly pollIntervalMs: number;
  readonly onSaveBackendUrl: (url: string) => void;
  readonly onChangePollInterval: (intervalMs: number) => void;
}

export function SettingsScreen({
  currentBackendUrl,
  connection,
  pollIntervalMs,
  onSaveBackendUrl,
  onChangePollInterval
}: SettingsScreenProps) {
  const [inputUrl, setInputUrl] = useState(currentBackendUrl);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    message: string;
  } | null>(null);

  const handleTestPing = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await checkBackendHealth(inputUrl);
      if (result.ok && result.health) {
        setTestResult({
          ok: true,
          latencyMs: result.latencyMs,
          message: `Connected (${result.latencyMs}ms): ${result.health.service} (${result.health.network} · ${result.health.mode})`
        });
      } else {
        setTestResult({
          ok: false,
          latencyMs: result.latencyMs,
          message: result.error ?? "Failed to reach backend."
        });
      }
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    const trimmed = inputUrl.trim().replace(/\/+$/, "");
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      Alert.alert("Invalid URL", "Backend URL must start with http:// or https://");
      return;
    }
    onSaveBackendUrl(trimmed);
    Alert.alert("Host Saved", `Connecting to ${trimmed}`);
  };

  const handleApplyPreset = (presetUrl: string) => {
    setInputUrl(presetUrl);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Backend Host Connection</Text>
        <Text style={styles.cardSubtitle}>
          Configure the API endpoint for your Solana trading engine instance.
        </Text>

        <View style={styles.connectionStatusRow}>
          <Text style={styles.connectionStatusLabel}>Active Link:</Text>
          <Text style={[styles.connectionStatusValue, { color: connection.isConnected ? "#10b981" : "#ef4444" }]}>
            {connection.isConnected ? `Connected (${connection.latencyMs ?? 0}ms)` : "Disconnected / Offline"}
          </Text>
        </View>

        <TextInput
          style={styles.input}
          value={inputUrl}
          onChangeText={setInputUrl}
          placeholder="http://10.0.2.2:8787"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <View style={styles.presetsRow}>
          <Text style={styles.presetsLabel}>Presets:</Text>
          <TouchableOpacity
            style={styles.presetChip}
            onPress={() => handleApplyPreset("http://10.0.2.2:8787")}
            activeOpacity={0.7}
          >
            <Text style={styles.presetChipText}>10.0.2.2 (Emulator)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.presetChip}
            onPress={() => handleApplyPreset("http://127.0.0.1:8787")}
            activeOpacity={0.7}
          >
            <Text style={styles.presetChipText}>127.0.0.1 (Local)</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btn, styles.testBtn]}
            onPress={() => void handleTestPing()}
            disabled={isTesting}
            activeOpacity={0.7}
          >
            {isTesting ? (
              <ActivityIndicator size="small" color="#60a5fa" />
            ) : (
              <Text style={styles.testBtnText}>⚡ Test Ping</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.saveBtn]}
            onPress={handleSave}
            activeOpacity={0.7}
          >
            <Text style={styles.saveBtnText}>✓ Save & Connect</Text>
          </TouchableOpacity>
        </View>

        {testResult && (
          <View
            style={[
              styles.testResultBox,
              testResult.ok ? styles.testResultSuccess : styles.testResultError
            ]}
          >
            <Text
              style={[
                styles.testResultText,
                testResult.ok ? styles.testResultSuccessText : styles.testResultErrorText
              ]}
            >
              {testResult.message}
            </Text>
          </View>
        )}
      </View>

      {/* Polling Interval Selection */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Live Polling Frequency</Text>
        <Text style={styles.cardSubtitle}>
          Adjust how often the mobile client syncs account state and market quotes.
        </Text>

        <View style={styles.pollRow}>
          {[
            { label: "3 sec", ms: 3000 },
            { label: "5 sec", ms: 5000 },
            { label: "10 sec", ms: 10000 },
            { label: "Manual", ms: 0 }
          ].map((opt) => {
            const isSelected = pollIntervalMs === opt.ms;
            return (
              <TouchableOpacity
                key={opt.label}
                style={[styles.pollChip, isSelected && styles.pollChipSelected]}
                onPress={() => onChangePollInterval(opt.ms)}
                activeOpacity={0.7}
              >
                <Text style={[styles.pollChipText, isSelected && styles.pollChipSelectedText]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Safety & Compliance Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Mandatory Safety Controls</Text>

        <View style={styles.safetyItem}>
          <Text style={styles.safetyItemTitle}>🔒 Paper Mode Only</Text>
          <Text style={styles.safetyItemDesc}>
            This application is hard-locked to Devnet paper simulation mode. Live wallet signing, private-key handling, and mainnet execution are strictly disabled.
          </Text>
        </View>

        <View style={styles.safetyItem}>
          <Text style={styles.safetyItemTitle}>🛡️ Independent Multi-Layer Killswitch</Text>
          <Text style={styles.safetyItemDesc}>
            If daily loss exceeds limits or an operator triggers panic, the backend writes a durable lock file and halts execution until human operator reset.
          </Text>
        </View>

        <View style={styles.safetyItem}>
          <Text style={styles.safetyItemTitle}>⚡ Anti-Rug Enforcement</Text>
          <Text style={styles.safetyItemDesc}>
            Pre-trade simulation rejects unverified token contracts, active freeze authorities, and unburned liquidity pools.
          </Text>
        </View>
      </View>

      {/* Build Info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>App Information</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Package</Text>
          <Text style={styles.infoValue}>@solana-system/mobile</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Version</Text>
          <Text style={styles.infoValue}>0.1.0</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Expo SDK</Text>
          <Text style={styles.infoValue}>52.0.49</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Architecture</Text>
          <Text style={styles.infoValue}>New Architecture (Bridgeless)</Text>
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
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 18
  },
  input: {
    backgroundColor: "#182238",
    borderColor: "#2d3c5e",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    color: "#f8fafc",
    fontSize: 14,
    marginBottom: 10
  },
  presetsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14
  },
  presetsLabel: {
    color: "#64748b",
    fontSize: 11
  },
  presetChip: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4
  },
  presetChipText: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "600"
  },
  btnRow: {
    flexDirection: "row",
    gap: 10
  },
  btn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  testBtn: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#3b82f6"
  },
  testBtnText: {
    color: "#60a5fa",
    fontSize: 13,
    fontWeight: "700"
  },
  saveBtn: {
    backgroundColor: "#2563eb"
  },
  saveBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700"
  },
  testResultBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1
  },
  testResultSuccess: {
    backgroundColor: "#064e3b",
    borderColor: "#059669"
  },
  testResultError: {
    backgroundColor: "#7f1d1d",
    borderColor: "#dc2626"
  },
  testResultText: {
    fontSize: 12,
    lineHeight: 16
  },
  testResultSuccessText: {
    color: "#a7f3d0"
  },
  testResultErrorText: {
    color: "#fecaca"
  },
  pollRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6
  },
  pollChip: {
    flex: 1,
    backgroundColor: "#182238",
    borderColor: "#2d3c5e",
    borderWidth: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center"
  },
  pollChipSelected: {
    backgroundColor: "#1e3a8a",
    borderColor: "#3b82f6"
  },
  pollChipText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600"
  },
  pollChipSelectedText: {
    color: "#93c5fd",
    fontWeight: "700"
  },
  safetyItem: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#1e293b"
  },
  safetyItemTitle: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "700"
  },
  safetyItemDesc: {
    color: "#94a3b8",
    fontSize: 11,
    marginTop: 2,
    lineHeight: 16
  },
  infoCard: {
    backgroundColor: "#0d1424",
    borderColor: "#1e293b",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14
  },
  infoTitle: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 8
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4
  },
  infoLabel: {
    color: "#64748b",
    fontSize: 11
  },
  infoValue: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "600"
  },
  connectionStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10
  },
  connectionStatusLabel: {
    color: "#64748b",
    fontSize: 12
  },
  connectionStatusValue: {
    fontSize: 12,
    fontWeight: "700"
  }
});
