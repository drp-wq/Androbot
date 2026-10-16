import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ensureKillswitchState,
  isKillswitchLocked,
  persistKillswitchLock,
  persistKillswitchUnlock,
  readKillswitchLock,
  resolveKillswitchArmedPath
} from "../src/index.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "shared-killswitch-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("a missing lock file is treated as unlocked", async () => {
  await withTempDir(async (directory) => {
    const read = await readKillswitchLock(join(directory, "missing.json"));
    assert.equal(read.ok, true);
    assert.equal(isKillswitchLocked(read), false);
  });
});

test("a malformed or unreadable lock file fails closed", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "state.json");
    await writeFile(path, "{ not json", "utf8");
    const read = await readKillswitchLock(path);
    assert.equal(read.ok, false);
    assert.equal(isKillswitchLocked(read), true);
  });
});

test("a locked state is reported as locked", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "state.json");
    await persistKillswitchLock(path, "panic:manual");
    const read = await readKillswitchLock(path);
    assert.equal(read.ok, true);
    assert.equal(isKillswitchLocked(read), true);
    if (read.ok) assert.equal(read.state.reason, "panic:manual");
  });
});

test("an explicit unlock clears the lock", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "state.json");
    await persistKillswitchLock(path, "manual_lock");
    await persistKillswitchUnlock(path);
    const read = await readKillswitchLock(path);
    assert.equal(isKillswitchLocked(read), false);
  });
});

test("lock state with an unparseable timestamp is rejected", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "state.json");
    await writeFile(path, JSON.stringify({ locked: true, reason: "x", changedAt: "not-a-date" }), "utf8");
    const read = await readKillswitchLock(path);
    assert.equal(read.ok, false);
    assert.equal(isKillswitchLocked(read), true);
  });
});

test("deleting an armed lock file stays fail-closed instead of resetting to unlocked", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "state.json");
    await persistKillswitchUnlock(path);
    await rm(path);
    const read = await readKillswitchLock(path);
    assert.equal(read.ok, false);
    assert.equal(read.ok ? null : read.error, "killswitch_state_missing");
    assert.equal(isKillswitchLocked(read), true);
  });
});

test("state and armed sentinel are written with owner-only permissions", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "state.json");
    await persistKillswitchLock(path, "manual_lock");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(resolveKillswitchArmedPath(path))).mode & 0o777, 0o600);
  });
});

test("leaves no temp files behind after an atomic write", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "state.json");
    await persistKillswitchLock(path, "manual_lock");
    const leftovers = (await readdir(directory)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  });
});

test("ensureKillswitchState arms a fresh state but fails closed after deletion", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "state.json");
    const initial = await ensureKillswitchState(path);
    assert.equal(initial.locked, false);

    await rm(path);
    const recovered = await ensureKillswitchState(path);
    assert.equal(recovered.locked, true);
    assert.equal(recovered.reason, "killswitch_state_missing");
  });
});
