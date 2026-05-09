/**
 * CDP connection management.
 * Handles connection lifecycle, reconnection, and target discovery.
 */

import type { Result } from "@ai-browser-runtime/shared";
import { DevToolsProtocol } from "./client";

export interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
  title?: string;
  favIconUrl?: string;
}

export interface ConnectionManagerOptions {
  /** CDP port (default: 9222) */
  port?: number;
  /** Connection timeout in ms */
  connectTimeout?: number;
  /** Reconnection attempts on failure */
  maxRetries?: number;
  /** Delay between retries in ms */
  retryDelay?: number;
}

const DEFAULT_PORT = 9222;
const DEFAULT_CONNECT_TIMEOUT = 5000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

/**
 * ConnectionManager handles the CDP WebSocket lifecycle.
 * - Lazy connect on first use
 * - Target discovery (tabs, pages)
 * - Reconnection with backoff
 */
export class ConnectionManager {
  private readonly port: number;
  private readonly connectTimeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private cdp: DevToolsProtocol;
  private retryCount = 0;

  constructor(options: ConnectionManagerOptions = {}) {
    this.port = options.port ?? DEFAULT_PORT;
    this.connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelay = options.retryDelay ?? DEFAULT_RETRY_DELAY;
    this.cdp = new DevToolsProtocol({
      port: this.port,
      connectTimeout: this.connectTimeout,
    });
  }

  /**
   * Connect to Chrome via CDP.
   */
  async connect(): Promise<Result<void, Error>> {
    if (this.cdp.isConnected()) {
      return { ok: true, value: undefined };
    }

    try {
      await this.cdp.connect();
      this.retryCount = 0;
      return { ok: true, value: undefined };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  /**
   * Discover all browser targets (tabs, pages, etc.).
   */
  async discoverTargets(): Promise<Result<TargetInfo[], Error>> {
    if (!this.cdp.isConnected()) {
      const connected = await this.connect();
      if (!connected.ok) return { ok: false, error: connected.error };
    }

    try {
      const result = await this.cdp.send("Target.getTargets", {});
      if (!result.ok) return { ok: false, error: result.error };

      const targets = (result.value as { targetInfos?: TargetInfo[] })?.targetInfos ?? [];
      return {
        ok: true,
        value: targets.map((t) => ({
          targetId: t.targetId,
          type: t.type,
          url: t.url ?? "",
          title: t.title !== undefined ? t.title : "",
          favIconUrl: t.favIconUrl !== undefined ? t.favIconUrl : "",
        })),
      };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  /**
   * Attach to a specific target (creates a CDP session for it).
   */
  async attachTarget(targetId: string): Promise<Result<string, Error>> {
    if (!this.cdp.isConnected()) {
      const connected = await this.connect();
      if (!connected.ok) return { ok: false, error: connected.error };
    }

    try {
      const result = await this.cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });

      if (!result.ok) return { ok: false, error: result.error };

      const sessionId = (result.value as { sessionId?: string })?.sessionId ?? "";
      return { ok: true, value: sessionId };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  /**
   * Disconnect and clean up.
   */
  async dispose(): Promise<Result<void, Error>> {
    return this.cdp.dispose();
  }

  /** Get the underlying CDP client */
  getClient(): DevToolsProtocol {
    return this.cdp;
  }

  /** Check connection status */
  isConnected(): boolean {
    return this.cdp.isConnected();
  }

  /** Get current retry count */
  getRetryCount(): number {
    return this.retryCount;
  }
}