/**
 * NM Shim - Native Messaging Proxy Binary
 * 
 * This binary acts as the bridge between Chrome extension and the daemon.
 * It runs as a separate process per Chrome profile, enabling:
 * - Multiple profiles with single daemon instance
 * - Daemon spawn-on-demand if not running
 * - Clean process isolation
 * 
 * Communication:
 * - stdin/stdout: Chrome native messaging (4-byte length prefix)
 * - WebSocket: Daemon connection on 127.0.0.1:51432
 * 
 * Environment:
 * - AI_BROWSER_RUNTIME_TOKEN: WebSocket auth token (required)
 * - AI_BROWSER_RUNTIME_HOST: Daemon host (default: 127.0.0.1)
 * - AI_BROWSER_RUNTIME_PORT: Daemon port (default: 51432)
 * - AI_BROWSER_RUNTIME_LOCKDIR: Lockfile directory (default: temp/ai-browser-runtime)
 */

import * as readline from "readline";
import { WebSocket } from "ws";

// Import shared framing
export { readLengthPrefix, frameMessage } from "./framing";

// Shim configuration from environment
export interface ShimConfig {
  host: string;
  port: number;
  token: string;
  lockDir: string;
  lockFilename: string;
  connectTimeoutMs: number;
  daemonStartupTimeoutMs: number;
}

/**
 * Parse shim configuration from environment
 */
export function parseConfig(): ShimConfig {
  const env = process.env as Record<string, string | undefined>;
  return {
    host: env["AI_BROWSER_RUNTIME_HOST"] ?? "127.0.0.1",
    port: parseInt(env["AI_BROWSER_RUNTIME_PORT"] ?? "51432", 10),
    token: env["AI_BROWSER_RUNTIME_TOKEN"] ?? "",
    lockDir: env["AI_BROWSER_RUNTIME_LOCKDIR"] ?? "",
    lockFilename: "daemon.pid",
    connectTimeoutMs: 5000,
    daemonStartupTimeoutMs: 10000,
  };
}