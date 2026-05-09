/**
 * NM Shim - Daemon Connection Manager
 * 
 * Handles connection to the daemon:
 * - Checks for running daemon via lockfile
 * - Spawns daemon if not running
 * - Manages WebSocket connection lifecycle
 */

import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, ChildProcess } from "child_process";
import WebSocket from "ws";
import type { ShimConfig } from "./index";

/**
 * Lockfile data structure
 */
interface LockfileData {
  pid: number;
  hostname: string;
  timestamp: number;
  cwd: string;
}

/**
 * Connection status
 */
export type ConnectionStatus =
  | "disconnected"
  | "checking"
  | "connecting"
  | "connected"
  | "spawning"
  | "error";

/**
 * Shim connection state
 */
export interface ShimConnection {
  status: ConnectionStatus;
  ws: WebSocket | null;
  daemonProcess: ChildProcess | null;
  error?: Error;
}

/**
 * LockfileManager for shim - lightweight version
 */
export class ShimLockfileManager {
  private lockPath: string;

  constructor(config?: { lockDir?: string; lockFilename?: string }) {
    const lockDir = config?.lockDir ?? path.join(os.tmpdir(), "ai-browser-runtime");
    const lockFilename = config?.lockFilename ?? "daemon.pid";
    this.lockPath = path.join(lockDir, lockFilename);
  }

  getLockPath(): string {
    return this.lockPath;
  }

  async isDaemonRunning(): Promise<boolean> {
    try {
      const content = await fs.readFile(this.lockPath, "utf8");
      const data = JSON.parse(content) as LockfileData;

      // Check if process is still running
      if (process.platform === "win32") {
        try {
          const { execSync } = require("child_process") as typeof import("child_process");
          execSync(`tasklist /FI "PID eq ${data.pid}" /NH`, { stdio: "pipe" });
          return true;
        } catch {
          return false;
        }
      } else {
        try {
          process.kill(data.pid, 0);
          return true;
        } catch {
          return false;
        }
      }
    } catch {
      return false;
    }
  }

  async read(): Promise<LockfileData | null> {
    try {
      const content = await fs.readFile(this.lockPath, "utf8");
      return JSON.parse(content) as LockfileData;
    } catch {
      return null;
    }
  }
}

/**
 * Connect to daemon WebSocket
 */
export function connectToDaemon(
  config: ShimConfig,
  onConnect: () => void,
  onDisconnect: () => void,
  onError: (error: Error) => void
): WebSocket {
  const wsUrl = `ws://${config.host}:${config.port}`;

  const ws = new WebSocket(wsUrl, undefined, {
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  ws.on("open", () => {
    onConnect();
  });

  ws.on("close", () => {
    onDisconnect();
  });

  ws.on("error", (error) => {
    onError(new Error(`WebSocket error: ${error.message}`));
  });

  return ws;
}

/**
 * Spawn the daemon process
 */
export function spawnDaemon(
  config: ShimConfig,
  onExit: (code: number | null) => void
): ChildProcess {
  // Find the daemon entry point
  // In production, this would be the bundled daemon
  // For development, we use ts-node or the dist path
  const daemonPath = (process.env as Record<string, string | undefined>)["AI_BROWSER_RUNTIME_DAEMON_PATH"] || "dist/index.js";

  const child = spawn(process.execPath, [daemonPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      AI_BROWSER_RUNTIME_MODE: "daemon",
      AI_BROWSER_RUNTIME_HOST: config.host,
      AI_BROWSER_RUNTIME_PORT: config.port.toString(),
    },
    detached: false,
  });

  child.on("exit", (code, signal) => {
    onExit(code);
  });

  child.on("error", (error) => {
    onExit(null);
  });

  return child;
}

/**
 * Wait for daemon to be ready
 */
export async function waitForDaemonReady(
  config: ShimConfig,
  timeoutMs: number
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // Check lockfile
    const lockfile = new ShimLockfileManager({
      lockDir: config.lockDir,
      lockFilename: config.lockFilename,
    });

    const isRunning = await lockfile.isDaemonRunning();
    if (isRunning) {
      // Try to connect
      try {
        const ws = new WebSocket(`ws://${config.host}:${config.port}`, {
          headers: { Authorization: `Bearer ${config.token}` },
        });

        return new Promise((resolve) => {
          ws.on("open", () => {
            ws.close();
            resolve(true);
          });
          ws.on("error", () => {
            resolve(false);
          });
          setTimeout(() => resolve(false), 1000);
        });
      } catch {
        // Continue waiting
      }
    }

    // Wait a bit before retrying
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}