/**
 * NM Shim tests
 */

import { mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Buffer } from "buffer";
import {
  readLengthPrefix,
  frameMessage,
  isCompleteMessage,
  extractMessage,
  headerSize,
  maxMessageSize,
} from "../src/nm-shim/framing";

describe("framing", () => {
  describe("headerSize", () => {
    it("should be 4 bytes", () => {
      expect(headerSize).toBe(4);
    });
  });

  describe("maxMessageSize", () => {
    it("should be 1MB", () => {
      expect(maxMessageSize).toBe(1024 * 1024);
    });
  });

  describe("readLengthPrefix", () => {
    it("should return null for buffers smaller than header", () => {
      const buffer = Buffer.from([0x01, 0x02]);
      expect(readLengthPrefix(buffer)).toBeNull();
    });

    it("should read little-endian length from buffer", () => {
      // Create buffer with: 4-byte header (42 = 0x2a) + "test" (4 bytes) = 8 bytes total
      const buffer = Buffer.alloc(8);
      buffer.writeUInt32LE(42, 0);  // length = 42
      buffer.write("test", 4);       // placeholder "test" for remaining

      const result = readLengthPrefix(buffer);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(42);
      // remaining starts at byte 4, so it has 8-4=4 bytes, which is "test"
      expect(result!.remaining.length).toBe(4);
      expect(result!.remaining.toString()).toBe("test");
    });

    it("should throw for oversized messages", () => {
      const buffer = Buffer.alloc(8);
      buffer.writeUInt32LE(maxMessageSize + 1, 0);
      expect(() => readLengthPrefix(buffer)).toThrow("Message too large");
    });
  });

  describe("frameMessage", () => {
    it("should create header + payload buffer", () => {
      const payload = Buffer.from("hello");
      const framed = frameMessage(payload);

      expect(framed.length).toBe(4 + 5);
      expect(framed.readUInt32LE(0)).toBe(5);
      expect(framed.slice(4).toString()).toBe("hello");
    });

    it("should throw for oversized messages", () => {
      const oversized = Buffer.alloc(maxMessageSize + 1);
      expect(() => frameMessage(oversized)).toThrow("Message too large");
    });
  });

  describe("isCompleteMessage", () => {
    it("should return false for incomplete header", () => {
      const buffer = Buffer.from([0x01, 0x02]);
      expect(isCompleteMessage(buffer)).toBe(false);
    });

    it("should return false for incomplete payload", () => {
      const buffer = Buffer.alloc(6);
      buffer.writeUInt32LE(10, 0);
      // Only 2 bytes of payload, need 10
      buffer.writeUInt16LE(0x1234, 4);
      expect(isCompleteMessage(buffer)).toBe(false);
    });

    it("should return true for complete message", () => {
      const framed = frameMessage(Buffer.from("hello"));
      expect(isCompleteMessage(framed)).toBe(true);
    });
  });

  describe("extractMessage", () => {
    it("should return null for incomplete header", () => {
      const buffer = Buffer.from([0x01, 0x02]);
      expect(extractMessage(buffer)).toBeNull();
    });

    it("should return null for incomplete payload", () => {
      const buffer = Buffer.alloc(6);
      buffer.writeUInt32LE(10, 0);
      buffer.writeUInt16LE(0x1234, 4);
      expect(extractMessage(buffer)).toBeNull();
    });

    it("should extract complete message", () => {
      const original = Buffer.from("hello world");
      const framed = frameMessage(original);
      const result = extractMessage(framed);

      expect(result).not.toBeNull();
      expect(result!.message.toString()).toBe("hello world");
      expect(result!.remaining.length).toBe(0);
    });

    it("should handle multiple messages", () => {
      const msg1 = frameMessage(Buffer.from("hello"));
      const msg2 = frameMessage(Buffer.from("world"));
      const combined = Buffer.concat([msg1, msg2]);

      const result1 = extractMessage(combined);
      expect(result1).not.toBeNull();
      expect(result1!.message.toString()).toBe("hello");

      const result2 = extractMessage(result1!.remaining);
      expect(result2).not.toBeNull();
      expect(result2!.message.toString()).toBe("world");
    });
  });
});

