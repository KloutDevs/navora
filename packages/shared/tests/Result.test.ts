import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ok,
  err,
  isOk,
  isError,
  map,
  mapErr,
  unwrap,
  unwrapErr,
  unwrapOr,
  unwrapOrElse,
  fromPromise,
  tryCatch,
  tryCatchAsync,
  flatten,
  andThen,
  flatMap,
  type Result,
} from "../src/Result";

describe("Result", () => {
  describe("ok/err factories", () => {
    it("should create an Ok result", () => {
      const result = ok(42);
      expect(isOk(result)).toBe(true);
      expect(isError(result)).toBe(false);
      expect(result.value).toBe(42);
    });

    it("should create an Err result", () => {
      const error = new Error("fail");
      const result = err<string, Error>(error);
      expect(isError(result)).toBe(true);
      expect(isOk(result)).toBe(false);
      expect(result.error).toBe(error);
    });
  });

  describe("isOk/isError type guards", () => {
    it("should narrow Ok type correctly", () => {
      const result: Result<number, Error> = ok(42);
      if (isOk(result)) {
        expect(result.value).toBe(42);
      }
    });

    it("should narrow Err type correctly", () => {
      const error = new Error("fail");
      const result: Result<number, Error> = err(error);
      if (isError(result)) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe("map", () => {
    it("should transform value if Ok", () => {
      const result = ok(5);
      const mapped = map(result, (v) => v * 2);
      expect(isOk(mapped)).toBe(true);
      expect((mapped as { ok: true; value: number }).value).toBe(10);
    });

    it("should pass through error if Err", () => {
      const error = new Error("fail");
      const result: Result<number, Error> = err(error);
      const mapped = map(result, (v) => v * 2);
      expect(isError(mapped)).toBe(true);
    });

    it("should handle different result types", () => {
      const result = ok("hello");
      const mapped = map(result, (s) => s.length);
      expect(isOk(mapped)).toBe(true);
      expect((mapped as { ok: true; value: number }).value).toBe(5);
    });
  });

  describe("mapErr", () => {
    it("should transform error if Err", () => {
      const error = new Error("original");
      const result: Result<number, Error> = err(error);
      const mapped = mapErr(result, (e) => new Error(`wrapped: ${e.message}`));
      expect(isError(mapped)).toBe(true);
      expect((mapped as { ok: false; error: Error }).error.message).toBe(
        "wrapped: original"
      );
    });

    it("should pass through value if Ok", () => {
      const result = ok(42);
      const mapped = mapErr(result, (e) => new Error("never"));
      expect(isOk(mapped)).toBe(true);
      expect((mapped as { ok: true; value: number }).value).toBe(42);
    });
  });

  describe("unwrap/unwrapErr", () => {
    it("should unwrap Ok value", () => {
      const result = ok("success");
      expect(unwrap(result)).toBe("success");
    });

    it("should throw on unwrap of Err", () => {
      const error = new Error("fail");
      const result: Result<number, Error> = err(error);
      expect(() => unwrap(result)).toThrow(error);
    });

    it("should unwrap Err error", () => {
      const error = new Error("fail");
      const result: Result<number, Error> = err(error);
      expect(unwrapErr(result)).toBe(error);
    });

    it("should throw on unwrapErr of Ok", () => {
      const result = ok(42);
      expect(() => unwrapErr(result)).toThrow();
    });
  });

  describe("unwrapOr/unwrapOrElse", () => {
    it("should return value from Ok", () => {
      const result = ok(42);
      expect(unwrapOr(result, 0)).toBe(42);
    });

    it("should return default from Err", () => {
      const result: Result<number, Error> = err(new Error("fail"));
      expect(unwrapOr(result, 0)).toBe(0);
    });

    it("should compute value from error using orElse", () => {
      const error = new Error("fail");
      const result: Result<number, Error> = err(error);
      expect(unwrapOrElse(result, (e) => e.message.length)).toBe(4);
    });

    it("should return Ok value in orElse", () => {
      const result = ok(42);
      expect(unwrapOrElse(result, (e) => -1)).toBe(42);
    });
  });

  describe("fromPromise", () => {
    it("should resolve promise to Ok", async () => {
      const promise = Promise.resolve(42);
      const result = await fromPromise(promise);
      expect(isOk(result)).toBe(true);
      expect((result as { ok: true; value: number }).value).toBe(42);
    });

    it("should reject promise to Err", async () => {
      const promise = Promise.reject(new Error("fail"));
      const result = await fromPromise(promise);
      expect(isError(result)).toBe(true);
    });

    it("should use custom error mapper", async () => {
      const promise = Promise.reject("string error");
      const result = await fromPromise(promise, (r) => new Error(String(r)));
      expect(isError(result)).toBe(true);
      expect((result as { ok: false; error: Error }).error.message).toBe(
        "string error"
      );
    });
  });

  describe("tryCatch", () => {
    it("should return Ok on success", () => {
      const result = tryCatch(() => 42);
      expect(isOk(result)).toBe(true);
    });

    it("should return Err on throw", () => {
      const result = tryCatch(() => {
        throw new Error("fail");
      });
      expect(isError(result)).toBe(true);
    });

    it("should use custom error mapper", () => {
      const result = tryCatch(
        () => {
          throw "string";
        },
        (e) => new Error(String(e))
      );
      expect(isError(result)).toBe(true);
      expect((result as { ok: false; error: Error }).error.message).toBe(
        "string"
      );
    });
  });

  describe("tryCatchAsync", () => {
    it("should return Ok on async success", async () => {
      const result = await tryCatchAsync(async () => 42);
      expect(isOk(result)).toBe(true);
    });

    it("should return Err on async throw", async () => {
      const result = await tryCatchAsync(async () => {
        throw new Error("fail");
      });
      expect(isError(result)).toBe(true);
    });
  });

  describe("flatten", () => {
    it("should flatten nested Ok", () => {
      const nested = ok(ok(42));
      const flat = flatten(nested);
      expect(isOk(flat)).toBe(true);
      expect((flat as { ok: true; value: number }).value).toBe(42);
    });

    it("should flatten nested Err", () => {
      const error = new Error("fail");
      const nested: Result<Result<number, Error>, Error> = err(error);
      const flat = flatten(nested);
      expect(isError(flat)).toBe(true);
    });
  });

  describe("andThen/flatMap", () => {
    it("should chain Ok results", () => {
      const result = ok(5);
      const chained = andThen(result, (v) => ok(v * 2));
      expect(isOk(chained)).toBe(true);
      expect((chained as { ok: true; value: number }).value).toBe(10);
    });

    it("should pass through Err", () => {
      const error = new Error("fail");
      const result: Result<number, Error> = err(error);
      const chained = andThen(result, (v) => ok(v * 2));
      expect(isError(chained)).toBe(true);
    });

    it("should allow converting Ok to Err", () => {
      const result = ok(0);
      const chained = andThen(result, (v) =>
        v > 0 ? ok(v) : err(new Error("non-positive"))
      );
      expect(isError(chained)).toBe(true);
    });

    it("flatMap should behave same as andThen", () => {
      const result = ok(5);
      const chained1 = andThen(result, (v) => ok(v * 2));
      const chained2 = flatMap(result, (v) => ok(v * 2));
      expect((chained1 as { ok: true; value: number }).value).toBe(
        (chained2 as { ok: true; value: number }).value
      );
    });
  });

  describe("edge cases", () => {
    it("should handle null values", () => {
      const result = ok<string, Error>(null as unknown as string);
      expect(isOk(result)).toBe(true);
    });

    it("should handle undefined values", () => {
      const result = ok<string, Error>(undefined as unknown as string);
      expect(isOk(result)).toBe(true);
    });

    it("should handle complex objects", () => {
      const obj = { a: 1, b: { c: 2 } };
      const result = ok(obj);
      expect(unwrap(result)).toEqual(obj);
    });

    it("should handle error with different types", () => {
      const result: Result<number, string> = err("error string");
      expect(isError(result)).toBe(true);
      expect((result as { ok: false; error: string }).error).toBe(
        "error string"
      );
    });
  });
});