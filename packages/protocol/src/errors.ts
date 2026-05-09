import { ProtocolErrorCode } from './error-codes.js';

/**
 * Custom error class for protocol-level errors.
 * Provides structured error information for debugging and logging.
 */
export class ProtocolError extends Error {
  public readonly code: ProtocolErrorCode;
  public readonly details: Record<string, unknown> | undefined;
  public readonly recoverable: boolean;
  public readonly timestamp: number;

  constructor(
    code: ProtocolErrorCode,
    message: string,
    options?: {
      details?: Record<string, unknown>;
      recoverable?: boolean;
      cause?: Error;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = 'ProtocolError';
    this.code = code;
    this.details = options?.details ?? undefined;
    this.recoverable = options?.recoverable ?? false;
    this.timestamp = Date.now();

    // Maintains proper stack trace for where error was thrown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (globalThis as any).Error?.captureStackTrace === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Error.captureStackTrace(this, ProtocolError);
    }
  }

  /**
   * Check if this is a session-related error.
   */
  isSessionError(): boolean {
    return this.code >= 3000 && this.code < 4000;
  }

  /**
   * Check if this is a permission-related error.
   */
  isPermissionError(): boolean {
    return this.code >= 4000 && this.code < 5000;
  }

  /**
   * Check if this is a tool execution error.
   */
  isToolError(): boolean {
    return this.code >= 5000 && this.code < 6000;
  }

  /**
   * Serialize to a plain object for JSON serialization.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      recoverable: this.recoverable,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

/**
 * Factory function to create common protocol errors.
 */
export function createProtocolError(
  code: ProtocolErrorCode,
  message: string,
  recoverable?: boolean
): ProtocolError {
  return new ProtocolError(code, message, { recoverable: recoverable ?? false });
}