/**
 * @navora/daemon - Lifecycle Index
 * Daemon entry point, state management, graceful shutdown
 */

import { LockfileManager, createLockfileManager, type LockfileData } from "./lockfile";
import type { WebSocketHub, ShimConnectedPayload } from "../transport/websocket";
import type { StdioTransport } from "../transport/stdio";
import type { BrowserAdapter } from "@navora/browser-tools";
import { NMAdapter } from "@navora/browser-tools";
import { isOk } from "@navora/shared";
import type { AdapterRegistry } from "../dispatcher/adapter-registry";
import type { ChromeExtensionAdapter } from "../nm/adapter";
import { ExtensionNotConnectedError, CdpNotAvailableError } from "../dispatcher/adapter-errors";
import { resolveAdapterRegistryKey, PERSISTENCE_ONLY_TOOLS } from "../dispatcher/pipeline";
import { cdpEvaluate, cdpNetworkHar, cdpSendCommand } from "../dispatcher/cdp-direct-tools";

async function dispatchAdapterTool(
  adapter: BrowserAdapter | undefined,
  tool: string,
  params: Record<string, unknown>,
  tabId: number | undefined,
  cdpPort: number
): Promise<unknown> {
  const skipAdapter = tool.startsWith("cdp_") || PERSISTENCE_ONLY_TOOLS.has(tool);

  if (!skipAdapter && !adapter) {
    throw new Error("No browser adapter for this tool");
  }

  switch (tool) {
    case "browser_get_tabs": {
      const r = await adapter!.getTabs();
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_get_active_tab": {
      const r = await adapter!.getActiveTab();
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_navigate": {
      const url = params["url"] as string;
      if (!url) throw new Error("Missing url");
      const r = await adapter!.navigate(url, tabId);
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_go_back": {
      const r = await adapter!.goBack(tabId);
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_reload": {
      const r = await adapter!.reload(tabId);
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_get_dom": {
      const r = await adapter!.extractDom(tabId);
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_get_text": {
      const r = await adapter!.extractText(tabId);
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_click": {
      const selector = params["selector"] as string;
      if (!selector) throw new Error("Missing selector");
      const r = await adapter!.clickElement(selector, tabId);
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_type": {
      const text = params["text"] as string;
      if (!text) throw new Error("Missing text");
      const selector = params["selector"] as string | undefined;
      const r = await adapter!.typeText(text, selector, tabId);
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_scroll": {
      const deltaY = params["deltaY"] as number | undefined;
      const selector = params["selector"] as string | undefined;
      const r = await adapter!.scroll(selector, deltaY, tabId);
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_wait_for": {
      const selector = params["selector"] as string | undefined;
      const text = params["text"] as string | undefined;
      const timeout = params["timeout"] as number | undefined;
      if (!selector && !text) {
        throw new Error("Missing required param: selector or text");
      }
      if (text) {
        const caseSensitive = params["caseSensitive"] as boolean | undefined;
        const waitOpts: { timeout?: number; caseSensitive?: boolean } = {};
        if (timeout !== undefined) waitOpts.timeout = timeout;
        if (caseSensitive !== undefined) waitOpts.caseSensitive = caseSensitive;
        const r = await adapter!.waitForText(
          text,
          Object.keys(waitOpts).length > 0 ? waitOpts : undefined,
          tabId
        );
        if (!isOk(r)) throw r.error;
        return r.value;
      }
      const r = await adapter!.waitForSelector(selector!, timeout, tabId);
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_screenshot": {
      const r = await adapter!.takeScreenshot(tabId);
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_get_console": {
      const r = await adapter!.getConsoleLogs(tabId);
      if (!isOk(r)) throw r.error;
      return r.value;
    }
    case "browser_execute_script": {
      const source = params["source"] as string;
      if (!source) throw new Error("Missing source");
      const r = await adapter!.executeScript(source, tabId);
      if (!isOk(r)) throw r.error;
      return r.value;
    }

    case "cdp_evaluate": {
      const expression = params["expression"] as string;
      if (!expression) throw new Error("Missing expression");
      return cdpEvaluate(expression, cdpPort);
    }

    case "cdp_send_command": {
      const method = params["method"] as string;
      if (!method) throw new Error("Missing method");
      const cdpParams = params["params"] as Record<string, unknown> | undefined;
      return cdpSendCommand(method, cdpParams, cdpPort);
    }

    case "cdp_network_har": {
      return cdpNetworkHar(cdpPort);
    }

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

/** Daemon configuration */
export interface DaemonConfig {
  /** WebSocket port (default: 51520) */
  wsPort?: number;
  /** WebSocket host (default: 127.0.0.1) */
  wsHost?: string;
  /** Enable stdio MCP server (default: true) */
  enableStdio?: boolean;
  /** Lockfile configuration */
  lockfile?: {
    lockDir?: string;
    lockFilename?: string;
  };
  /** Auth secret for token validation */
  authSecret?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Adapter registry (`nm:*`, `cdp:*` keys) — required for WebSocket tools/call */
  adapterRegistry?: AdapterRegistry;
  /** Shared Chrome NM bridge — receives shim WebSocket payloads */
  extensionAdapter?: ChromeExtensionAdapter;
  /** CDP port for routing `cdp_*` tools (default NAVORA_CDP_PORT / 9222) */
  cdpPort?: number;
}

/** Daemon application state */
export interface DaemonState {
  startedAt: number;
  lockData: LockfileData;
  wsPort: number;
  wsHost: string;
  stdioEnabled: boolean;
}

/** Daemon instance interface */
export interface DaemonInstance {
  /** Start the daemon */
  start: () => Promise<void>;
  /** Stop the daemon gracefully */
  stop: () => Promise<void>;
  /** Get daemon state */
  getState: () => DaemonState | null;
  /** Check if running */
  isRunning: () => boolean;
}

/**
 * Create a new daemon instance
 */
export async function createDaemon(config: DaemonConfig = {}): Promise<DaemonInstance> {
  // Create lockfile manager
  const lockfileManager = createLockfileManager(config.lockfile);

  // Attempt to acquire lockfile
  const lockData = await lockfileManager.acquire();
  if (!lockData) {
    const existing = await lockfileManager.read();
    throw new Error(
      `Daemon already running (PID: ${existing?.pid ?? "unknown"}) on ${existing?.hostname ?? "unknown host"}`
    );
  }

  // Create state
  const state: DaemonState = {
    startedAt: Date.now(),
    lockData,
    wsPort: config.wsPort ?? 51520,
    wsHost: config.wsHost ?? "127.0.0.1",
    stdioEnabled: config.enableStdio ?? true,
  };

  // References for cleanup
  let wsHub: WebSocketHub | null = null;
  let running = false;
  let stopCalled = false;

  return {
    async start(): Promise<void> {
      if (running) {
        return;
      }

      console.log(`Starting daemon (PID: ${process.pid})...`);
      console.log(`Lockfile: ${lockfileManager.getLockPath()}`);

      // Start WebSocket hub if configured
      if (config.wsPort) {
        const { createWebSocketHub } = await import("../transport/websocket");

        wsHub = createWebSocketHub({
          port: config.wsPort,
          host: config.wsHost ?? "127.0.0.1",
          authSecret: config.authSecret ?? "dev-secret-change-in-production",
          debug: config.debug ?? false,
        });

        // Register default handlers
        wsHub.registerHandler("ping", async (request) => {
          return JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { pong: Date.now() },
          });
        });

        const cdpPort = config.cdpPort ?? Number(process.env["NAVORA_CDP_PORT"] ?? 9222);

        if (config.adapterRegistry) {
          const registry = config.adapterRegistry;

          wsHub.registerHandler("tools/call", async (request, client) => {
            const params = (request.params ?? {}) as Record<string, unknown>;
            const tool = params["tool"] as string;
            const toolParams = (params["params"] as Record<string, unknown>) ?? {};
            const tabId = typeof toolParams["tabId"] === "number" ? toolParams["tabId"] : undefined;
            const profileId = client.profileId ?? "default";

            const skipAdapter = tool.startsWith("cdp_") || PERSISTENCE_ONLY_TOOLS.has(tool);

            let adapter: BrowserAdapter | undefined;
            if (!skipAdapter) {
              const kr = resolveAdapterRegistryKey(tool, profileId, cdpPort);
              if (!isOk(kr)) {
                return JSON.stringify({
                  jsonrpc: "2.0",
                  id: request.id,
                  error: { code: -32602, message: kr.error.message },
                });
              }

              const ar = registry.get(kr.value);
              if (!isOk(ar)) {
                const msg = kr.value.startsWith("nm:")
                  ? new ExtensionNotConnectedError(profileId).message
                  : new CdpNotAvailableError(cdpPort).message;
                return JSON.stringify({
                  jsonrpc: "2.0",
                  id: request.id,
                  result: { success: false, error: msg },
                });
              }
              adapter = ar.value;
            }

            try {
              const data = await dispatchAdapterTool(adapter, tool, toolParams, tabId, cdpPort);
              return JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { success: true, data } });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              return JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { success: false, error: msg } });
            }
          });
        } else {
          wsHub.registerHandler("tools/call", async (request) => {
            return JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              error: { code: -32603, message: "No adapter registry configured" },
            });
          });
        }

        if (config.extensionAdapter && config.adapterRegistry) {
          const ext = config.extensionAdapter;
          const registry = config.adapterRegistry;

          wsHub.on("shim-connected", (payload: ShimConnectedPayload) => {
            const { profileId, socket } = payload;
            ext.attachWebSocketBridge(profileId, socket);

            void (async () => {
              const nm = new NMAdapter(ext, profileId);
              const initResult = await nm.initialize();
              if (!isOk(initResult)) {
                console.warn(`[daemon] NM adapter init failed for ${profileId}: ${initResult.error.message}`);
                return;
              }
              const reg = registry.register(`nm:${profileId}`, nm);
              if (!isOk(reg)) {
                console.warn(`[daemon] register nm:${profileId}: ${reg.error.message}`);
              }
            })();

            socket.once("close", () => {
              void registry.unregister(`nm:${profileId}`);
            });
          });
        }

        wsHub.start();
        console.log(`WebSocket hub listening on ${state.wsHost}:${state.wsPort}`);
      }

      // Note: Stdio transport is started separately via runStdioServer()
      if (state.stdioEnabled) {
        console.log("Stdio MCP server ready");
      }

      running = true;
      console.log("Daemon started successfully");
    },

    async stop(): Promise<void> {
      if (stopCalled) {
        return;
      }
      stopCalled = true;

      console.log("Stopping daemon...");

      // Stop WebSocket hub
      if (wsHub) {
        wsHub.stop();
        wsHub = null;
      }

      // Release lockfile
      await lockfileManager.release();

      running = false;
      console.log("Daemon stopped");
    },

    getState(): DaemonState | null {
      return state;
    },

    isRunning(): boolean {
      return running;
    },
  };
}

/**
 * Run the daemon as the main entry point
 */
export async function runDaemon(config: DaemonConfig = {}): Promise<void> {
  let daemon: DaemonInstance;

  try {
    daemon = await createDaemon(config);
    await daemon.start();

    // Set up graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}, shutting down...`);
      await daemon.stop();
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Handle uncaught errors
    process.on("uncaughtException", async (error) => {
      console.error("Uncaught exception:", error);
      await daemon.stop();
      process.exit(1);
    });

    process.on("unhandledRejection", async (reason) => {
      console.error("Unhandled rejection:", reason);
      await daemon.stop();
      process.exit(1);
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("already running")) {
      console.error(message);
      process.exit(1);
    }
    throw err;
  }
}

// Re-export for convenience
export {
  LockfileManager,
  createLockfileManager,
  type LockfileData,
} from "./lockfile";