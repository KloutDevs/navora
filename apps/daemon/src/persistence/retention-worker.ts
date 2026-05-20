/**
 * RetentionWorker - Background worker for cleaning up expired blobs
 */

import type { Logger } from "@navora/shared";
import type { BlobStore } from "./blob-store";

export interface RetentionConfig {
  /** Interval between retention checks (default: 1 hour) */
  intervalMs?: number;
  /** Default TTL for blobs (default: 7 days) */
  defaultTtlMs?: number;
  /** Whether to run immediately on start */
  runOnStart?: boolean;
  /** Logger instance */
  logger?: Logger;
}

export interface RetentionWorker {
  /**
   * Start the retention worker
   */
  start(): void;

  /**
   * Stop the retention worker
   */
  stop(): void;

  /**
   * Run a retention cycle manually
   */
  runCycle(): Promise<number>;

  /**
   * Check if the worker is running
   */
  isRunning(): boolean;
}

/**
 * Create a no-op logger for cases when no logger is provided
 */
function createNoOpLogger(): Logger {
  const noOpLogger: Logger = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => noOpLogger,
  };
  return noOpLogger;
}

/**
 * Create a new RetentionWorker instance
 */
export function createRetentionWorker(
  blobStore: BlobStore,
  config: RetentionConfig = {}
): RetentionWorker {
  const { intervalMs = 60 * 60 * 1000, runOnStart = false, logger: configLogger } = config;
  const logger = configLogger ?? createNoOpLogger();

  let intervalId: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function runRetention(): Promise<number> {
    const result = blobStore.deleteExpired();
    if (result.ok) {
      logger?.debug?.(`RetentionWorker: cleaned ${result.value} expired blobs`);
      return result.value;
    }
    logger?.error?.(`RetentionWorker: cleanup failed - ${result.error.message}`);
    return 0;
  }

  return {
    start(): void {
      if (running) {
        return;
      }

      running = true;
      logger?.info?.(`RetentionWorker: starting (interval: ${intervalMs}ms)`);

      // Run immediately if configured
      if (runOnStart) {
        runRetention().catch((err) =>
          logger?.error?.(`RetentionWorker: cycle failed - ${err}`)
        );
      }

      // Schedule periodic runs
      intervalId = setInterval(() => {
        runRetention().catch((err) =>
          logger?.error?.(`RetentionWorker: cycle failed - ${err}`)
        );
      }, intervalMs);
    },

    stop(): void {
      if (!running) {
        return;
      }

      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }

      running = false;
      logger?.info?.("RetentionWorker: stopped");
    },

    async runCycle(): Promise<number> {
      return runRetention();
    },

    isRunning(): boolean {
      return running;
    },
  };
}