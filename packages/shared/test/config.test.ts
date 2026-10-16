import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadEnvFileIfPresent, loadRuntimeConfig, parseBoolean, parseCorsAllowedOrigins, redactSecrets, TradeIntentSchema, LIVE_TRADING_ACK_PHRASE } from "../src/index.js";

test("defaults to devnet and disables mainnet trading", () => {
  const config = loadRuntimeConfig({});
  assert.equal(config.network, "devnet");
  assert.equal(config.mainnetTradingEnabled, false);
});

test("rejects mainnet without explicit enablement", () => {
  assert.throws(() => loadRuntimeConfig({ NETWORK: "mainnet" }), /Mainnet is disabled/);
});

test("rejects invalid boolean environment values", () => {
  assert.throws(() => parseBoolean("yes"), /exactly 'true' or 'false'/);
});

test("defaults to paper mode with sensible risk limits", () => {
  const config = loadRuntimeConfig({});
  assert.equal(config.tradingMode, "paper");
  assert.equal(config.enableControlApi, false);
  assert.ok(config.maxSlippageBps >= 1 && config.maxSlippageBps <= 1000);
});

test("rejects live mode without the explicit acknowledgement", () => {
  assert.throws(
    () => loadRuntimeConfig({ NETWORK: "mainnet", MAINNET_TRADING_ENABLED: "true", TRADING_MODE: "live" }),
    /LIVE_TRADING_ACK/
  );
});

test("allows live mode only with mainnet, enablement and the acknowledgement", () => {
  const config = loadRuntimeConfig({
    NETWORK: "mainnet",
    MAINNET_TRADING_ENABLED: "true",
    TRADING_MODE: "live",
    LIVE_TRADING_ACK: LIVE_TRADING_ACK_PHRASE
  });
  assert.equal(config.tradingMode, "live");
});

test("control API requires a token when enabled", () => {
  assert.throws(() => loadRuntimeConfig({ ENABLE_CONTROL_API: "true" }), /CONTROL_API_TOKEN/);
});

test("CORS allowlist is explicit and rejects a wildcard or malformed origins", () => {
  assert.throws(() => parseCorsAllowedOrigins("*"), /explicit allowlist/);
  assert.throws(() => parseCorsAllowedOrigins("not a url"), /invalid origin/);
  assert.throws(() => parseCorsAllowedOrigins("http://localhost:3000/dashboard"), /bare origins/);
  assert.deepEqual(parseCorsAllowedOrigins("http://a.example, http://b.example"), ["http://a.example", "http://b.example"]);
  assert.ok(parseCorsAllowedOrigins(undefined).includes("http://localhost:3000"));
});

test("runtime config carries the parsed CORS allowlist", () => {
  const config = loadRuntimeConfig({ CORS_ALLOWED_ORIGINS: "http://localhost:3000" });
  assert.deepEqual(config.corsAllowedOrigins, ["http://localhost:3000"]);
  assert.throws(() => loadRuntimeConfig({ CORS_ALLOWED_ORIGINS: "*" }), /explicit allowlist/);
});

test("loadEnvFileIfPresent returns false when the file is absent", () => {
  assert.equal(loadEnvFileIfPresent(join(tmpdir(), "definitely-missing-env-file")), false);
});

test("loadEnvFileIfPresent loads new keys but never overrides the real environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shared-env-"));
  const path = join(directory, ".env");
  const previous = process.env.SOLANA_SYSTEM_TEST_LOADED;
  const previousOverride = process.env.SOLANA_SYSTEM_TEST_OVERRIDE;
  try {
    await writeFile(path, "SOLANA_SYSTEM_TEST_LOADED=from-file\nSOLANA_SYSTEM_TEST_OVERRIDE=from-file\n", "utf8");
    delete process.env.SOLANA_SYSTEM_TEST_LOADED;
    process.env.SOLANA_SYSTEM_TEST_OVERRIDE = "from-shell";
    assert.equal(loadEnvFileIfPresent(path), true);
    assert.equal(process.env.SOLANA_SYSTEM_TEST_LOADED, "from-file");
    assert.equal(process.env.SOLANA_SYSTEM_TEST_OVERRIDE, "from-shell");
  } finally {
    if (previous === undefined) delete process.env.SOLANA_SYSTEM_TEST_LOADED;
    else process.env.SOLANA_SYSTEM_TEST_LOADED = previous;
    if (previousOverride === undefined) delete process.env.SOLANA_SYSTEM_TEST_OVERRIDE;
    else process.env.SOLANA_SYSTEM_TEST_OVERRIDE = previousOverride;
    await rm(directory, { recursive: true, force: true });
  }
});

test("redacts secret-looking keys from log records", () => {
  const redacted = redactSecrets({ apiKey: "abc", nested: { privateKey: "xyz", plain: 1 } }) as Record<string, unknown>;
  assert.equal(redacted["apiKey"], "[redacted]");
  assert.deepEqual(redacted["nested"], { privateKey: "[redacted]", plain: 1 });
});

test("validates trade intent shape and bounds", () => {
  const result = TradeIntentSchema.safeParse({
    idempotencyKey: "c7c3b79d-9e6c-4a84-bf80-0a8b7c9d5d15",
    mintAddress: "So11111111111111111111111111111111111111112",
    side: "buy",
    amountLamports: 1000,
    maxSlippageBps: 100
  });
  assert.equal(result.success, true);
});
