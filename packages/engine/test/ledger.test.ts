import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileLedger } from "../src/index.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "engine-ledger-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("FileLedger appends a verifiable hash chain and reads it back", async () => {
  await withTempDir(async (directory) => {
    const ledger = new FileLedger(join(directory, "ledger.jsonl"));
    const first = await ledger.append({ type: "intent", data: { side: "buy" } });
    const second = await ledger.append({ type: "fill", data: { side: "buy" } });
    assert.equal(first.prevHash?.length, 64);
    assert.equal(first.hash?.length, 64);
    assert.equal(second.prevHash, first.hash);

    const entries = await ledger.readAll();
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.id), [first.id, second.id]);
  });
});

test("a second FileLedger instance continues the persisted chain across a restart", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "ledger.jsonl");
    const first = new FileLedger(path);
    const initial = await first.append({ type: "intent", data: { side: "buy" } });

    const restarted = new FileLedger(path);
    const second = await restarted.append({ type: "fill", data: { side: "buy" } });
    assert.equal(second.prevHash, initial.hash);

    const entries = await restarted.readAll();
    assert.equal(entries.length, 2);
  });
});

test("FileLedger rejects an edited entry (hash mismatch)", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "ledger.jsonl");
    const ledger = new FileLedger(path);
    await ledger.append({ type: "fill", data: { quantityTokens: "10" } });
    await ledger.append({ type: "fill", data: { quantityTokens: "20" } });

    const lines = (await readFile(path, "utf8")).split("\n").filter((line) => line.trim() !== "");
    const edited = JSON.parse(lines[0]!) as { data: Record<string, unknown> };
    edited.data["quantityTokens"] = "9999";
    lines[0] = JSON.stringify(edited);
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");

    await assert.rejects(() => ledger.readAll(), /hash does not match/);
  });
});

test("FileLedger rejects a broken link (removed entry)", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "ledger.jsonl");
    const ledger = new FileLedger(path);
    await ledger.append({ type: "fill", data: { sequence: 1 } });
    await ledger.append({ type: "fill", data: { sequence: 2 } });
    await ledger.append({ type: "fill", data: { sequence: 3 } });

    const lines = (await readFile(path, "utf8")).split("\n").filter((line) => line.trim() !== "");
    await writeFile(path, `${[lines[0], lines[2]].join("\n")}\n`, "utf8");

    await assert.rejects(() => ledger.readAll(), /hash chain is broken/);
  });
});

test("FileLedger rejects an entry written without a hash chain", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "ledger.jsonl");
    await writeFile(path, `${JSON.stringify({ id: "x", at: new Date().toISOString(), type: "fill", data: {} })}\n`, "utf8");
    const ledger = new FileLedger(path);
    await assert.rejects(() => ledger.readAll(), /missing its hash chain/);
  });
});

test("FileLedger creates its file with owner-only permissions", async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, "ledger.jsonl");
    const ledger = new FileLedger(path);
    await ledger.append({ type: "intent", data: {} });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  });
});
