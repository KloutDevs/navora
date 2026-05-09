/**
 * NM Shim CLI Entry Point
 * 
 * This is the executable entry point for the shim binary.
 * Chrome's native messaging calls this binary directly.
 * 
 * The shim forwards messages between:
 *   - Chrome extension (via stdin/stdout with 4-byte length prefix)
 *   - Daemon (via WebSocket)
 */

import { spawn } from "child_process";
import WebSocket from "ws";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { Buffer } from "buffer";

// Re-export shim for library access
export { NMShim, parseConfig } from "./shim";
export type { ShimConfig } from "./index";

// Shim configuration
interface ShimConfig {
  host: string;
  port: number;
  token: string;
  lockDir: string;
  connectTimeoutMs: number;
  daemonStartupTimeoutMs: number;
}

function parseConfig(): ShimConfig {
  const env = process.env as Record<string, string | undefined>;
  return {
    host: env["AI_BROWSER_RUNTIME_HOST"] ?? "127.0.0.1",
    port: parseInt(env["AI_BROWSER_RUNTIME_PORT"] ?? "51432", 10),
    token: env["AI_BROWSER_RUNTIME_TOKEN"] ?? "",
    lockDir: env["AI_BROWSER_RUNTIME_LOCKDIR"] ?? "",
    connectTimeoutMs: 5000,
    daemonStartupTimeoutMs: 10000,
  };
}

// Framing constants
const HEADER_SIZE = 4;
const MAX_MESSAGE_SIZE = 1024 * 1024;

function frameMessage(message: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32LE(message.length, 0);
  return Buffer.concat([header, message]);
}

function readLengthPrefix(
  buffer: Buffer
): { length: number; remaining: Buffer } | null {
  if (buffer.length < HEADER_SIZE) return null;
  const length = buffer.readUInt32LE(0);
  if (length > MAX_MESSAGE_SIZE) throw new Error(`Message too large: ${length}`);
  return { length, remaining: buffer.slice(HEADER_SIZE) };
}

// Lockfile management
interface LockfileData {
  pid: number;
  hostname: string;
  timestamp: number;
}

async function isDaemonRunning(lockDir: string): Promise<boolean> {
  const lockPath = path.join(lockDir, "daemon.pid");
  try {
    const content = await fs.readFile(lockPath, "utf8");
    const data = JSON.parse(content) as LockfileData;
    if (process.platform === "win32") {
      try {
        require("child_process").execSync(`tasklist /FI "PID eq ${data.pid}" /NH`, { stdio: "pipe" });
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

async function waitForDaemon(host: string, port: number, token: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ws = new WebSocket(`ws://${host}:${port}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return new Promise((resolve) => {
        ws.on("open", () => { ws.close(); resolve(true); });
        ws.on("error", () => resolve(false));
        setTimeout(() => resolve(false), 1000);
      });
    } catch {
      // continue
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Shim main loop
async function runShim(): Promise<void> {
  const config = parseConfig();

  if (!config.token) {
    console.error("[shim] ERROR: AI_BROWSER_RUNTIME_TOKEN environment variable is required");
    process.exit(1);
  }

  const lockDir = config.lockDir || path.join(os.tmpdir(), "ai-browser-runtime");
  const lockFilename = "daemon.pid";

  console.error(`[shim] Starting... daemon at ${config.host}:${config.port}`);

  // Check if daemon is running, if not spawn it
  const running = await isDaemonRunning(lockDir);
  if (!running) {
    console.error(`[shim] Spawning daemon...`);
    const daemonPath = (process.env as Record<string, string | undefined>)["AI_BROWSER_RUNTIME_DAEMON_PATH"] || "dist/index.js";
    const child = spawn(process.execPath, [daemonPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, AI_BROWSER_RUNTIME_MODE: "daemon" },
    });
    child.on("exit", (code) => console.error(`[shim] Daemon exited: ${code}`));
  }

  // Connect to daemon WebSocket
  const wsUrl = `ws://${config.host}:${config.port}`;
  const ws = new WebSocket(wsUrl, undefined, {
    headers: { Authorization: `Bearer ${config.token}` },
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Connection timeout")), config.connectTimeoutMs);
    ws.on("open", () => { clearTimeout(timeout); resolve(); });
    ws.on("error", (e) => reject(e));
  });

  console.error(`[shim] Connected to daemon`);

  // Forward WebSocket -> stdout
  ws.on("message", (data: Buffer) => {
    const framed = frameMessage(data);
    process.stdout.write(framed);
  });

  ws.on("close", () => {
    console.error(`[shim] Daemon disconnected`);
    process.exit(0);
  });

  // Forward stdin -> WebSocket
  let stdinBuffer = Buffer.alloc(0);
  process.stdin.on("data", (chunk: Buffer) => {
    stdinBuffer = Buffer.concat([stdinBuffer, chunk]);

    while (stdinBuffer.length >= HEADER_SIZE) {
      const prefix = readLengthPrefix(stdinBuffer);
      if (!prefix) break;
      const { length, remaining } = prefix;
      if (remaining.length < length) break;

      const message = remaining.slice(0, length);
      stdinBuffer = remaining.slice(length);

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  });

  process.stdin.on("end", () => {
    console.error(`[shim] Chrome disconnected`);
    ws.close();
    process.exit(0);
  });
}

runShim().catch((err) => {
  console.error(`[shim] Error: ${err.message}`);
  process.exit(1);
});