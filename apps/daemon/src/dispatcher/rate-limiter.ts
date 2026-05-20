/**
 * RateLimiter - Per-session rate limiting for the dispatcher
 * Implements token bucket algorithm per profile/tool combination
 */

import type { Logger } from "@navora/shared";
import { ok, type Result } from "@navora/shared";

export interface RateLimiterConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Optional logger */
  logger?: Logger;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * RateLimiter - Token bucket rate limiter per profile/tool
 */
export class RateLimiter {
  private maxRequests: number;
  private windowMs: number;
  private logger: Logger;
  private buckets = new Map<string, RateLimitEntry>();

  constructor(config: RateLimiterConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
    this.logger = config.logger ?? this.createDefaultLogger();
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

  /**
   * Check if a request is allowed for the given profile and tool
   */
  check(profileId: string, tool: string): Result<RateLimitResult, Error> {
    const key = this.makeKey(profileId, tool);
    const now = Date.now();

    let entry = this.buckets.get(key);

    // Check if we need to reset the window
    if (!entry || now - entry.windowStart >= this.windowMs) {
      entry = { count: 0, windowStart: now };
      this.buckets.set(key, entry);
    }

    // Check if allowed
    if (entry.count >= this.maxRequests) {
      const retryAfter = Math.ceil((entry.windowStart + this.windowMs - now) / 1000);
      this.logger?.debug?.(`RateLimiter: denied ${profileId}/${tool}, retry after ${retryAfter}s`);
      return ok({
        allowed: false,
        retryAfterSeconds: retryAfter,
        currentCount: entry.count,
        maxRequests: this.maxRequests,
      });
    }

    // Increment counter
    entry.count++;
    this.logger?.debug?.(`RateLimiter: allowed ${profileId}/${tool}, count ${entry.count}/${this.maxRequests}`);

    return ok({
      allowed: true,
      retryAfterSeconds: 0,
      currentCount: entry.count,
      maxRequests: this.maxRequests,
    });
  }

  /**
   * Get current rate limit status without consuming a token
   */
  getStatus(profileId: string, tool: string): Result<RateLimitResult, Error> {
    const key = this.makeKey(profileId, tool);
    const now = Date.now();

    const entry = this.buckets.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      return ok({
        allowed: true,
        retryAfterSeconds: 0,
        currentCount: 0,
        maxRequests: this.maxRequests,
      });
    }

    const retryAfter = entry.count >= this.maxRequests 
      ? Math.ceil((entry.windowStart + this.windowMs - now) / 1000)
      : 0;

    return ok({
      allowed: entry.count < this.maxRequests,
      retryAfterSeconds: retryAfter,
      currentCount: entry.count,
      maxRequests: this.maxRequests,
    });
  }

  /**
   * Reset rate limit for a profile/tool combination
   */
  reset(profileId: string, tool?: string): void {
    if (tool) {
      const key = this.makeKey(profileId, tool);
      this.buckets.delete(key);
      this.logger?.debug?.(`RateLimiter: reset ${key}`);
    } else {
      // Reset all limits for this profile
      const prefix = `${profileId}:`;
      for (const key of this.buckets.keys()) {
        if (key.startsWith(prefix)) {
          this.buckets.delete(key);
        }
      }
      this.logger?.debug?.(`RateLimiter: reset all for ${profileId}`);
    }
  }

  /**
   * Clean up expired entries
   */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.buckets.entries()) {
      if (now - entry.windowStart >= this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }

  private makeKey(profileId: string, tool: string): string {
    return `${profileId}:${tool}`;
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  currentCount: number;
  maxRequests: number;
}

/**
 * Create a rate limiter with default configuration
 */
export function createRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter {
  const cfg: RateLimiterConfig = {
    maxRequests: config?.maxRequests ?? 30,
    windowMs: config?.windowMs ?? 60_000,
  };
  if (config?.logger) {
    cfg.logger = config.logger;
  }
  return new RateLimiter(cfg);
}