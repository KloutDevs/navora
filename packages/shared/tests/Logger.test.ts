import { describe, it, expect, beforeEach } from "vitest";
import {
  createLogger,
  logger,
  LogLevel,
} from "../src/Logger";

// Track logged entries via onLog handler for assertions
const loggedEntries: Array<{ level: string; args: unknown[] }> = [];

function makeLogger(options?: Parameters<typeof createLogger>[0]) {
  return createLogger({
    ...options,
    onLog: (level, args) => loggedEntries.push({ level, args }),
  });
}

describe("Logger", () => {
  beforeEach(() => {
    loggedEntries.length = 0;
  });

  describe("log levels", () => {
    it("should log info messages", () => {
      const testLogger = makeLogger({ minLevel: LogLevel.INFO });
      testLogger.info("test message");

      expect(loggedEntries.length).toBeGreaterThan(0);
      expect(loggedEntries[0]!.args.join(" ")).toContain("[INFO]");
      expect(loggedEntries[0]!.args.join(" ")).toContain("test message");
    });

    it("should log warn messages", () => {
      const testLogger = makeLogger({ minLevel: LogLevel.INFO });
      testLogger.warn("warning message");

      expect(loggedEntries.length).toBeGreaterThan(0);
      const combined = loggedEntries[0]!.args.join(" ");
      expect(combined).toContain("[WARN]");
      expect(combined).toContain("warning message");
    });

    it("should log error messages", () => {
      const testLogger = makeLogger({ minLevel: LogLevel.INFO });
      testLogger.error("error message");

      expect(loggedEntries.length).toBeGreaterThan(0);
      const combined = loggedEntries[0]!.args.join(" ");
      expect(combined).toContain("[ERROR]");
      expect(combined).toContain("error message");
    });

    it("should filter log levels below minLevel", () => {
      const testLogger = makeLogger({ minLevel: LogLevel.WARN });
      testLogger.trace("should not appear");
      testLogger.debug("should not appear");
      testLogger.info("should not appear");
      testLogger.warn("should appear");

      const combined = loggedEntries.map((e) => e.args.join(" ")).join(" ");
      expect(combined).not.toContain("should not appear");
      expect(combined).toContain("should appear");
    });

    it("should include error stack traces", () => {
      const testLogger = makeLogger();
      const error = new Error("test error");

      testLogger.error("error with stack", error);

      expect(loggedEntries.length).toBeGreaterThan(0);
      const combined = loggedEntries[0]!.args.join(" ");
      expect(combined).toContain("Error:");
      expect(combined).toContain("test error");
    });
  });

  describe("context", () => {
    it("should include context in log output", () => {
      const testLogger = makeLogger();
      testLogger.info("message", { userId: "123" });

      expect(loggedEntries.length).toBeGreaterThan(0);
      const combined = loggedEntries[0]!.args.join(" ");
      expect(combined).toContain("userId");
      expect(combined).toContain("123");
    });

    it("should merge base context with call context", () => {
      const testLogger = makeLogger({ context: { base: "value" } });
      testLogger.info("message", { extra: "data" });

      expect(loggedEntries.length).toBeGreaterThan(0);
      const combined = loggedEntries[0]!.args.join(" ");
      expect(combined).toContain("base");
      expect(combined).toContain("extra");
    });
  });

  describe("timestamp", () => {
    it("should include ISO timestamp by default", () => {
      const testLogger = makeLogger();
      testLogger.info("message");

      expect(loggedEntries.length).toBeGreaterThan(0);
      const firstArg = loggedEntries[0]!.args[0] as string;
      expect(firstArg).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should omit timestamp when disabled", () => {
      const testLogger = makeLogger({ timestamp: false });
      testLogger.info("message");

      expect(loggedEntries.length).toBeGreaterThan(0);
      const firstArg = loggedEntries[0]!.args[0] as string;
      expect(firstArg).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("prefix", () => {
    it("should include prefix in log output", () => {
      const testLogger = makeLogger({ prefix: "MyApp" });
      testLogger.info("message");

      expect(loggedEntries.length).toBeGreaterThan(0);
      const combined = loggedEntries[0]!.args.join(" ");
      expect(combined).toContain("MyApp:");
    });

    it("should combine prefix from child", () => {
      const testLogger = makeLogger({ prefix: "Parent" });
      const child = testLogger.child({ prefix: "Child" });
      child.info("message");

      expect(loggedEntries.length).toBeGreaterThan(0);
      const combined = loggedEntries[0]!.args.join(" ");
      expect(combined).toContain("Parent:");
      expect(combined).toContain("Child:");
    });
  });

  describe("child logger", () => {
    it("should inherit parent settings", () => {
      const parent = makeLogger({ minLevel: LogLevel.ERROR });
      const child = parent.child();

      child.info("should not appear");

      const combined = loggedEntries.map((e) => e.args.join(" ")).join(" ");
      expect(combined).not.toContain("should not appear");
    });

    it("should override parent settings", () => {
      const parent = makeLogger({ minLevel: LogLevel.ERROR });
      const child = parent.child({ minLevel: LogLevel.DEBUG });

      child.debug("should appear");

      expect(loggedEntries.length).toBeGreaterThan(0);
    });
  });

  describe("redaction", () => {
    it("should redact password fields", () => {
      const testLogger = makeLogger();
      testLogger.info("login attempt", {
        username: "john",
        password: "secret123",
      });

      const serialized = loggedEntries[0]!.args.join(" ");
      expect(serialized).toContain("<redacted>");
      expect(serialized).not.toContain("secret123");
    });

    it("should redact token fields", () => {
      const testLogger = makeLogger();
      testLogger.info("API call", {
        url: "https://api.example.com",
        authorization: "Bearer abc123token",
      });

      const serialized = loggedEntries[0]!.args.join(" ");
      expect(serialized).not.toContain("abc123token");
    });

    it("should redact cookie values", () => {
      const testLogger = makeLogger();
      testLogger.info("cookies", {
        session_id: "abc123",
        cookie: "session=xyz789",
      });

      const serialized = loggedEntries[0]!.args.join(" ");
      expect(serialized).not.toContain("abc123");
      expect(serialized).not.toContain("xyz789");
    });

    it("should redact paths", () => {
      const testLogger = makeLogger({ timestamp: false });
      testLogger.info("file path", {
        path: "C:\\Users\\JohnDoe\\secrets.txt",
        linux: "/home/john/.ssh/id_rsa",
      });

      const serialized = loggedEntries[0]!.args.join(" ");
      expect(serialized).not.toContain("JohnDoe");
      expect(serialized).not.toContain("john");
    });
  });

  describe("default logger", () => {
    it("should export a default logger instance", () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.error).toBe("function");
    });
  });
});
