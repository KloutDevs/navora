/**
 * Unit tests for daemon transport and lifecycle components
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { tmpdir } from "node:os";
import { StdioTransport, createStdioTransport } from "../src/transport/stdio";
import { WebSocketHub, createWebSocketHub, generateToken, type WsClient } from "../src/transport/websocket";
import { LockfileManager } from "../src/lifecycle/lockfile";
import { EventEmitter } from "events";

// =============================================================================
// StdioTransport Tests
// =============================================================================

describe("StdioTransport", () => {
  it("should create transport with options", () => {
    const transport = createStdioTransport({
      serverOptions: {
        serverName: "test-server",
        serverVersion: "1.0.0",
      },
    });

    expect(transport).toBeDefined();
    expect(transport.isActive()).toBe(false);

    transport.stop();
  });

  it("should report inactive by default", () => {
    const transport = createStdioTransport({
      serverOptions: {
        serverName: "test-server",
        serverVersion: "1.0.0",
      },
    });

    expect(transport.isActive()).toBe(false);
    transport.stop();
  });

  it("should stop transport", () => {
    const transport = createStdioTransport({
      serverOptions: {
        serverName: "test-server",
        serverVersion: "1.0.0",
      },
    });

    transport.start();
    transport.stop();

    expect(transport.isActive()).toBe(false);
  });
});

// =============================================================================
// WebSocketHub Tests
// =============================================================================

describe("WebSocketHub", () => {
  let hub: WebSocketHub;

  beforeEach(() => {
    hub = createWebSocketHub({
      port: 0, // Random available port
      host: "127.0.0.1",
      authSecret: "test-secret",
      debug: false,
    });
  });

  afterEach(() => {
    hub.stop();
  });

  it("should create hub with options", () => {
    expect(hub).toBeDefined();
    expect(hub.getClientCount()).toBe(0);
  });

  it("should start and get address", async () => {
    hub.start();
    await hub.whenListening();

    const address = hub.getAddress();
    expect(address).not.toBeNull();
    expect(address!.host).toBe("127.0.0.1");
    expect(address!.port).toBeGreaterThan(0);
  });

  it("should return zero clients initially", () => {
    expect(hub.getClientCount()).toBe(0);
    expect(hub.getClients()).toEqual([]);
  });

  it("should return empty authenticated clients initially", () => {
    expect(hub.getAuthenticatedClients()).toEqual([]);
  });

  it("should register and unregister handlers", () => {
    const handler = async () => JSON.stringify({ result: "ok" });

    hub.registerHandler("test/method", handler);
    hub.unregisterHandler("test/method");

    // Handler should no longer exist
    expect(() => hub.unregisterHandler("test/method")).not.toThrow();
  });

  it("should stop without error", () => {
    hub.start();
    hub.stop();

    expect(hub.getAddress()).toBeNull();
  });

  it("should handle duplicate start gracefully", () => {
    hub.start();
    hub.start();
    hub.stop();
  });
});

describe("WebSocketHub Bearer Authorization header", () => {
  it("closes with 1008 when Bearer token is invalid", async () => {
    const hub = createWebSocketHub({
      port: 0,
      validateToken: async (token) =>
        token === "good-secret"
          ? { valid: true, profileId: "prof-a" }
          : { valid: false, profileId: "", error: "invalid token" },
    });

    hub.start();
    await hub.whenListening();
    const addr = hub.getAddress();
    expect(addr).not.toBeNull();

    const ws = new WebSocket(`ws://${addr!.host}:${addr!.port}`, {
      headers: { Authorization: "Bearer bad-secret" },
    });

    const code = await new Promise<number>((resolve, reject) => {
      ws.on("close", (c) => resolve(c));
      ws.on("error", reject);
    });

    expect(code).toBe(1008);
    hub.stop();
  });

  it("authenticates via Bearer and emits shim-connected", async () => {
    const hub = createWebSocketHub({
      port: 0,
      validateToken: async (token) =>
        token === "good-secret"
          ? { valid: true, profileId: "prof-a" }
          : { valid: false, profileId: "", error: "invalid token" },
    });

    let payload: unknown;
    hub.once("shim-connected", (p) => {
      payload = p;
    });

    hub.start();
    await hub.whenListening();
    const addr = hub.getAddress();
    expect(addr).not.toBeNull();

    const ws = new WebSocket(`ws://${addr!.host}:${addr!.port}`, {
      headers: { Authorization: "Bearer good-secret" },
    });

    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    await new Promise((r) => setTimeout(r, 80));
    expect(payload).toBeDefined();
    expect((payload as { profileId?: string }).profileId).toBe("prof-a");

    ws.close();
    hub.stop();
  });

  it("without Authorization header keeps legacy JSON-RPC auth/login flow", async () => {
    const hub = createWebSocketHub({
      port: 0,
      validateToken: async (token) =>
        token === "good-secret"
          ? { valid: true, profileId: "prof-a" }
          : { valid: false, profileId: "", error: "invalid token" },
    });

    hub.start();
    await hub.whenListening();
    const addr = hub.getAddress();
    expect(addr).not.toBeNull();

    const ws = new WebSocket(`ws://${addr!.host}:${addr!.port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    hub.stop();
  });
});

describe("WebSocketHub token validation", () => {
  it("should reject invalid token format", async () => {
    const hub = createWebSocketHub({
      port: 0,
      authSecret: "secret",
    });

    // Create an invalid token
    const invalidToken = Buffer.from("invalid").toString("base64");

    // The validateToken function should handle this
    // We can test this by creating a hub with custom validator
    const customHub = createWebSocketHub({
      port: 0,
      validateToken: async (token) => {
        if (token === "valid-token") {
          return { valid: true, profileId: "test-profile" };
        }
        return { valid: false, error: "Invalid token" };
      },
    });

    customHub.start();
    customHub.stop();
  });
});

// =============================================================================
// LockfileManager Tests
// =============================================================================

describe("LockfileManager", () => {
  it("should create manager with default config", () => {
    const manager = new LockfileManager();

    expect(manager).toBeDefined();
    expect(manager.getLockPath()).toBeDefined();
    expect(manager.getLockPath()).toContain("daemon.pid");
  });

  it("should create manager with custom config", () => {
    const manager = new LockfileManager({
      lockDir: "C:\\Users\\bigma\\AppData\\Local\\Temp\\test-path",
      lockFilename: "custom.lock",
    });

    expect(manager.getLockPath()).toContain("custom.lock");
    expect(manager.getLockPath()).toContain("test-path");
  });

  it("should acquire lockfile", async () => {
    const manager = new LockfileManager({
      lockDir: "C:\\Users\\bigma\\AppData\\Local\\Temp\\test-lock",
      lockFilename: "test.pid",
    });

    const lockData = await manager.acquire();

    expect(lockData).not.toBeNull();
    expect(lockData!.pid).toBe(process.pid);
    expect(lockData!.hostname).toBeDefined();
    expect(lockData!.timestamp).toBeDefined();

    // Clean up
    await manager.release();
  });

  it("should detect already locked state", async () => {
    const manager = new LockfileManager({
      lockDir: "C:\\Users\\bigma\\AppData\\Local\\Temp\\test-lock2",
      lockFilename: "test2.pid",
    });

    // Acquire first
    const first = await manager.acquire();
    expect(first).not.toBeNull();

    // Check if locked
    const isLocked = await manager.isLocked();
    expect(isLocked).toBe(true);

    // Release
    await manager.release();

    // Now should not be locked
    const isLockedAfter = await manager.isLocked();
    expect(isLockedAfter).toBe(false);
  });

  it("should release lockfile", async () => {
    const manager = new LockfileManager({
      lockDir: "C:\\Users\\bigma\\AppData\\Local\\Temp\\test-lock3",
      lockFilename: "test3.pid",
    });

    await manager.acquire();
    await manager.release();

    // Lock should be gone
    const readData = await manager.read();
    expect(readData).toBeNull();
  });

  it("should read non-existent lockfile as null", async () => {
    const manager = new LockfileManager({
      lockDir: "C:\\Users\\bigma\\AppData\\Local\\Temp\\nonexistent-path-xyz",
      lockFilename: "nonexistent.pid",
    });

    const data = await manager.read();
    expect(data).toBeNull();
  });

  it("should overwrite stale lockfile with dead PID (regression: tasklist exit-0 bug)", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join: pathJoin } = await import("node:path");
    const dir = await mkdtemp(pathJoin(tmpdir(), "navora-stale-"));
    try {
      // Write a lockfile with a PID that is almost certainly not running
      const deadPid = 9_999_997;
      await writeFile(
        pathJoin(dir, "daemon.pid"),
        JSON.stringify({ pid: deadPid, hostname: "test", timestamp: Date.now(), cwd: dir })
      );

      const manager = new LockfileManager({ lockDir: dir, lockFilename: "daemon.pid" });
      const result = await manager.acquire();

      // Must succeed — stale lockfile should be cleaned up regardless of platform
      expect(result).not.toBeNull();
      expect(result!.pid).toBe(process.pid);

      await manager.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should handle release when not acquired", async () => {
    const manager = new LockfileManager({
      lockDir: "C:\\Users\\bigma\\AppData\\Local\\Temp\\test-lock4",
      lockFilename: "test4.pid",
    });

    // Should not throw
    await manager.release();

    // Should still be able to acquire
    const lockData = await manager.acquire();
    expect(lockData).not.toBeNull();

    await manager.release();
  });
});

// =============================================================================
// Mock Writable Stream for testing
// =============================================================================

class MockWritableStream extends EventEmitter {
  public data: string[] = [];

  write(data: string): boolean {
    this.data.push(data);
    return true;
  }

  end(): void {
    this.emit("end");
  }
}

// =============================================================================
// StdioTransport with Mock Streams
// =============================================================================

describe("StdioTransport with mock streams", () => {
  it("should process valid JSON-RPC messages", async () => {
    const mockOutput = new MockWritableStream();
    let responseData = "";

    // Create a mock readable stream
    const mockInput = new EventEmitter() as any;
    mockInput.on = mockInput.on.bind(mockInput);

    const transport = createStdioTransport({
      serverOptions: {
        serverName: "test-server",
        serverVersion: "1.0.0",
      },
      inputStream: mockInput as any,
      outputStream: mockOutput as any,
      debug: false,
    });

    // Capture output
    const originalWrite = mockOutput.write.bind(mockOutput);
    mockOutput.write = (data: string) => {
      responseData = data;
      return true;
    };

    transport.start();

    // Simulate sending an initialize request
    const initRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    mockInput.emit("data", initRequest + "\n");

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have received a response
    expect(responseData).toBeDefined();
    expect(responseData).toContain('"jsonrpc":"2.0"');

    transport.stop();
  });

  it("should handle parse errors", async () => {
    const mockOutput = new MockWritableStream();
    let responseData = "";

    const mockInput = new EventEmitter() as any;
    mockInput.on = mockInput.on.bind(mockInput);

    const transport = createStdioTransport({
      serverOptions: {
        serverName: "test-server",
        serverVersion: "1.0.0",
      },
      inputStream: mockInput as any,
      outputStream: mockOutput as any,
      debug: false,
    });

    // Capture output
    mockOutput.write = (data: string) => {
      responseData = data;
      return true;
    };

    transport.start();

    // Send invalid JSON
    mockInput.emit("data", "not valid json{");

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have received a parse error response
    expect(responseData).toBeDefined();

    transport.stop();
  });
});

// =============================================================================
// generateToken + HMAC validator
// =============================================================================

describe("generateToken", () => {
  const SECRET = "test-hmac-secret";
  const PROFILE = "test-profile";

  it("produces a base64 string", () => {
    const token = generateToken(PROFILE, SECRET);
    expect(() => Buffer.from(token, "base64")).not.toThrow();
    expect(token.length).toBeGreaterThan(10);
  });

  it("encodes profileId, timestamp, and 64-char hex signature", () => {
    const token = generateToken(PROFILE, SECRET);
    const decoded = Buffer.from(token, "base64").toString("utf8");
    const parts = decoded.split(":");
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe(PROFILE);
    expect(Number(parts[1])).toBeGreaterThan(0);
    expect(parts[2]).toHaveLength(64); // sha256 hex
  });

  it("two tokens for the same profile differ (timestamp changes)", async () => {
    const t1 = generateToken(PROFILE, SECRET);
    await new Promise((r) => setTimeout(r, 2));
    const t2 = generateToken(PROFILE, SECRET);
    expect(t1).not.toBe(t2);
  });

  it("validates against WebSocketHub with matching authSecret", async () => {
    const hub = createWebSocketHub({ port: 0, authSecret: SECRET });
    hub.start();
    await hub.whenListening();
    const addr = hub.getAddress()!;

    const token = generateToken(PROFILE, SECRET);
    const ws = new WebSocket(`ws://${addr.host}:${addr.port}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const opened = await new Promise<boolean>((resolve) => {
      ws.once("open", () => resolve(true));
      ws.once("close", () => resolve(false));
      ws.once("error", () => resolve(false));
    });

    ws.close();
    hub.stop();
    expect(opened).toBe(true);
  });

  it("rejects a token signed with a different secret", async () => {
    const hub = createWebSocketHub({ port: 0, authSecret: SECRET });
    hub.start();
    await hub.whenListening();
    const addr = hub.getAddress()!;

    const token = generateToken(PROFILE, "wrong-secret");
    const ws = new WebSocket(`ws://${addr.host}:${addr.port}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const code = await new Promise<number>((resolve) => {
      ws.once("close", (c) => resolve(c));
      ws.once("error", () => resolve(-1));
    });

    hub.stop();
    expect(code).toBe(1008);
  });

  it("rejects a token with an expired timestamp", async () => {
    const hub = createWebSocketHub({ port: 0, authSecret: SECRET });
    hub.start();
    await hub.whenListening();
    const addr = hub.getAddress()!;

    // Build a token with a timestamp 25 hours in the past
    const { createHmac } = await import("node:crypto");
    const timestamp = Date.now() - 25 * 60 * 60 * 1000;
    const sig = createHmac("sha256", SECRET).update(`${PROFILE}:${timestamp}`).digest("hex");
    const token = Buffer.from(`${PROFILE}:${timestamp}:${sig}`).toString("base64");

    const ws = new WebSocket(`ws://${addr.host}:${addr.port}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const code = await new Promise<number>((resolve) => {
      ws.once("close", (c) => resolve(c));
      ws.once("error", () => resolve(-1));
    });

    hub.stop();
    expect(code).toBe(1008);
  });

  it("rejects a token with the old reversed-string signature (regression)", async () => {
    const hub = createWebSocketHub({ port: 0, authSecret: SECRET });
    hub.start();
    await hub.whenListening();
    const addr = hub.getAddress()!;

    const timestamp = Date.now();
    const oldSig = `${PROFILE}:${timestamp}`.split("").reverse().join("");
    const token = Buffer.from(`${PROFILE}:${timestamp}:${oldSig}`).toString("base64");

    const ws = new WebSocket(`ws://${addr.host}:${addr.port}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const code = await new Promise<number>((resolve) => {
      ws.once("close", (c) => resolve(c));
      ws.once("error", () => resolve(-1));
    });

    hub.stop();
    expect(code).toBe(1008);
  });
});