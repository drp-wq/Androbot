import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <Text style={styles.eyebrow}>DEVNET · PAPER MODE</Text>
        <Text style={styles.title}>Solana Trading System</Text>
        <Text style={styles.description}>Mobile shell ready. Paper/simulation trading is the default. Live execution, signing, push notifications, and Live Activities are not enabled.</Text>
        <View style={styles.status}>
          <Text style={styles.statusTitle}>Safety status</Text>
          <Text style={styles.statusValue}>Paper mode · no live execution</Text>
          <Text style={styles.statusNote}>For the live operations dashboard, use the mobile web app from your Android browser.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0b1020" },
  container: { flex: 1, padding: 24, justifyContent: "center" },
  eyebrow: { color: "#83a9ff", fontSize: 12, fontWeight: "700", letterSpacing: 2 },
  title: { color: "#e8edf8", fontSize: 34, fontWeight: "800", marginTop: 14 },
  description: { color: "#a9b4cc", fontSize: 16, lineHeight: 24, marginTop: 14 },
  status: { borderColor: "#26314a", borderWidth: 1, borderRadius: 16, padding: 20, marginTop: 32 },
  statusTitle: { color: "#a9b4cc", fontSize: 13 },
  statusValue: { color: "#f2c66d", fontSize: 20, fontWeight: "700", marginTop: 8 },
  statusNote: { color: "#a9b4cc", marginTop: 8, lineHeight: 20 }
});
