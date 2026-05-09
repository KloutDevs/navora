/**
 * ULID (Universally Unique Lexicographically Sortable Identifier) implementation
 * 48-bit timestamp + 80-bit randomness = 128-bit unique ID
 *
 * Format: 01ARZ3NDEKTSV4RRFFQ69G5FAV
 * - First 10 chars: Crockford's Base32 encoded timestamp (48 bits)
 * - Last 16 chars: Crockford's Base32 encoded randomness (80 bits)
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length;
const TIME_MAX = Math.pow(2, 48) - 1;
const RANDOM_LEN = 16;
const TIME_LEN = 10;

/**
 * Convert a number to a Crockford's Base32 encoded string
 */
function encodeTime(now: number): string {
  let str = "";
  for (let i = 0; i < TIME_LEN; i++) {
    const idx = now % ENCODING_LEN;
    str = ENCODING.charAt(idx) + str;
    now = Math.floor(now / ENCODING_LEN);
  }
  return str;
}

/**
 * Generate random bytes using crypto.getRandomValues
 */
function getRandomBytes(): Uint8Array {
  const arr = new Uint8Array(RANDOM_LEN);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(arr);
  } else {
    for (let i = 0; i < RANDOM_LEN; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return arr;
}

/**
 * Encode random bytes to Crockford's Base32
 */
function encodeRandom(random: Uint8Array): string {
  let str = "";
  let buffer = 0;
  let bitsLeft = 0;

  for (let i = 0; i < random.length; i++) {
    buffer = (buffer << 8) | random[i]!;
    bitsLeft += 8;

    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      const idx = (buffer >> bitsLeft) & 0x1f;
      str += ENCODING.charAt(idx);
    }
  }

  // Handle remaining bits
  if (bitsLeft > 0) {
    const idx = (buffer << (5 - bitsLeft)) & 0x1f;
    str += ENCODING.charAt(idx);
  }

  return str.slice(0, RANDOM_LEN);
}

/**
 * Decode a ULID string back to timestamp and random components
 */
export interface ULIDParts {
  timestamp: number;
  random: string;
  encoded: string;
}

/**
 * Parse a ULID string into its components
 */
export function parse(ulid: string): ULIDParts {
  if (!isValid(ulid)) {
    throw new Error(`Invalid ULID: ${ulid}`);
  }

  const timePart = ulid.substring(0, TIME_LEN);
  const randomPart = ulid.substring(TIME_LEN);

  // Decode timestamp (Crockford's Base32)
  let timestamp = 0;
  for (let i = 0; i < timePart.length; i++) {
    const char = timePart.charAt(i).toUpperCase();
    const idx = ENCODING.indexOf(char);
    if (idx === -1) {
      // Handle 'O' as '0', 'I' as '1' per Crockford
      if (char === "O") timestamp = timestamp * ENCODING_LEN + 0;
      else if (char === "I") timestamp = timestamp * ENCODING_LEN + 1;
      else throw new Error(`Invalid ULID character: ${char}`);
    } else {
      timestamp = timestamp * ENCODING_LEN + idx;
    }
  }

  return {
    timestamp,
    random: randomPart,
    encoded: ulid,
  };
}

/**
 * Check if a string is a valid ULID
 */
export function isValid(ulid: string): boolean {
  if (typeof ulid !== "string" || ulid.length !== 26) {
    return false;
  }

  const validChars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return ulid.split("").every((char) => {
    const upper = char.toUpperCase();
    // Crockford's Base32 allows O=0, I=1 for compatibility
    if (upper === "O" || upper === "I") return true;
    return validChars.includes(upper);
  });
}

/**
 * Generate a standard ULID
 */
export function generate(): string {
  const now = Date.now();

  if (now > TIME_MAX) {
    throw new Error("Timestamp overflow: millis since epoch exceeds 48 bits");
  }

  const time = encodeTime(now);
  const random = encodeRandom(getRandomBytes());

  return time + random;
}

/**
 * Generate ULID from a specific timestamp (for testing)
 */
export function fromTimestamp(timestamp: number): string {
  if (timestamp < 0 || timestamp > TIME_MAX) {
    throw new Error("Timestamp out of range");
  }

  const time = encodeTime(timestamp);
  const random = encodeRandom(getRandomBytes());

  return time + random;
}

/**
 * Monotonic ULID state
 */
let lastTimestamp = 0;
let lastRandom: Uint8Array = new Uint8Array(RANDOM_LEN);

/**
 * Generate a monotonic ULID - guaranteed to be greater than any previous
 * ULID generated in the same millisecond
 */
export function monotonic(): string {
  const now = Date.now();

  if (now > TIME_MAX) {
    throw new Error("Timestamp overflow: millis since epoch exceeds 48 bits");
  }

  // First call after reset or different millisecond: generate fresh random
  if (now !== lastTimestamp) {
    lastTimestamp = now;
    lastRandom = getRandomBytes();
  } else {
    // Same millisecond as last generation: increment the random part
    let carry = 1;
    for (let i = lastRandom.length - 1; i >= 0 && carry; i--) {
      const newVal = lastRandom[i]! + carry;
      lastRandom[i] = newVal & 0xff;
      carry = newVal >> 8;
    }

    // If we overflowed the random component (2^80 ULIDs in one ms),
    // wait until next millisecond and generate fresh random
    if (carry) {
      while (Date.now() === now) {
        // busy wait
      }
      lastTimestamp = Date.now();
      lastRandom = getRandomBytes();
    }
  }

  const time = encodeTime(lastTimestamp);
  const random = encodeRandom(lastRandom);

  return time + random;
}

/**
 * Reset monotonic state (mainly for testing)
 */
export function resetMonotonic(): void {
  lastTimestamp = 0;
  lastRandom = new Uint8Array(RANDOM_LEN); // Initialize with zeros
}

/**
 * Get the timestamp from a ULID (for sorting)
 */
export function getTimestamp(ulid: string): number {
  return parse(ulid).timestamp;
}

/**
 * Compare two ULIDs - returns negative if a < b, positive if a > b, 0 if equal
 */
export function compare(a: string, b: string): number {
  const tsA = getTimestamp(a);
  const tsB = getTimestamp(b);

  if (tsA !== tsB) {
    return tsA - tsB;
  }

  // Same timestamp - compare random part
  const randA = a.substring(TIME_LEN);
  const randB = b.substring(TIME_LEN);

  // Simple string comparison works for base32-encoded values
  return randA.localeCompare(randB);
}

/**
 * Sort an array of ULIDs in lexicographic (temporal) order
 */
export function sort(ulids: string[]): string[] {
  return [...ulids].sort(compare);
}

/**
 * Check if a ULID was generated after another (temporal order)
 */
export function isAfter(a: string, b: string): boolean {
  return compare(a, b) > 0;
}

/**
 * Check if a ULID was generated before another (temporal order)
 */
export function isBefore(a: string, b: string): boolean {
  return compare(a, b) < 0;
}

/**
 * Custom type for ULID brand
 */
export type ULID = string & { readonly __brand: unique symbol };

/**
 * Type guard to check if a string is a valid ULID
 */
export function isULID(value: string): value is ULID {
  return isValid(value);
}

/**
 * Create a ULID from a string (with validation)
 */
export function ulid(value: string): ULID {
  if (!isValid(value)) {
    throw new Error(`Invalid ULID: ${value}`);
  }
  return value as ULID;
}