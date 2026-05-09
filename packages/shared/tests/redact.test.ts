import { describe, it, expect } from "vitest";
import {
  redact,
  redactKeys,
  redactPath,
  containsSensitiveData,
} from "../src/redact";

describe("redact", () => {
  describe("basic redaction", () => {
    it("should return primitives unchanged", () => {
      expect(redact(42)).toBe(42);
      expect(redact("hello")).toBe("hello");
      expect(redact(true)).toBe(true);
      expect(redact(null)).toBe(null);
      expect(redact(undefined)).toBe(undefined);
    });

    it("should redact password field", () => {
      const input = { username: "john", password: "secret" };
      const result = redact(input) as Record<string, unknown>;

      expect(result.username).toBe("john");
      expect(result.password).toBe("<redacted>");
    });

    it("should redact token field", () => {
      const input = { token: "abc123" };
      const result = redact(input) as Record<string, unknown>;

      expect(result.token).toBe("<redacted>");
    });

    it("should redact case-insensitive keys", () => {
      const input = { PASSWORD: "secret", Password: "secret2" };
      const result = redact(input) as Record<string, unknown>;

      expect(result.PASSWORD).toBe("<redacted>");
      expect(result.Password).toBe("<redacted>");
    });

    it("should redact apiKey variations", () => {
      const input = { apiKey: "key1", api_key: "key2", APIKEY: "key3" };
      const result = redact(input) as Record<string, unknown>;

      expect(result.apiKey).toBe("<redacted>");
      expect(result.api_key).toBe("<redacted>");
      expect(result.APIKEY).toBe("<redacted>");
    });
  });

  describe("nested objects", () => {
    it("should redact nested sensitive keys", () => {
      const input = {
        user: {
          name: "John",
          privateData: {
            password: "secret",
            token: "abc",
          },
        },
      };

      const result = redact(input) as { user: { name: string; privateData: Record<string, unknown> } };

      expect(result.user.name).toBe("John");
      expect(result.user.privateData.password).toBe("<redacted>");
      expect(result.user.privateData.token).toBe("<redacted>");
    });

    it("should handle deep nesting", () => {
      const input = {
        a: {
          b: {
            c: {
              d: {
                password: "deep",
              },
            },
          },
        },
      };

      const result = redact(input);
      const deep = (result as { a: { b: { c: { d: { password: string } } } } }).a.b.c.d;
      expect(deep.password).toBe("<redacted>");
    });

    it("should handle arrays of objects", () => {
      const input = {
        users: [
          { name: "Alice", password: "pass1" },
          { name: "Bob", password: "pass2" },
        ],
      };

      const result = redact(input) as { users: Array<{ name: string; password: string }> };

      expect(result.users[0].name).toBe("Alice");
      expect(result.users[0].password).toBe("<redacted>");
      expect(result.users[1].name).toBe("Bob");
      expect(result.users[1].password).toBe("<redacted>");
    });

    it("should handle arrays of primitives", () => {
      const input = { ids: [1, 2, 3] };
      const result = redact(input) as { ids: number[] };

      expect(result.ids).toEqual([1, 2, 3]);
    });
  });

  describe("pattern-based redaction", () => {
    it("should redact email addresses", () => {
      const input = { email: "john@example.com" };
      const result = redact(input) as { email: string };

      expect(result.email).toBe("[EMAIL]");
    });

    it("should redact URLs with tokens", () => {
      const input = {
        url: "https://api.example.com?token=abc123",
      };
      const result = redact(input) as { url: string };

      expect(result.url).toBe("[URL]");
    });

    it("should redact bearer tokens", () => {
      const input = {
        auth: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      };
      const result = redact(input) as { auth: string };

      expect(result.auth).toBe("<redacted>");
    });
  });

  describe("redactKeys", () => {
    it("should redact specific keys", () => {
      const input = { a: 1, b: 2, c: 3 };
      const result = redactKeys(input, ["b"]);

      expect(result.a).toBe(1);
      expect(result.b).toBe("<redacted>");
      expect(result.c).toBe(3);
    });

    it("should use custom placeholder", () => {
      const input = { secret: "value" };
      const result = redactKeys(input, ["secret"], "[HIDDEN]");

      expect(result.secret).toBe("[HIDDEN]");
    });
  });

  describe("redactPath", () => {
    it("should redact a simple path", () => {
      const input = { user: { password: "secret" } };
      const result = redactPath(input, "user.password") as { user: { password: string } };

      expect(result.user.password).toBe("<redacted>");
    });

    it("should redact deep path", () => {
      const input = { a: { b: { c: { d: "value" } } } };
      const result = redactPath(input, "a.b.c.d") as { a: { b: { c: { d: string } } } };

      expect(result.a.b.c.d).toBe("<redacted>");
    });

    it("should use custom placeholder", () => {
      const input = { key: "value" };
      const result = redactPath(input, "key", "[HIDDEN]");

      expect((result as { key: string }).key).toBe("[HIDDEN]");
    });
  });

  describe("containsSensitiveData", () => {
    it("should detect email in string", () => {
      expect(containsSensitiveData("contact: john@example.com")).toBe(true);
    });

    it("should detect URL with token", () => {
      expect(
        containsSensitiveData("https://api.com?token=abc")
      ).toBe(true);
    });

    it("should detect bearer token", () => {
      expect(
        containsSensitiveData("Authorization: Bearer xyz123")
      ).toBe(true);
    });

    it("should return false for safe strings", () => {
      expect(containsSensitiveData("hello world")).toBe(false);
    });
  });

  describe("options", () => {
    it("should use custom sensitive keys", () => {
      const input = { foo: "secret", bar: "also secret" };
      const result = redact(input, { sensitiveKeys: ["foo"] }) as Record<string, unknown>;

      expect(result.foo).toBe("<redacted>");
      expect(result.bar).toBe("also secret");
    });

    it("should use custom placeholder", () => {
      const input = { password: "secret" };
      const result = redact(input, { placeholder: "***" }) as { password: string };

      expect(result.password).toBe("***");
    });

    it("should respect maxDepth", () => {
      const input = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  password: "deep",
                },
              },
            },
          },
        },
      };

      const result = redact(input, { maxDepth: 3 });
      // At depth 3, level5 hasn't been processed
      const deep = (result as { level1: { level2: { level3: { level4: { level5: { password: string } } } } } }).level1.level2.level3.level4.level5;
      expect(deep.password).toBe("deep");
    });

    it("should respect redactArrays option", () => {
      const input = {
        items: [{ password: "secret" }],
      };

      const result1 = redact(input, { redactArrays: false }) as { items: Array<{ password: string }> };
      expect(result1.items[0].password).toBe("secret");

      const result2 = redact(input, { redactArrays: true }) as { items: Array<{ password: string }> };
      expect(result2.items[0].password).toBe("<redacted>");
    });
  });

  describe("edge cases", () => {
    it("should handle empty objects", () => {
      expect(redact({})).toEqual({});
    });

    it("should handle empty arrays", () => {
      expect(redact([])).toEqual([]);
    });

    it("should handle circular references gracefully (limited)", () => {
      const input: Record<string, unknown> = { a: 1 };
      const result = redact(input);
      expect(result).toEqual({ a: 1 });
    });

    it("should handle special characters in values", () => {
      const input = { password: "p@ss!w0rd#$%" };
      const result = redact(input) as { password: string };

      expect(result.password).toBe("<redacted>");
    });
  });
});