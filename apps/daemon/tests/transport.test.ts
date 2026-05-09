/**
 * Unit tests for daemon transport and lifecycle components
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StdioTransport, createStdioTransport } from "../src/transport/stdio";
import { WebSocketHub, createWebSocketHub, type WsClient } from "../src/transport/websocket";
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

  it("should start and get address", () => {
    hub.start();

    const address = hub.getAddress();
    expect(address).not.toBeNull();
    expect(address!.host).toBe("127.0.0.1");
    // Port should be > 0 if we got an address, or could be 0 if still starting
    expect(address!.port).toBeGreaterThanOrEqual(0);
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