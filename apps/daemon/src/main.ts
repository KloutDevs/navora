#!/usr/bin/env node
/**
 * Daemon entry point — WebSocket hub + adapter registry (NM + CDP keys).
 *
 * Env vars:
 *   NAVORA_CDP_PORT        Chrome remote debugging port (default: 9222)
 *   NAVORA_DAEMON_PORT     Daemon WebSocket port (default: 51520)
 *   NAVORA_AUTH_SECRET     Auth token secret (default: dev-secret-change-in-production)
 */

import { createDaemon } from "./lifecycle/index.js";
import { createAdapterRegistry } from "./dispatcher/adapter-registry.js";
import { DirectCDPAdapter } from "@navora/browser-tools";
import { createChromeExtensionAdapter } from "./nm/adapter.js";
import { isOk } from "@navora/shared";

const CDP_PORT = Number(process.env["NAVORA_CDP_PORT"] ?? 9222);
const DAEMON_PORT = Number(process.env["NAVORA_DAEMON_PORT"] ?? 51520);
const AUTH_SECRET = process.env["NAVORA_AUTH_SECRET"] ?? "dev-secret-change-in-production";

const registry = createAdapterRegistry();

const cdpAdapter = new DirectCDPAdapter({ cdpPort: CDP_PORT });
const cdpInit = await cdpAdapter.initialize();
if (!isOk(cdpInit)) {
  console.warn(`[daemon] CDP adapter init warning: ${cdpInit.error.message}`);
}

const cdpReg = registry.register(`cdp:${CDP_PORT}`, cdpAdapter);
if (!isOk(cdpReg)) {
  console.warn(`[daemon] Could not register CDP adapter: ${cdpReg.error.message}`);
}

const extensionAdapter = createChromeExtensionAdapter({
  defaultConnectionConfig: {},
  multiplexerConfig: {},
});

let daemon: Awaited<ReturnType<typeof createDaemon>>;

try {
  daemon = await createDaemon({
    wsPort: DAEMON_PORT,
    wsHost: "127.0.0.1",
    authSecret: AUTH_SECRET,
    adapterRegistry: registry,
    extensionAdapter,
    cdpPort: CDP_PORT,
    debug: process.env["NAVORA_DEBUG"] === "1",
  });

  await daemon.start();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("already running")) {
    process.exit(0);
  }
  console.error(`[daemon] Fatal: ${msg}`);
  process.exit(1);
}

const shutdown = async (signal: string) => {
  console.log(`[daemon] ${signal} received, shutting down...`);
  extensionAdapter.destroy();
  await registry.closeAll();
  await daemon.stop();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", async (e) => {
  console.error("[daemon] Uncaught exception:", e);
  extensionAdapter.destroy();
  await daemon.stop();
  process.exit(1);
});
process.on("unhandledRejection", async (reason) => {
  console.error("[daemon] Unhandled rejection:", reason);
  extensionAdapter.destroy();
  await daemon.stop();
  process.exit(1);
});
process.on("exit", (code) => {
  console.error(`[daemon] process.exit called with code ${code}`);
});

// Keep the event loop alive — guards against the WebSocket server being unreffed.
const _keepAlive = setInterval(() => {}, 60_000);
