import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  isKillswitchLocked,
  persistKillswitchLock,
  persistKillswitchUnlock,
  readKillswitchLock
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
