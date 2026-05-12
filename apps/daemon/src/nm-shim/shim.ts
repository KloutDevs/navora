/**
 * NM Shim - Main Entry Point
 * 
 * This is the main shim binary that Chrome extension connects to via native messaging.
 * It runs as a separate process per Chrome profile, forwarding messages between
 * Chrome extension (stdio) and daemon (WebSocket).
 * 
 * Usage:
 *   node shim.js
 * 
 * Environment:
 *   NAVORA_RUNTIME_TOKEN - WebSocket auth token (required)
 *   NAVORA_RUNTIME_HOST - Daemon host (default: 127.0.0.1)
 *   NAVORA_RUNTIME_PORT - Daemon port (default: 51520)
 *   NAVORA_RUNTIME_LOCKDIR - Lockfile directory
 */

import { Buffer } from "buffer";
import WebSocket from "ws";
import { parseConfig, type ShimConfig } from "./index";
import {
  readLengthPrefix,
  isCompleteMessage,
  extractMessage,
  frameMessage,
  headerSize,
  maxMessageSize,
} from "./framing";
import {
  ShimLockfileManager,
  connectToDaemon,
  spawnDaemon,
  waitForDaemonReady,
} from "./daemon-connector";

// Re-export config parser for tests
export { parseConfig, type ShimConfig } from "./index";

/**
 * NM Shim - Main class
 */
class NMShim {
  private config: ShimConfig;
  private lockfile: ShimLockfileManager;
  private ws: WebSocket | null = null;
  private stdinBuffer = Buffer.alloc(0);
  private wsBuffer = Buffer.alloc(0);
  private running = false;
  private connected = false;
  private daemonProcess: ReturnType<typeof spawnDaemon> | null = null;

  constructor(config: ShimConfig) {
    this.config = config;
    this.lockfile = new ShimLockfileManager();
  }

  /**
   * Start the shim
   */
  async start(): Promise<void> {
    this.running = true;

    // Validate token
    if (!this.config.token) {
      this.error("NAVORA_RUNTIME_TOKEN environment variable is required");
      process.exit(1);
    }

    console.error(`[shim] Starting NM Shim`);
    console.error(`[shim] Daemon: ${this.config.host}:${this.config.port}`);

    // Check for running daemon or spawn one
    const daemonRunning = await this.lockfile.isDaemonRunning();

    if (!daemonRunning) {
      console.error(`[shim] Daemon not running, spawning...`);
      await this.spawnAndWaitForDaemon();
    } else {
      console.error(`[shim] Daemon already running`);
    }

    // Connect to daemon WebSocket
    await this.connectToDaemonWebSocket();

    // Set up stdio handling
    this.setupStdioHandling();

    console.error(`[shim] Ready and forwarding`);
  }

  /**
   * Spawn daemon and wait for it to be ready
   */
  private async spawnAndWaitForDaemon(): Promise<void> {
    // Spawn daemon process
    this.daemonProcess = spawnDaemon(this.config, (code) => {
      console.error(`[shim] Daemon exited with code ${code}`);
      if (this.running) {
        console.error(`[shim] Daemon died, shutting down shim`);
        this.shutdown();
      }
    });

    // Wait for daemon to be ready
    const ready = await waitForDaemonReady(
      this.config,
      this.config.daemonStartupTimeoutMs
    );

    if (!ready) {
      this.error("Failed to spawn daemon - timeout waiting for ready");
      process.exit(1);
    }

    console.error(`[shim] Daemon spawned and ready`);
  }

  /**
   * Connect to daemon WebSocket
   */
  private async connectToDaemonWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `ws://${this.config.host}:${this.config.port}`;

      this.ws = new WebSocket(wsUrl, undefined, {
        headers: {
          Authorization: `Bearer ${this.config.token}`,
        },
      });

      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout after ${this.config.connectTimeoutMs}ms`));
      }, this.config.connectTimeoutMs);

      this.ws.on("open", () => {
        clearTimeout(timeout);
        this.connected = true;
        console.error(`[shim] Connected to daemon`);
        resolve();
      });

      this.ws.on("close", (code, reason) => {
        console.error(`[shim] Daemon disconnected: ${code} ${reason}`);
        this.connected = false;
        if (this.running) {
          this.shutdown();
        }
      });

      this.ws.on("error", (error) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error: ${error.message}`));
      });

      this.ws.on("message", (data: Buffer) => {
        // Forward message to Chrome (stdio) with framing
        this.sendToStdio(data);
      });
    });
  }

  /**
   * Set up stdio handling
   */
  private setupStdioHandling(): void {
    // Handle stdin data
    process.stdin.on("data", (chunk: Buffer) => {
      this.stdinBuffer = Buffer.concat([this.stdinBuffer, chunk]);
      this.processStdinBuffer();
    });

    process.stdin.on("end", () => {
      console.error(`[shim] Chrome disconnected`);
      this.shutdown();
    });

    process.stdin.on("error", (error) => {
      console.error(`[shim] stdin error: ${error.message}`);
      this.shutdown();
    });

    // Handle stdout close
    process.stdout.on("error", (error) => {
      console.error(`[shim] stdout error: ${error.message}`);
    });
  }

  /**
   * Process stdin buffer - extract and forward complete messages
   */
  private processStdinBuffer(): void {
    while (this.running && this.stdinBuffer.length >= headerSize) {
      // Check if we have a complete message
      const prefix = readLengthPrefix(this.stdinBuffer);
      if (!prefix) {
        break; // Need more data
      }

      const { length, remaining } = prefix;

      // Check if we have the complete message
      if (remaining.length < length) {
        break; // Need more data
      }

      // Extract the message
      const message = remaining.slice(0, length);
      this.stdinBuffer = remaining.slice(length);

      // Forward to daemon
      this.sendToDaemon(message);
    }
  }

  /**
   * Send data to Chrome via stdout with framing
   */
  private sendToStdio(data: Buffer): void {
    if (!this.running) return;

    try {
      const framed = frameMessage(data);
      const written = process.stdout.write(framed);

      if (!written) {
        // Backpressure - wait for drain
        process.stdout.once("drain", () => {});
      }
    } catch (error) {
      console.error(`[shim] Error writing to stdout: ${error}`);
    }
  }

  /**
   * Send data to daemon via WebSocket
   */
  private sendToDaemon(data: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error(`[shim] Cannot send - not connected to daemon`);
      return;
    }

    try {
      this.ws.send(data);
    } catch (error) {
      console.error(`[shim] Error sending to daemon: ${error}`);
    }
  }

  /**
   * Shutdown the shim
   */
  private shutdown(): void {
    if (!this.running) return;

    this.running = false;
    this.connected = false;

    // Close WebSocket
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }

    // Daemon process cleanup happens automatically
    // We don't kill the daemon when shim exits - daemon may serve other shims

    console.error(`[shim] Shutdown complete`);
  }

  /**
   * Log error and exit
   */
  private error(message: string): void {
    console.error(`[shim] ERROR: ${message}`);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const config = parseConfig();
    const shim = new NMShim(config);
    await shim.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[shim] Failed to start: ${message}`);
    process.exit(1);
  }
}

// Run if executed directly
main().catch((error) => {
  console.error(`[shim] Unhandled error: ${error}`);
  process.exit(1);
});

// Export for testing
export { NMShim };