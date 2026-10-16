const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const BASE58_MAP: ReadonlyMap<string, number> = new Map(
  [...BASE58_ALPHABET].map((character, index) => [character, index])
);

export const SOLANA_ADDRESS_BYTES = 32;
export const SOLANA_ADDRESS_MIN_LENGTH = 32;
export const SOLANA_ADDRESS_MAX_LENGTH = 44;

/**
 * Decodes a base58 string into bytes without external node/crypto dependencies.
 * Returns null if string contains any non-base58 character.
 */
export function base58Decode(input: string): Uint8Array | null {
  if (input.length === 0) return null;

  const littleEndian: number[] = [0];
  for (const character of input) {
    const value = BASE58_MAP.get(character);
    if (value === undefined) return null;
    let carry = value;
    for (let index = 0; index < littleEndian.length; index += 1) {
      const current = (littleEndian[index] ?? 0) * 58 + carry;
      littleEndian[index] = current & 0xff;
      carry = current >> 8;
    }
    while (carry > 0) {
      littleEndian.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === "1") leadingZeros += 1;

  let significantBytes = littleEndian.length;
  while (significantBytes > 0 && littleEndian[significantBytes - 1] === 0) significantBytes -= 1;

  const decoded = new Uint8Array(leadingZeros + significantBytes);
  for (let index = 0; index < significantBytes; index += 1) {
    decoded[decoded.length - 1 - index] = littleEndian[index] ?? 0;
  }
  return decoded;
}

/**
 * Returns true if the given value is a syntactically valid Solana base58 address (32 bytes).
 */
export function isValidSolanaAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < SOLANA_ADDRESS_MIN_LENGTH || value.length > SOLANA_ADDRESS_MAX_LENGTH) return false;
  const decoded = base58Decode(value);
  return decoded !== null && decoded.length === SOLANA_ADDRESS_BYTES;
}
