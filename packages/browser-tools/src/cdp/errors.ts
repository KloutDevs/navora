/**
 * CDP error mapping — translates CDP errors to protocol errors.
 * Part of the Bridge layer (FR-NMB).
 */

import { DevToolsProtocolError } from "./client";

/**
 * Structured automation error for CDP failures (distinct from raw
 * {@link DevToolsProtocolError} so tooling can branch on `instanceof CDPError`).
 */
export class CDPError extends Error {
  override readonly name = "CDPError";
  readonly code: number;
  readonly method: string;

  constructor(message: string, code: number, method: string) {
    super(message);
    this.code = code;
    this.method = method;
  }
}

export function isCDPError(e: unknown): e is CDPError {
  return e instanceof CDPError;
}

export function isTransientCDPError(e: unknown): boolean {
  return isCDPError(e) && [-1, -2, -3, -32000].includes(e.code);
}

function mapCdpCodeToError(code: number, method: string, message?: string): CDPError {
  switch (code) {
    case -1: // Not connected
      return new CDPError(`CDP connection error: ${method} — not connected`, code, method);

    case -2: // Timeout
      return new CDPError(`CDP timeout: ${method}`, code, method);

    case -32000: // Target crashed / closed
      return new CDPError(`Context closed: ${method}`, code, method);

    default:
      return new CDPError(
        `CDP error [${code}]: ${method} — ${message ?? "unknown"}`,
        code,
        method
      );
  }
}

/**
 * Maps CDP errors to user-friendly error messages.
 */
export interface CDPErrorMapper {
  (error: unknown): Error;
}

export function createCDPErrorMapper(): CDPErrorMapper {
  return (error: unknown): Error => {
    if (error instanceof DevToolsProtocolError) {
      return mapCdpCodeToError(error.code, error.method, error.message);
    }

    // Plain CDP-shaped objects (tests, serialized errors)
    if (error && typeof error === "object" && "code" in error && "method" in error) {
      const cdp = error as { code: number; method: string; message?: string };
      return mapCdpCodeToError(cdp.code, cdp.method, cdp.message);
    }

    // WebSocket errors
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("timeout") || msg.includes("timed out")) {
        return new CDPError(`CDP timeout: ${error.message}`, -2, "WebSocket");
      }
      if (msg.includes("closed") || msg.includes("disconnected")) {
        return new CDPError(`Context closed: connection lost`, -32000, "WebSocket");
      }
      return error;
    }

    // Unknown
    return new CDPError(`CDP error: ${String(error)}`, -3, "<unknown>");
  };
}

/** Convenience re-export */
export const mapCDPError = createCDPErrorMapper;
