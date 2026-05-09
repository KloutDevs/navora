/**
 * Structured Logger with levels, redaction, and timestamps
 */

export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
}

export type LogLevelName = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_NAMES: Record<LogLevel, LogLevelName> = {
  [LogLevel.TRACE]: "trace",
  [LogLevel.DEBUG]: "debug",
  [LogLevel.INFO]: "info",
  [LogLevel.WARN]: "warn",
  [LogLevel.ERROR]: "error",
};

/**
 * Redact sensitive paths from log output
 * Paths like /home/user, C:\Users\xxx, ~/.config are redacted
 */
function redactPath(value: string): string {
  // Windows paths: C:\Users\xxx, C:\Program Files\...
  let redacted = value.replace(
    /([A-Za-z]:\\Users\\)[^\s\\]+/gi,
    "$1[REDACTED]"
  );
  // Unix paths: /home/xxx, /Users/xxx
  redacted = redacted.replace(
    /(\/home\/)[^\s/]+/gi,
    "$1[REDACTED]"
  );
  redacted = redacted.replace(
    /(\/Users\/)[^\s/]+/gi,
    "$1[REDACTED]"
  );
  // Expand ~ to ~/.config patterns
  redacted = redacted.replace(
    /(~\/)[^\s/]+/gi,
    "$1[REDACTED]"
  );
  // Environment variables in paths
  redacted = redacted.replace(
    /(%[A-Z_]+%)[^\s\\]+/gi,
    "$1[REDACTED]"
  );
  return redacted;
}

/**
 * Redact sensitive data in objects
 */
function redactObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    return redactPath(obj);
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactObject);
  }

  if (typeof obj === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact sensitive keys
      const sensitivePatterns = [
        "password",
        "token",
        "authorization",
        "cookie",
        "apiKey",
        "api_key",
        "secret",
        "credential",
        "private",
        "key",
        "session",
      ];
      const isSensitive = sensitivePatterns.some((p) =>
        key.toLowerCase().includes(p)
      );

      if (isSensitive) {
        redacted[key] = "<redacted>";
      } else if (typeof value === "string") {
        redacted[key] = redactPath(value);
      } else {
        redacted[key] = redactObject(value);
      }
    }
    return redacted;
  }

  return obj;
}

export type LogHandler = (level: LogLevelName, args: unknown[]) => void;

export interface LoggerOptions {
  minLevel?: LogLevel;
  context?: Record<string, unknown>;
  timestamp?: boolean;
  prefix?: string;
  /** Optional handler called with each log entry (used for testing output capture) */
  onLog?: LogHandler | undefined;
}

export interface LogEntry {
  level: LogLevelName;
  timestamp: string;
  message: string;
  context?: Record<string, unknown>;
  error?: Error;
}

export interface Logger {
  trace(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void;
  child(options?: LoggerOptions): Logger;
}

/**
 * Create a structured logger instance
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = options.minLevel ?? LogLevel.INFO;
  const baseContext = options.context ?? {};
  const prefix = options.prefix ?? "";
  const includeTimestamp = options.timestamp ?? true;
  const onLog = options.onLog;

  function formatTimestamp(): string {
    return new Date().toISOString();
  }

  function shouldLog(level: LogLevel): boolean {
    return level >= minLevel;
  }

  function log(
    level: LogLevel,
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    if (!shouldLog(level)) {
      return;
    }

    // Build the output
    const parts: string[] = [];
    if (includeTimestamp) {
      parts.push(formatTimestamp());
    }
    parts.push(`[${LEVEL_NAMES[level].toUpperCase()}]`);
    parts.push(prefix ? `${prefix}: ${message}` : message);

    // Redact sensitive data from context
    const mergedContext = { ...baseContext, ...context };
    const redactedContext = Object.keys(mergedContext).length > 0
      ? redactObject(mergedContext)
      : undefined;

    // Determine output stream based on level
    // eslint-disable-next-line no-console
    const consoleObj = globalThis.console;
    const outputFn =
      level >= LogLevel.ERROR
        ? consoleObj.error.bind(consoleObj)
        : level >= LogLevel.WARN
        ? consoleObj.warn.bind(consoleObj)
        : level >= LogLevel.DEBUG
        ? consoleObj.debug.bind(consoleObj)
        : consoleObj.log.bind(consoleObj);

    if (redactedContext && Object.keys(redactedContext).length > 0) {
      // Serialize objects for logging and onLog handler
      const serializedContext = JSON.stringify(redactedContext);
      outputFn(...parts, redactedContext);
      const onLogArgs: unknown[] = [...parts, serializedContext];
      if (error) {
        onLogArgs.push(`Error: ${error.message} ${error.stack ?? ""}`);
      }
      if (onLog) onLog(LEVEL_NAMES[level], onLogArgs);
    } else {
      outputFn(...parts);
      const onLogArgs: unknown[] = [...parts];
      if (error) {
        onLogArgs.push(`Error: ${error.message} ${error.stack ?? ""}`);
      }
      if (onLog) onLog(LEVEL_NAMES[level], onLogArgs);
    }

    // Console output for error (separate call as per original behavior)
    if (error) {
      outputFn("Error:", error.message, error.stack);
    }
  }

  function createChild(childOptions: LoggerOptions = {}): Logger {
    const childContext = { ...baseContext, ...childOptions.context };
    return createLogger({
      minLevel: childOptions.minLevel ?? minLevel,
      context: childContext,
      timestamp: childOptions.timestamp ?? includeTimestamp,
      prefix: childOptions.prefix
        ? prefix
          ? `${prefix}: ${childOptions.prefix}`
          : childOptions.prefix
        : prefix,
      onLog: childOptions.onLog ?? onLog,
    });
  }

  return {
    trace(message: string, context?: Record<string, unknown>) {
      log(LogLevel.TRACE, message, undefined, context);
    },
    debug(message: string, context?: Record<string, unknown>) {
      log(LogLevel.DEBUG, message, undefined, context);
    },
    info(message: string, context?: Record<string, unknown>) {
      log(LogLevel.INFO, message, undefined, context);
    },
    warn(message: string, context?: Record<string, unknown>) {
      log(LogLevel.WARN, message, undefined, context);
    },
    error(message: string, error?: Error, context?: Record<string, unknown>) {
      log(LogLevel.ERROR, message, error, context);
    },
    child: createChild,
  };
}

// Default logger instance
export const logger = createLogger();