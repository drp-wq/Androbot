import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runOnce } from "../src/main.js";

test("creates a default unlocked state if no state file exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "solana-killswitch-"));
  const path = join(directory, "state.json");
  try {
    const state = await runOnce(path);
    assert.equal(state.locked, false);
    const disk = JSON.parse(await readFile(path, "utf8")) as { locked: boolean };
    assert.equal(disk.locked, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
