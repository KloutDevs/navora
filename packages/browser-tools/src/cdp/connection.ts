/**
 * CDP connection management.
 * Handles connection lifecycle and target discovery.
 */

import type { Logger, Result } from "@navora/shared";
import { createNoOpLogger } from "@navora/shared";
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
  /** Structured logger (defaults to no-op). */
  logger?: Logger;
}

const DEFAULT_PORT = 9222;
const DEFAULT_CONNECT_TIMEOUT = 5000;

/**
 * ConnectionManager handles the CDP WebSocket lifecycle.
 * - Lazy connect on first use
 * - Target discovery (tabs, pages)
 * - {@link DevToolsProtocol#connect} and {@link DevToolsProtocol#send} errors propagate as {@link Result}
 */
export class ConnectionManager {
  private readonly port: number;
  private readonly connectTimeout: number;
  private readonly logger: Logger;
  private cdp: DevToolsProtocol;

  constructor(options: ConnectionManagerOptions = {}) {
    this.port = options.port ?? DEFAULT_PORT;
    this.connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
    this.logger = options.logger ?? createNoOpLogger();
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
      this.logger.debug("cdp.connect skipped — already connected", { port: this.port });
      return { ok: true, value: undefined };
    }

    this.logger.info("cdp.connect starting", { port: this.port, connectTimeoutMs: this.connectTimeout });

    try {
      await this.cdp.connect();
      this.logger.info("cdp.connect succeeded", { port: this.port });
      return { ok: true, value: undefined };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.error("cdp.connect failed", err, { port: this.port });
      return { ok: false, error: err };
    }
  }

  /**
   * Discover all browser targets (tabs, pages, etc.).
   */
  async discoverTargets(): Promise<Result<TargetInfo[], Error>> {
    if (!this.cdp.isConnected()) {
      const connected = await this.connect();
      if (!connected.ok) {
        this.logger.warn("cdp.discoverTargets aborted — connect failed", {
          port: this.port,
        });
        return { ok: false, error: connected.error };
      }
    }

    this.logger.debug("cdp.discoverTargets sending Target.getTargets", { port: this.port });

    try {
      const result = await this.cdp.send("Target.getTargets", {});
      if (!result.ok) {
        this.logger.error("cdp.discoverTargets CDP command failed", result.error, {
          port: this.port,
        });
        return { ok: false, error: result.error };
      }

      const targets = (result.value as { targetInfos?: TargetInfo[] })?.targetInfos ?? [];
      const mapped = targets.map((t) => ({
        targetId: t.targetId,
        type: t.type,
        url: t.url ?? "",
        title: t.title !== undefined ? t.title : "",
        favIconUrl: t.favIconUrl !== undefined ? t.favIconUrl : "",
      }));

      this.logger.info("cdp.discoverTargets completed", {
        port: this.port,
        targetCount: mapped.length,
      });

      return {
        ok: true,
        value: mapped,
      };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.error("cdp.discoverTargets threw", err, { port: this.port });
      return { ok: false, error: err };
    }
  }

  /**
   * Attach to a specific target (creates a CDP session for it).
   */
  async attachTarget(targetId: string): Promise<Result<string, Error>> {
    if (!this.cdp.isConnected()) {
      const connected = await this.connect();
      if (!connected.ok) {
        this.logger.warn("cdp.attachTarget aborted — connect failed", {
          port: this.port,
          targetId,
        });
        return { ok: false, error: connected.error };
      }
    }

    this.logger.debug("cdp.attachTarget sending Target.attachToTarget", {
      port: this.port,
      targetId,
    });

    try {
      const result = await this.cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });

      if (!result.ok) {
        this.logger.error("cdp.attachTarget CDP command failed", result.error, {
          port: this.port,
          targetId,
        });
        return { ok: false, error: result.error };
      }

      const sessionId = (result.value as { sessionId?: string })?.sessionId ?? "";
      this.logger.info("cdp.attachTarget completed", {
        port: this.port,
        targetId,
        sessionIdLength: sessionId.length,
      });
      return { ok: true, value: sessionId };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.error("cdp.attachTarget threw", err, { port: this.port, targetId });
      return { ok: false, error: err };
    }
  }

  /**
   * Disconnect and clean up.
   */
  async dispose(): Promise<Result<void, Error>> {
    this.logger.info("cdp.dispose starting", { port: this.port });
    const result = await this.cdp.dispose();
    if (result.ok) {
      this.logger.info("cdp.dispose completed", { port: this.port });
    } else {
      this.logger.error("cdp.dispose failed", result.error, { port: this.port });
    }
    return result;
  }

  /** Get the underlying CDP client */
  getClient(): DevToolsProtocol {
    return this.cdp;
  }

  /** Check connection status */
  isConnected(): boolean {
    return this.cdp.isConnected();
  }
}
