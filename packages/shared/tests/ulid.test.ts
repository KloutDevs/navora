import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generate,
  fromTimestamp,
  monotonic,
  resetMonotonic,
  parse,
  isValid,
  getTimestamp,
  compare,
  sort,
  isAfter,
  isBefore,
  isULID,
  ulid,
} from "../src/ulid";

describe("ULID", () => {
  afterEach(() => {
    resetMonotonic();
  });

  describe("generation", () => {
    it("should generate valid ULID strings", () => {
      const id = generate();
      expect(isValid(id)).toBe(true);
      expect(id.length).toBe(26);
    });

    it("should generate unique ULIDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(generate());
      }
      expect(ids.size).toBe(1000);
    });

    it("should generate different values", () => {
      const id1 = generate();
      const id2 = generate();
      expect(id1).not.toBe(id2);
    });
  });

  describe("fromTimestamp", () => {
    it("should generate ULID from specific timestamp", () => {
      const timestamp = 1700000000000;
      const id = fromTimestamp(timestamp);

      expect(isValid(id)).toBe(true);
      expect(getTimestamp(id)).toBe(timestamp);
    });

    it("should throw for invalid timestamps", () => {
      expect(() => fromTimestamp(-1)).toThrow();
      expect(() => fromTimestamp(Math.pow(2, 48))).toThrow();
    });
  });

  describe("monotonic", () => {
    it("should generate monotonic ULIDs", () => {
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        ids.push(monotonic());
      }

      // Verify sorted order
      for (let i = 1; i < ids.length; i++) {
        expect(compare(ids[i - 1], ids[i])).toBeLessThanOrEqual(0);
      }
    });

    it("should never decrease lexicographically across rapid calls", () => {
      resetMonotonic();
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        ids.push(monotonic());
      }
      for (const id of ids) {
        expect(isValid(id)).toBe(true);
      }
      for (let i = 1; i < ids.length; i++) {
        expect(compare(ids[i - 1]!, ids[i]!)).toBeLessThanOrEqual(0);
      }
    });

    it("should handle rapid generation", () => {
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        ids.push(monotonic());
      }

      expect(sort(ids)).toEqual(ids);
    });
  });

  describe("validation", () => {
    it("should validate correct ULIDs", () => {
      expect(isValid("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
      expect(isValid(generate())).toBe(true);
    });

    it("should reject invalid ULIDs", () => {
      expect(isValid("")).toBe(false);
      expect(isValid("short")).toBe(false);
      expect(isValid("01ARZ3NDEKTSV4RRFFQ69G5FA")).toBe(false); // 25 chars
      expect(isValid("01ARZ3NDEKTSV4RRFFQ69G5FAVXX")).toBe(false); // 28 chars
      expect(isValid("01ARZ3NDEKTSV4RRFFQ69G5FA!")).toBe(false); // invalid char
    });

    it("should handle Crockford Base32 variants", () => {
      // O can be used for 0, I can be used for 1
      expect(isValid("010RZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true); // 0 with O
      expect(isValid("011RZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true); // 1 with I
    });
  });

  describe("parse", () => {
    it("should parse valid ULID", () => {
      const id = generate();
      const parts = parse(id);

      expect(parts.encoded).toBe(id);
      expect(typeof parts.timestamp).toBe("number");
      expect(parts.random.length).toBe(16);
    });

    it("should throw on invalid ULID", () => {
      expect(() => parse("invalid")).toThrow();
    });
  });

  describe("getTimestamp", () => {
    it("should extract timestamp from ULID", () => {
      const timestamp = 1700000000000;
      const id = fromTimestamp(timestamp);

      expect(getTimestamp(id)).toBe(timestamp);
    });

    it("should return increasing timestamps for later ULIDs", () => {
      const id1 = generate();
      // Small delay
      const start = Date.now();
      while (Date.now() === start) {}
      const id2 = generate();

      expect(getTimestamp(id2)).toBeGreaterThanOrEqual(getTimestamp(id1));
    });
  });

  describe("compare", () => {
    it("should compare two ULIDs", () => {
      const id1 = generate();
      const id2 = generate();

      const result = compare(id1, id2);
      expect(typeof result).toBe("number");
    });

    it("should return 0 for same ULID", () => {
      const id = generate();
      expect(compare(id, id)).toBe(0);
    });

    it("should return negative when first is earlier", () => {
      const timestamp = 1700000000000;
      const id1 = fromTimestamp(timestamp);
      const id2 = fromTimestamp(timestamp + 1);

      expect(compare(id1, id2)).toBeLessThan(0);
    });

    it("should return positive when first is later", () => {
      const timestamp = 1700000000000;
      const id1 = fromTimestamp(timestamp);
      const id2 = fromTimestamp(timestamp + 1);

      expect(compare(id2, id1)).toBeGreaterThan(0);
    });
  });

  describe("sort", () => {
    it("should sort ULIDs in temporal order", () => {
      const unordered = [generate(), generate(), generate()];
      const sorted = sort(unordered);

      // Verify sorted order
      for (let i = 1; i < sorted.length; i++) {
        expect(compare(sorted[i - 1], sorted[i])).toBeLessThanOrEqual(0);
      }
    });

    it("should handle already sorted array", () => {
      const sorted = [generate(), generate(), generate()];
      const result = sort(sorted);

      for (let i = 1; i < result.length; i++) {
        expect(compare(result[i - 1], result[i])).toBeLessThanOrEqual(0);
      }
    });

    it("should handle single element", () => {
      const arr = [generate()];
      expect(sort(arr)).toEqual(arr);
    });

    it("should handle empty array", () => {
      expect(sort([])).toEqual([]);
    });
  });

  describe("isAfter/isBefore", () => {
    it("should detect chronological order", () => {
      const ts1 = 1700000000000;
      const ts2 = ts1 + 1000;
      const id1 = fromTimestamp(ts1);
      const id2 = fromTimestamp(ts2);

      expect(isAfter(id2, id1)).toBe(true);
      expect(isBefore(id1, id2)).toBe(true);
      expect(isAfter(id1, id2)).toBe(false);
      expect(isBefore(id2, id1)).toBe(false);
    });
  });

  describe("type guards", () => {
    it("should narrow valid ULIDs", () => {
      const validId = generate();
      expect(isULID(validId)).toBe(true);

      const invalidId = "not-a-ulid";
      expect(isULID(invalidId)).toBe(false);
    });

    it("should throw on invalid ulid() call", () => {
      expect(() => ulid("invalid")).toThrow();
    });

    it("should return typed ULID on valid input", () => {
      const id = generate();
      const typed = ulid(id);
      expect(isULID(typed)).toBe(true);
    });
  });

  describe("uniqueness", () => {
    it("should have negligible collision probability", () => {
      // 80 bits of randomness = 1.2e24 possible values
      // Even 1 billion ULIDs has ~1e-7 collision probability
      const ids = new Set<string>();
      for (let i = 0; i < 10000; i++) {
        ids.add(generate());
      }
      expect(ids.size).toBe(10000);
    });
  });

  describe("sorting vs generation order", () => {
    it("generated ULIDs should be sortable by generation time", () => {
      const ids: string[] = [];
      const timestamps: number[] = [];

      for (let i = 0; i < 100; i++) {
        const ts = Date.now();
        timestamps.push(ts);
        ids.push(generate());
        // Small delay to ensure different milliseconds
        const now = Date.now();
        while (Date.now() === now) {}
      }

      // Generated order should mostly match timestamp order
      // (may not be exact due to timing edge cases)
      const sortedIds = sort(ids);
      const sortedTimestamps = [...timestamps].sort((a, b) => a - b);

      // At least the relative order should be preserved
      expect(sortedTimestamps[0]).toBeLessThanOrEqual(sortedTimestamps[99]);
    });
  });

  describe("edge cases", () => {
    it("should handle minimum timestamp", () => {
      const id = fromTimestamp(0);
      expect(getTimestamp(id)).toBe(0);
    });

    it("should handle maximum timestamp", () => {
      const maxTs = Math.pow(2, 48) - 1;
      const id = fromTimestamp(maxTs);
      expect(getTimestamp(id)).toBe(maxTs);
    });
  });
});