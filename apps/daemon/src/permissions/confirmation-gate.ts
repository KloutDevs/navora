/**
 * ConfirmationGate - Handles HUD round-trip permission confirmations with timeout
 */

import { ok, err, type Result } from "@ai-browser-runtime/shared";

export interface PendingConfirmation {
  id: string;
  profileId: string;
  tool: string;
  origin: string;
  scope: "safe" | "mutating" | "dangerous";
  params: Record<string, unknown>;
  requestedAt: Date;
  timeoutAt: Date;
  resolve: (decision: ConfirmationDecision) => void;
  reject: (error: Error) => void;
}

export interface ConfirmationDecision {
  allowed: boolean;
  grantScope?: "safe" | "mutating" | "dangerous";
  rememberDecision?: boolean;
  grantId?: string;
  reason?: string;
}

export interface ConfirmationRequest {
  profileId: string;
  tool: string;
  origin: string;
  scope: "safe" | "mutating" | "dangerous";
  params: Record<string, unknown>;
}

export interface ConfirmationGateConfig {
  /** Default timeout in milliseconds (default: 30 seconds) */
  defaultTimeoutMs?: number;
  /** Maximum timeout allowed in milliseconds (default: 120 seconds) */
  maxTimeoutMs?: number;
  /** Callback when confirmation times out (required if you want timeout notifications) */
  onTimeout: (confirmation: PendingConfirmation) => void;
}

/**
 * ConfirmationGate - Manages pending permission confirmations for HUD round-trips
 */
export class ConfirmationGate {
  private pending: Map<string, PendingConfirmation> = new Map();
  private defaultTimeoutMs: number;
  private maxTimeoutMs: number;
  private onTimeout: (confirmation: PendingConfirmation) => void;
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: ConfirmationGateConfig) {
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 30_000; // 30 seconds default
    this.maxTimeoutMs = config.maxTimeoutMs ?? 120_000; // 120 seconds max
    this.onTimeout = config.onTimeout;
  }

  /**
   * Create a new pending confirmation request
   * Returns a promise that resolves when the HUD responds or times out
   */
  request(request: ConfirmationRequest): Promise<ConfirmationDecision> {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      const id = `conf-${now}-${Math.random().toString(36).slice(2, 8)}`;
      const timeoutAt = new Date(now + this.defaultTimeoutMs);

      const pending: PendingConfirmation = {
        id,
        profileId: request.profileId,
        tool: request.tool,
        origin: request.origin,
        scope: request.scope,
        params: request.params,
        requestedAt: new Date(now),
        timeoutAt,
        resolve,
        reject,
      };

      this.pending.set(id, pending);

      // Set timeout timer
      const timer = setTimeout(() => {
        this.handleTimeout(id);
      }, this.defaultTimeoutMs);

      this.timers.set(id, timer);
    });
  }

  /**
   * Resolve a pending confirmation from HUD response
   */
  resolve(confirmationId: string, decision: ConfirmationDecision): Result<void, Error> {
    const pending = this.pending.get(confirmationId);
    if (!pending) {
      return err(new Error(`Confirmation ${confirmationId} not found`));
    }

    // Clear the timer
    const timer = this.timers.get(confirmationId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(confirmationId);
    }

    // Resolve the promise
    pending.resolve(decision);

    // Clean up
    this.pending.delete(confirmationId);

    return ok(undefined);
  }

  /**
   * Reject a pending confirmation with an error
   */
  reject(confirmationId: string, error: Error): Result<void, Error> {
    const pending = this.pending.get(confirmationId);
    if (!pending) {
      return err(new Error(`Confirmation ${confirmationId} not found`));
    }

    // Clear the timer
    const timer = this.timers.get(confirmationId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(confirmationId);
    }

    // Reject the promise
    pending.reject(error);

    // Clean up
    this.pending.delete(confirmationId);

    return ok(undefined);
  }

  /**
   * Get a pending confirmation by ID
   */
  get(confirmationId: string): PendingConfirmation | undefined {
    return this.pending.get(confirmationId);
  }

  /**
   * List all pending confirmations for a profile
   */
  getPendingForProfile(profileId: string): PendingConfirmation[] {
    return Array.from(this.pending.values()).filter(
      (p) => p.profileId === profileId
    );
  }

  /**
   * Get the number of pending confirmations
   */
  pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Cancel all pending confirmations for a profile
   * Returns the number of cancelled confirmations
   */
  cancelAllForProfile(profileId: string): number {
    const toCancel = Array.from(this.pending.entries()).filter(
      ([, p]) => p.profileId === profileId
    );

    let cancelled = 0;
    for (const [id, pending] of toCancel) {
      const timer = this.timers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(id);
      }
      // Clean up without rejecting - the caller is explicitly cancelling
      this.pending.delete(id);
      cancelled++;
    }

    return cancelled;
  }

  /**
   * Update the timeout for a specific confirmation
   */
  updateTimeout(confirmationId: string, timeoutMs: number): Result<void, Error> {
    if (timeoutMs > this.maxTimeoutMs) {
      return err(new Error(`Timeout ${timeoutMs}ms exceeds maximum ${this.maxTimeoutMs}ms`));
    }

    const pending = this.pending.get(confirmationId);
    if (!pending) {
      return err(new Error(`Confirmation ${confirmationId} not found`));
    }

    // Clear existing timer
    const existingTimer = this.timers.get(confirmationId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Update timeout time
    pending.timeoutAt = new Date(Date.now() + timeoutMs);

    // Set new timer
    const timer = setTimeout(() => {
      this.handleTimeout(confirmationId);
    }, timeoutMs);

    this.timers.set(confirmationId, timer);

    return ok(undefined);
  }

  /**
   * Handle confirmation timeout
   */
  private handleTimeout(confirmationId: string): void {
    const pending = this.pending.get(confirmationId);
    if (!pending) {
      return;
    }

    // Clean up
    this.timers.delete(confirmationId);
    this.pending.delete(confirmationId);

    // Call timeout callback
    this.onTimeout(pending);

    // Reject with timeout error
    pending.reject(new Error("Confirmation request timed out"));
  }

  /**
   * Clean up all resources (call on shutdown)
   * Clears all pending confirmations and timers without rejecting promises
   */
  destroy(): void {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    // Clear pending without rejecting - caller is shutting down
    this.pending.clear();
  }
}

/**
 * Create a ConfirmationGate instance
 */
export function createConfirmationGate(config: ConfirmationGateConfig): ConfirmationGate {
  return new ConfirmationGate(config);
}