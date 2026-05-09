#!/usr/bin/env node
/**
 * Daemon entry point — starts WebSocket hub with DirectCDPAdapter backend.
 *
 * Env vars:
 *   AI_BROWSER_CDP_PORT        Chrome remote debugging port (default: 9222)
 *   AI_BROWSER_DAEMON_PORT     Daemon WebSocket port (default: 51432)
 *   AI_BROWSER_AUTH_SECRET     Auth token secret (default: dev-secret-change-in-production)
 */

import { createDaemon } from "./lifecycle/index.js";
import { DirectCDPAdapter } from "@navora/browser-tools";

const CDP_PORT = Number(process.env["AI_BROWSER_CDP_PORT"] ?? 9222);
const DAEMON_PORT = Number(process.env["AI_BROWSER_DAEMON_PORT"] ?? 51432);
const AUTH_SECRET = process.env["AI_BROWSER_AUTH_SECRET"] ?? "dev-secret-change-in-production";

const adapter = new DirectCDPAdapter({ cdpPort: CDP_PORT });

let daemon: Awaited<ReturnType<typeof createDaemon>>;

try {
  daemon = await createDaemon({
    wsPort: DAEMON_PORT,
    wsHost: "127.0.0.1",
    authSecret: AUTH_SECRET,
    cdpAdapter: adapter,
    debug: process.env["AI_BROWSER_DEBUG"] === "1",
  });

  await daemon.start();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("already running")) {
    // Another daemon is already up — exit cleanly
    process.exit(0);
  }
  console.error(`[daemon] Fatal: ${msg}`);
  process.exit(1);
}

const shutdown = async (signal: string) => {
  console.log(`[daemon] ${signal} received, shutting down...`);
  await adapter.dispose();
  await daemon.stop();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", async (e) => {
  console.error("[daemon] Uncaught exception:", e);
  await daemon.stop();
  process.exit(1);
});
process.on("unhandledRejection", async (reason) => {
  console.error("[daemon] Unhandled rejection:", reason);
  await daemon.stop();
  process.exit(1);
});
