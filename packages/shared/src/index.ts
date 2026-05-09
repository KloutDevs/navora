/**
 * @ai-browser-runtime/shared
 * Shared utilities for the AI Browser Runtime ecosystem
 */

// Result type - discriminated union for success/failure handling
export {
  type Result,
  ok,
  err,
  isOk,
  isError,
  map,
  mapErr,
  unwrap,
  unwrapErr,
  unwrapOr,
  unwrapOrElse,
  fromPromise,
  tryCatch,
  tryCatchAsync,
  flatten,
  andThen,
  flatMap,
} from "./Result";

// Logger - structured logging with levels and redaction
export {
  LogLevel,
  type LogLevelName,
  type LoggerOptions,
  type LogEntry,
  type Logger,
  createLogger,
  logger,
} from "./Logger";

// Redaction - sensitive data handling
export {
  redact,
  redactKeys,
  redactPath,
  containsSensitiveData,
  type RedactOptions,
} from "./redact";

// ULID - lexicographically sortable unique identifiers
export {
  generate,
  fromTimestamp,
  monotonic,
  resetMonotonic,
  parse,
  isValid,
  getTimestamp,
  compare,
  sort,
  isAfter,
  isBefore,
  type ULID,
  isULID,
  ulid,
  type ULIDParts,
} from "./ulid";

// Re-export zod for validation helpers (shared can use zod at package boundary)
export { z } from "zod";