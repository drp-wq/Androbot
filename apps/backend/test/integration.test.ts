import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileLedger } from "@solana-system/engine";
import { persistKillswitchUnlock } from "@solana-system/shared";
import { createServer } from "../src/server.js";

const TOKEN = "integration-control-token-123456";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The backend must restore paper accounting from the append-only ledger before the
 * first tick, so a restart neither forgets positions nor double-counts fills.
 */
test("reconciles the ledger into the portfolio on startup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "backend-reconcile-"));
  const restartAt = new Date().toISOString();
  const ledger = new FileLedger(join(directory, "ledger.jsonl"));
  await ledger.append({
    type: "fill",
    data: {
      mint: "mintA",
      symbol: "AAA",
      side: "buy",
      quantityTokens: "20",
      priceLamports: "100",
      feeLamports: "0",
      reason: "test_seed"
    }
  });

  const app = createServer({ env: { NODE_ENV: "test", STATE_DIR: directory, SCANNER_INTERVAL_MS: "60000" }, autostart: false });
  try {
    const status = await app.inject({ method: "GET", url: "/api/status" });
    const body = status.json() as { cashLamports: string; positions: { mint: string; quantityTokens: string }[] };
    assert.equal(body.cashLamports, (10_000_000_000n - 2_000n).toString());
    assert.equal(body.positions.length, 1);
    assert.equal(body.positions[0]?.mint, "mintA");
    assert.equal(body.positions[0]?.quantityTokens, "20");

    const ready = await app.inject({ method: "GET", url: "/ready" });
    const readyBody = ready.json() as { reconciled: boolean | null; fillsReplayed: number; ready: boolean };
    assert.equal(readyBody.reconciled, true);
    assert.equal(readyBody.fillsReplayed, 1);
    assert.equal(readyBody.ready, true);

    const entries = (await ledger.readAll()).filter((entry) => entry.data["action"] === "ledger_reconciled");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.data["fillsApplied"], 1);
    assert.ok(entries[0]?.at !== undefined && entries[0].at >= restartAt);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a corrupt ledger fails closed: reconciliation off, trading paused, not ready", async () => {
  const directory = await mkdtemp(join(tmpdir(), "backend-corrupt-"));
  await writeFile(join(directory, "ledger.jsonl"), "{not json}\n", "utf8");

  const app = createServer({ env: { NODE_ENV: "test", STATE_DIR: directory, SCANNER_INTERVAL_MS: "60000" }, autostart: false });
  try {
    const ready = await app.inject({ method: "GET", url: "/ready" });
    const readyBody = ready.json() as { ready: boolean; reconciled: boolean | null; note: string };
    assert.equal(readyBody.reconciled, false);
    assert.equal(readyBody.ready, false);
    assert.match(readyBody.note, /reconciliation failed/i);

    const status = await app.inject({ method: "GET", url: "/api/status" });
    const body = status.json() as { paused: boolean; pauseReason: string | null };
    assert.equal(body.paused, true);
    assert.equal(body.pauseReason, "ledger_reconciliation_failed");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * End-to-end paper-trading lifecycle through the real HTTP surface with the
 * autonomous loop enabled. This verifies the whole class of safety behavior the
 * project depends on: the loop ticks, the control API is token-gated, panic writes
 * a durable lock, the lock halts reported trading, and only an explicit operator
 * unlock clears it. No real transaction is ever involved.
 */
test("paper loop runs and the killswitch lock is enforced end to end", async () => {
  const directory = await mkdtemp(join(tmpdir(), "backend-integration-"));
  const env = {
    NODE_ENV: "test",
    STATE_DIR: directory,
    SCANNER_INTERVAL_MS: "100",
    ENABLE_CONTROL_API: "true",
    CONTROL_API_TOKEN: TOKEN
  };
  const app = createServer({ env });
  try {
    // Let the autonomous loop run a few ticks.
    await delay(250);

    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
    assert.equal((health.json() as { mode: string }).mode, "paper");

    const readyBefore = await app.inject({ method: "GET", url: "/ready" });
    assert.equal((readyBefore.json() as { ready: boolean }).ready, true);

    const statusBefore = await app.inject({ method: "GET", url: "/api/status" });
    const before = statusBefore.json() as { mode: string; ticks: number; paused: boolean; locked: boolean; positions: unknown[] };
    assert.equal(before.mode, "paper");
    assert.ok(before.ticks >= 1, `expected at least one tick, got ${before.ticks}`);
    assert.equal(before.paused, false);
    assert.equal(before.locked, false);

    // The ledger endpoint must respond even when there are no fills yet.
    const ledger = await app.inject({ method: "GET", url: "/api/ledger" });
    assert.equal(ledger.statusCode, 200);
    assert.ok(Array.isArray((ledger.json() as { entries: unknown[] }).entries));

    // Unauthenticated panic must be rejected and must not lock anything.
    const unauthorized = await app.inject({ method: "POST", url: "/api/control/panic", payload: { reason: "intruder" } });
    assert.equal(unauthorized.statusCode, 401);

    // Authenticated panic pauses and writes a durable lock.
    const panic = await app.inject({
      method: "POST",
      url: "/api/control/panic",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { reason: "integration" }
    });
    assert.equal(panic.statusCode, 200);
    assert.equal((panic.json() as { locked: boolean }).locked, true);

    await delay(200);

    const readyLocked = await app.inject({ method: "GET", url: "/ready" });
    const lockedBody = readyLocked.json() as { ready: boolean; locked: boolean; lockReason: string | null };
    assert.equal(lockedBody.ready, false);
    assert.equal(lockedBody.locked, true);

    const statusLocked = await app.inject({ method: "GET", url: "/api/status" });
    const lockedStatus = statusLocked.json() as { paused: boolean; locked: boolean; lockReason: string | null };
    assert.equal(lockedStatus.locked, true);
    assert.equal(lockedStatus.paused, true);
    assert.match(lockedStatus.lockReason ?? "", /panic:integration/);

    // resume() must NOT be able to override the durable lock.
    const resume = await app.inject({
      method: "POST",
      url: "/api/control/resume",
      headers: { authorization: `Bearer ${TOKEN}` }
    });
    assert.equal(resume.statusCode, 200);
    await delay(200);
    const statusStillLocked = await app.inject({ method: "GET", url: "/api/status" });
    assert.equal((statusStillLocked.json() as { locked: boolean }).locked, true);

    // Only an explicit operator unlock clears the lock.
    await persistKillswitchUnlock(join(directory, "killswitch-state.json"));
    await delay(200);
    const statusUnlocked = await app.inject({ method: "GET", url: "/api/status" });
    assert.equal((statusUnlocked.json() as { locked: boolean }).locked, false);

    const readyAfter = await app.inject({ method: "GET", url: "/ready" });
    assert.equal((readyAfter.json() as { ready: boolean }).ready, true);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
