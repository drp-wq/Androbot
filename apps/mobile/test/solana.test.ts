import assert from "node:assert";
import test from "node:test";
import { isValidSolanaAddress } from "../src/utils/solana.ts";

test("isValidSolanaAddress validates standard Solana public keys", () => {
  // Real Solana addresses
  assert.strictEqual(
    isValidSolanaAddress("So11111111111111111111111111111111111111112"),
    true
  );
  assert.strictEqual(
    isValidSolanaAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    true
  );
  assert.strictEqual(
    isValidSolanaAddress("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"),
    true
  );
});

test("isValidSolanaAddress rejects invalid inputs", () => {
  assert.strictEqual(isValidSolanaAddress(""), false);
  assert.strictEqual(isValidSolanaAddress("short"), false);
  assert.strictEqual(isValidSolanaAddress(null), false);
  assert.strictEqual(isValidSolanaAddress(undefined), false);
  assert.strictEqual(isValidSolanaAddress(12345), false);
  // Invalid base58 character '0' (zero is not in base58 alphabet)
  assert.strictEqual(
    isValidSolanaAddress("0o11111111111111111111111111111111111111112"),
    false
  );
  // Invalid base58 character 'O'
  assert.strictEqual(
    isValidSolanaAddress("Oo11111111111111111111111111111111111111112"),
    false
  );
  // Invalid base58 character 'I'
  assert.strictEqual(
    isValidSolanaAddress("Io11111111111111111111111111111111111111112"),
    false
  );
});
