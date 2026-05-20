/**
 * AdapterRegistry - Manages multiple BrowserAdapter instances per profile
 * Provides routing and lifecycle management for browser adapters
 */

import type { BrowserAdapter, BrowserAdapterEventListener } from "@navora/browser-tools";
import type { Logger } from "@navora/shared";
import { ok, err, isError, type Result } from "@navora/shared";

export interface AdapterRegistryConfig {
  /** Default timeout for adapter operations (ms) */
  defaultTimeout?: number;
  /** Logger instance */
  logger?: Logger;
}

export interface AdapterEntry {
  adapter: BrowserAdapter;
  /** Compound key e.g. `nm:<profileId>` or `cdp:<port>` */
  registryKey: string;
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
   * Register an adapter under a compound registry key (`nm:…`, `cdp:…`).
   */
  register(registryKey: string, adapter: BrowserAdapter): Result<void, Error> {
    if (this.adapters.has(registryKey)) {
      this.logger?.warn?.(`AdapterRegistry: overwriting existing adapter for ${registryKey}`);
      // Clean up old adapter
      void this.unregister(registryKey);
    }

    const entry: AdapterEntry = {
      adapter,
      registryKey,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      activeTabs: 0,
    };

    this.adapters.set(registryKey, entry);
    this.logger?.info?.(`AdapterRegistry: registered adapter for ${registryKey}`);

    // Forward events to listeners
    adapter.on((event) => {
      const listeners = this.eventListeners.get(registryKey);
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
  async unregister(registryKey: string): Promise<Result<void, Error>> {
    const entry = this.adapters.get(registryKey);
    if (!entry) {
      return ok(undefined); // Already unregistered
    }

    try {
      await entry.adapter.dispose();
      this.adapters.delete(registryKey);
      this.eventListeners.delete(registryKey);
      this.logger?.info?.(`AdapterRegistry: unregistered ${registryKey}`);
      return ok(undefined);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger?.error?.(`AdapterRegistry: failed to unregister ${registryKey}: ${errMsg}`);
      // Still remove from map even if dispose failed
      this.adapters.delete(registryKey);
      this.eventListeners.delete(registryKey);
      return err(new Error(`Failed to dispose adapter: ${errMsg}`));
    }
  }

  /**
   * Get an adapter by registry key
   */
  get(registryKey: string): Result<BrowserAdapter, Error> {
    const entry = this.adapters.get(registryKey);
    if (!entry) {
      return err(new Error(`No adapter registered for key: ${registryKey}`));
    }

    entry.lastUsed = Date.now();
    return ok(entry.adapter);
  }

  /**
   * Check if an adapter exists for a registry key
   */
  has(registryKey: string): boolean {
    return this.adapters.has(registryKey);
  }

  /**
   * List all registered keys
   */
  listProfiles(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get adapter stats
   */
  getStats(registryKey: string): Result<AdapterStats, Error> {
    const entry = this.adapters.get(registryKey);
    if (!entry) {
      return err(new Error(`No adapter for key: ${registryKey}`));
    }

    return ok({
      registryKey: entry.registryKey,
      createdAt: entry.createdAt,
      lastUsed: entry.lastUsed,
      activeTabs: entry.activeTabs,
      uptimeMs: Date.now() - entry.createdAt,
    });
  }

  /**
   * Subscribe to adapter events
   */
  on(registryKey: string, listener: BrowserAdapterEventListener): Result<void, Error> {
    if (!this.adapters.has(registryKey)) {
      return err(new Error(`No adapter registered for key: ${registryKey}`));
    }

    let listeners = this.eventListeners.get(registryKey);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(registryKey, listeners);
    }
    listeners.add(listener);

    return ok(undefined);
  }

  /**
   * Unsubscribe from adapter events
   */
  off(registryKey: string, listener: BrowserAdapterEventListener): Result<void, Error> {
    const listeners = this.eventListeners.get(registryKey);
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
    const keys = Array.from(this.adapters.keys());

    for (const registryKey of keys) {
      const result = await this.unregister(registryKey);
      if (isError(result)) {
        errors.push(`${registryKey}: ${result.error.message}`);
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
  registryKey: string;
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