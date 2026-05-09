/**
 * AdapterRegistry - Manages multiple BrowserAdapter instances per profile
 * Provides routing and lifecycle management for browser adapters
 */

import type { BrowserAdapter, BrowserAdapterEventListener } from "@navora/browser-tools";
import type { Logger } from "@navora/shared";
import { ok, err, isOk, isError, type Result } from "@navora/shared";

export interface AdapterRegistryConfig {
  /** Default timeout for adapter operations (ms) */
  defaultTimeout?: number;
  /** Logger instance */
  logger?: Logger;
}

export interface AdapterEntry {
  adapter: BrowserAdapter;
  profileId: string;
  createdAt: number;
  lastUsed: number;
  activeTabs: number;
}

/**
 * AdapterRegistry - Manages browser adapters per profile
 */
export class AdapterRegistry {
  private adapters = new Map<string, AdapterEntry>();
  private defaultTimeout: number;
  private logger: Logger;
  private eventListeners = new Map<string, Set<BrowserAdapterEventListener>>();

  constructor(config: AdapterRegistryConfig) {
    this.defaultTimeout = config.defaultTimeout ?? 30_000;
    this.logger = config.logger ?? this.createDefaultLogger();
  }

  /**
   * Register an adapter for a profile
   */
  register(profileId: string, adapter: BrowserAdapter): Result<void, Error> {
    if (this.adapters.has(profileId)) {
      this.logger?.warn?.(`AdapterRegistry: overwriting existing adapter for ${profileId}`);
      // Clean up old adapter
      this.unregister(profileId);
    }

    const entry: AdapterEntry = {
      adapter,
      profileId,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      activeTabs: 0,
    };

    this.adapters.set(profileId, entry);
    this.logger?.info?.(`AdapterRegistry: registered adapter for ${profileId}`);

    // Forward events to listeners
    adapter.on((event) => {
      const listeners = this.eventListeners.get(profileId);
      if (listeners) {
        for (const listener of listeners) {
          listener(event);
        }
      }
    });

    return ok(undefined);
  }

  /**
   * Unregister an adapter
   */
  async unregister(profileId: string): Promise<Result<void, Error>> {
    const entry = this.adapters.get(profileId);
    if (!entry) {
      return ok(undefined); // Already unregistered
    }

    try {
      await entry.adapter.dispose();
      this.adapters.delete(profileId);
      this.eventListeners.delete(profileId);
      this.logger?.info?.(`AdapterRegistry: unregistered ${profileId}`);
      return ok(undefined);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger?.error?.(`AdapterRegistry: failed to unregister ${profileId}: ${errMsg}`);
      // Still remove from map even if dispose failed
      this.adapters.delete(profileId);
      this.eventListeners.delete(profileId);
      return err(new Error(`Failed to dispose adapter: ${errMsg}`));
    }
  }

  /**
   * Get an adapter for a profile
   */
  get(profileId: string): Result<BrowserAdapter, Error> {
    const entry = this.adapters.get(profileId);
    if (!entry) {
      return err(new Error(`No adapter registered for profile: ${profileId}`));
    }

    entry.lastUsed = Date.now();
    return ok(entry.adapter);
  }

  /**
   * Check if an adapter exists for a profile
   */
  has(profileId: string): boolean {
    return this.adapters.has(profileId);
  }

  /**
   * List all registered profiles
   */
  listProfiles(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get adapter stats
   */
  getStats(profileId: string): Result<AdapterStats, Error> {
    const entry = this.adapters.get(profileId);
    if (!entry) {
      return err(new Error(`No adapter for profile: ${profileId}`));
    }

    return ok({
      profileId: entry.profileId,
      createdAt: entry.createdAt,
      lastUsed: entry.lastUsed,
      activeTabs: entry.activeTabs,
      uptimeMs: Date.now() - entry.createdAt,
    });
  }

  /**
   * Subscribe to adapter events
   */
  on(profileId: string, listener: BrowserAdapterEventListener): Result<void, Error> {
    if (!this.adapters.has(profileId)) {
      return err(new Error(`No adapter registered for profile: ${profileId}`));
    }

    let listeners = this.eventListeners.get(profileId);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(profileId, listeners);
    }
    listeners.add(listener);

    return ok(undefined);
  }

  /**
   * Unsubscribe from adapter events
   */
  off(profileId: string, listener: BrowserAdapterEventListener): Result<void, Error> {
    const listeners = this.eventListeners.get(profileId);
    if (!listeners) {
      return ok(undefined);
    }

    listeners.delete(listener);
    return ok(undefined);
  }

  /**
   * Get the default timeout
   */
  getDefaultTimeout(): number {
    return this.defaultTimeout;
  }

  /**
   * Close all adapters
   */
  async closeAll(): Promise<Result<void, Error>> {
    const errors: string[] = [];
    const profileIds = Array.from(this.adapters.keys());

    for (const profileId of profileIds) {
      const result = await this.unregister(profileId);
      if (isError(result)) {
        errors.push(`${profileId}: ${result.error.message}`);
      }
    }

    if (errors.length > 0) {
      return err(new Error(`Failed to close some adapters: ${errors.join(", ")}`));
    }

    this.logger?.info?.("AdapterRegistry: closed all adapters");
    return ok(undefined);
  }

  /**
 * Get all adapters (for admin/debugging)
   */
  getAll(): Map<string, AdapterEntry> {
    return new Map(this.adapters);
  }

  private createDefaultLogger(): Logger {
    return {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: console.warn,
      error: console.error,
      child: () => this.createDefaultLogger(),
    };
  }
}

export interface AdapterStats {
  profileId: string;
  createdAt: number;
  lastUsed: number;
  activeTabs: number;
  uptimeMs: number;
}

/**
 * Create an adapter registry with default configuration
 */
export function createAdapterRegistry(config?: Partial<AdapterRegistryConfig>): AdapterRegistry {
  const cfg: AdapterRegistryConfig = {
    defaultTimeout: config?.defaultTimeout ?? 30_000,
  };
  if (config?.logger) {
    cfg.logger = config.logger;
  }
  return new AdapterRegistry(cfg);
}