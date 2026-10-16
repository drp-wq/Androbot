import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateKillSwitch, runOnce, startKillswitchMonitor, type Heartbeat } from "../src/main.js";

function heartbeat(overrides: Partial<Heartbeat> = {}): Heartbeat {
  return {
    paused: false,
    pauseReason: null,
    dailyLossLamports: "0",
    maxDailyLossLamports: "1000",
    rpcFailureStreak: 0,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

const options = { maxStalenessMs: 30_000 };

test("creates a default unlocked state if no state file exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "solana-killswitch-"));
  const path = join(directory, "state.json");
  try {
    const state = await runOnce(path, { heartbeatPath: join(directory, "missing.json") });
    assert.equal(state.locked, false);
    const disk = JSON.parse(await readFile(path, "utf8")) as { locked: boolean };
    assert.equal(disk.locked, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not lock without a heartbeat", () => {
  const decision = evaluateKillSwitch(null, false, new Date(), options);
  assert.equal(decision.shouldLock, false);
});

test("locks when the daily loss limit is reached", () => {
  const decision = evaluateKillSwitch(heartbeat({ dailyLossLamports: "1000" }), false, new Date(), options);
  assert.equal(decision.shouldLock, true);
  assert.equal(decision.reason, "daily_loss_limit");
});

test("locks on a stale heartbeat", () => {
  const stale = heartbeat({ updatedAt: new Date(Date.now() - 60_000).toISOString() });
  const decision = evaluateKillSwitch(stale, false, new Date(), options);
  assert.equal(decision.shouldLock, true);
  assert.equal(decision.reason, "heartbeat_stale");
});

test("locks on an RPC failure streak or panic", () => {
  assert.equal(evaluateKillSwitch(heartbeat({ pauseReason: "rpc_failure_streak" }), false, new Date(), options).reason, "rpc_failure_streak");
  assert.equal(evaluateKillSwitch(heartbeat({ paused: true, pauseReason: "panic:manual" }), false, new Date(), options).shouldLock, true);
});

test("monitor loop re-evaluates and locks when the heartbeat breaches the limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "solana-killswitch-"));
  const statePath = join(directory, "state.json");
  const hbPath = join(directory, "hb.json");
  const monitor = startKillswitchMonitor(statePath, { heartbeatPath: hbPath, intervalMs: 20 });
  try {
    // Healthy heartbeat first: the monitor must not lock.
    await writeFile(hbPath, JSON.stringify(heartbeat()));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal((JSON.parse(await readFile(statePath, "utf8")) as { locked: boolean }).locked, false);

    // Now breach the daily-loss limit; the running monitor must lock on its own.
    await writeFile(hbPath, JSON.stringify(heartbeat({ dailyLossLamports: "1000" })));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const locked = JSON.parse(await readFile(statePath, "utf8")) as { locked: boolean; reason: string | null };
    assert.equal(locked.locked, true);
    assert.equal(locked.reason, "daily_loss_limit");
  } finally {
    await monitor.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("stays locked once locked and can be explicitly unlocked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "solana-killswitch-"));
  const statePath = join(directory, "state.json");
  const hbPath = join(directory, "hb.json");
  try {
    await writeFile(statePath, JSON.stringify({ locked: true, reason: "manual_lock", changedAt: "2026-01-01T00:00:00.000Z" }));
    await writeFile(hbPath, JSON.stringify(heartbeat()));
    const locked = await runOnce(statePath, { heartbeatPath: hbPath });
    assert.equal(locked.locked, true);
    assert.equal(locked.reason, "manual_lock");

    const unlocked = await runOnce(statePath, { heartbeatPath: hbPath, unlock: true });
    assert.equal(unlocked.locked, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