describe("parseConfig", () => {
  it("should use defaults when env vars not set", async () => {
    // Clear env
    const originalToken = process.env.NAVORA_RUNTIME_TOKEN;
    const originalHost = process.env.NAVORA_RUNTIME_HOST;
    const originalPort = process.env.NAVORA_RUNTIME_PORT;

    delete process.env.NAVORA_RUNTIME_TOKEN;
    delete process.env.NAVORA_RUNTIME_HOST;
    delete process.env.NAVORA_RUNTIME_PORT;

    // Re-import after clearing
    vi.resetModules();
    const { parseConfig } = await import("../src/nm-shim/index");
    const config = parseConfig();

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(51520);
    expect(config.token).toBe("");
    expect(config.connectTimeoutMs).toBe(5000);
    expect(config.daemonStartupTimeoutMs).toBe(10000);

    // Restore
    if (originalToken !== undefined) process.env.NAVORA_RUNTIME_TOKEN = originalToken;
    if (originalHost !== undefined) process.env.NAVORA_RUNTIME_HOST = originalHost;
    if (originalPort !== undefined) process.env.NAVORA_RUNTIME_PORT = originalPort;
  });

  it("should parse custom values from env", async () => {
    process.env.NAVORA_RUNTIME_TOKEN = "test-token";
    process.env.NAVORA_RUNTIME_HOST = "192.168.1.100";
    process.env.NAVORA_RUNTIME_PORT = "12345";
    process.env.NAVORA_RUNTIME_LOCKDIR = "/custom/lock";

    vi.resetModules();
    const { parseConfig } = await import("../src/nm-shim/index");
    const config = parseConfig();

    expect(config.token).toBe("test-token");
    expect(config.host).toBe("192.168.1.100");
    expect(config.port).toBe(12345);
    expect(config.lockDir).toBe("/custom/lock");

    // Cleanup
    delete process.env.NAVORA_RUNTIME_TOKEN;
    delete process.env.NAVORA_RUNTIME_HOST;
    delete process.env.NAVORA_RUNTIME_PORT;
    delete process.env.NAVORA_RUNTIME_LOCKDIR;
  });
});

describe("ShimLockfileManager", () => {
  it("should be importable", async () => {
    const { ShimLockfileManager } = await import("../src/nm-shim/daemon-connector");
    expect(typeof ShimLockfileManager).toBe("function");
  });

  it("should handle missing lockfile", async () => {
    const { ShimLockfileManager } = await import("../src/nm-shim/daemon-connector");
    const isolatedDir = await mkdtemp(join(tmpdir(), "navora-shim-lock-"));
    const manager = new ShimLockfileManager({
      lockDir: isolatedDir,
      lockFilename: "daemon-test.pid",
    });

    const isRunning = await manager.isDaemonRunning();
    expect(isRunning).toBe(false);

    const data = await manager.read();
    expect(data).toBeNull();
  });
});

describe("connectToDaemon", () => {
  it("should exist and be a function", async () => {
    const { connectToDaemon } = await import("../src/nm-shim/daemon-connector");
    expect(typeof connectToDaemon).toBe("function");
  });
});

describe("spawnDaemon", () => {
  it("should exist and be a function", async () => {
    const { spawnDaemon } = await import("../src/nm-shim/daemon-connector");
    expect(typeof spawnDaemon).toBe("function");
  });
});

describe("waitForDaemonReady", () => {
  it("should exist and be a function", async () => {
    const { waitForDaemonReady } = await import("../src/nm-shim/daemon-connector");
    expect(typeof waitForDaemonReady).toBe("function");
  });
});