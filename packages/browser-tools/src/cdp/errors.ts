/**
 * CDP error mapping — translates CDP errors to protocol errors.
 * Part of the Bridge layer (FR-NMB).
 */

import type { DevToolsProtocolError } from "./client";

/**
 * Maps CDP errors to user-friendly error messages.
 */
export interface CDPErrorMapper {
  (error: unknown): Error;
}

export function createCDPErrorMapper(): CDPErrorMapper {
  return (error: unknown): Error => {
    // DevToolsProtocolError from our CDP client
    if (error && typeof error === "object" && "code" in error && "method" in error) {
      const cdp = error as { code: number; method: string; message?: string };

      // Map common CDP error codes to human-readable messages
      switch (cdp.code) {
        case -1: // Not connected
          return new Error(`CDP connection error: ${cdp.method} — not connected`);

        case -2: // Timeout
          return new Error(`CDP timeout: ${cdp.method}`);

        case -32000: // Target crashed / closed
          return new Error(`Context closed: ${cdp.method}`);

        default:
          return new Error(`CDP error [${cdp.code}]: ${cdp.method} — ${cdp.message ?? "unknown"}`);
      }
    }

    // WebSocket errors
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("timeout") || msg.includes("timed out")) {
        return new Error(`CDP timeout: ${error.message}`);
      }
      if (msg.includes("closed") || msg.includes("disconnected")) {
        return new Error(`Context closed: connection lost`);
      }
      return error;
    }

    // Unknown
    return new Error(`CDP error: ${String(error)}`);
  };
}

/** Convenience re-export */
export const mapCDPError = createCDPErrorMapper;