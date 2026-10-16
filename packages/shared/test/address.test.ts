import assert from "node:assert/strict";
import test from "node:test";
import { base58Decode, isValidSolanaAddress, parseSolanaAddressList } from "../src/index.js";

const VALID = [
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "11111111111111111111111111111111"
];

test("accepts well-formed base58 Solana addresses", () => {
  for (const address of VALID) {
    assert.equal(isValidSolanaAddress(address), true, `${address} should be valid`);
    assert.equal(base58Decode(address)?.length, 32);
  }
});

test("rejects malformed, non-base58 and wrong-length values", () => {
  for (const value of ["", "abc", "not-a-valid-address", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl", "x".repeat(45)]) {
    assert.equal(isValidSolanaAddress(value), false, `${value} should be invalid`);
  }
  assert.equal(isValidSolanaAddress(undefined), false);
  assert.equal(isValidSolanaAddress(12345), false);
});

test("parseSolanaAddressList rejects malformed lists instead of dropping entries", () => {
  assert.deepEqual(parseSolanaAddressList(` ${VALID[0]}, ${VALID[1]} `, "MARKET_MINTS"), [VALID[0], VALID[1]]);
  assert.throws(() => parseSolanaAddressList("", "MARKET_MINTS"), /at least one/);
  assert.throws(() => parseSolanaAddressList(`${VALID[0]},not-a-mint`, "MARKET_MINTS"), /invalid Solana address/);
});
