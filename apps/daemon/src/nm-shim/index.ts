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
 * - WebSocket: Daemon connection on 127.0.0.1:51520
 * 
 * Environment:
 * - NAVORA_RUNTIME_TOKEN: WebSocket auth token (required)
 * - NAVORA_RUNTIME_HOST: Daemon host (default: 127.0.0.1)
 * - NAVORA_RUNTIME_PORT: Daemon port (default: 51520)
 * - NAVORA_RUNTIME_LOCKDIR: Lockfile directory (default: temp/ai-browser-runtime)
 */


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
    host: env["NAVORA_RUNTIME_HOST"] ?? "127.0.0.1",
    port: parseInt(env["NAVORA_RUNTIME_PORT"] ?? "51520", 10),
    token: env["NAVORA_RUNTIME_TOKEN"] ?? "",
    lockDir: env["NAVORA_RUNTIME_LOCKDIR"] ?? "",
    lockFilename: "daemon.pid",
    connectTimeoutMs: 5000,
    daemonStartupTimeoutMs: 10000,
  };
}