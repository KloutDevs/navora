/**
 * Result<T, E> - A discriminated union type for handling success/failure
 * Inspired by Rust's Result and fp-ts
 */

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Create a successful Result
 */
export function ok<T, E = Error>(value: T): Result<T, E> {
  return { ok: true, value };
}

/**
 * Create an error Result
 */
export function err<T, E = Error>(error: E): Result<T, E> {
  return { ok: false, error };
}

/**
 * Type guard to check if Result is Ok
 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok === true;
}

/**
 * Type guard to check if Result is Err
 */
export function isError<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return result.ok === false;
}

/**
 * Map the value of a Result if Ok, otherwise pass through the error
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  if (isOk(result)) {
    return ok(fn(result.value));
  }
  return result;
}

/**
 * Map the error of a Result if Err, otherwise pass through the value
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> {
  if (isError(result)) {
    return err(fn(result.error));
  }
  return result;
}

/**
 * Unwrap the value of a Result, throwing if error
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.value;
  }
  throw result.error;
}

/**
 * Unwrap the error of a Result, throwing if ok
 */
export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (isError(result)) {
    return result.error;
  }
  throw new Error("Called unwrapErr on Ok");
}

/**
 * Get the value or a default
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return isOk(result) ? result.value : defaultValue;
}

/**
 * Get the value or compute it from the error
 */
export function unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
  return isOk(result) ? result.value : fn(result.error);
}

/**
 * Convert a Promise to Result, catching any rejection
 */
export async function fromPromise<T, E = Error>(
  promise: Promise<T>,
  mapRejection?: (reason: unknown) => E
): Promise<Result<T, E>> {
  try {
    const value = await promise;
    return ok(value);
  } catch (error) {
    if (mapRejection) {
      return err(mapRejection(error));
    }
    // When no mapper provided, use Error as default
    const errValue = error instanceof Error ? error : new Error(String(error));
    return err(errValue as E);
  }
}

/**
 * Execute a function that might throw and convert to Result
 */
export function tryCatch<T, E = Error>(
  fn: () => T,
  mapError?: (error: unknown) => E
): Result<T, E> {
  try {
    return ok(fn());
  } catch (error) {
    if (mapError) {
      return err(mapError(error));
    }
    const errValue = error instanceof Error ? error : new Error(String(error));
    return err(errValue as E);
  }
}

/**
 * Execute an async function that might throw and convert to Result
 */
export async function tryCatchAsync<T, E = Error>(
  fn: () => Promise<T>,
  mapError?: (error: unknown) => E
): Promise<Result<T, E>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (error) {
    if (mapError) {
      return err(mapError(error));
    }
    const errValue = error instanceof Error ? error : new Error(String(error));
    return err(errValue as E);
  }
}

/**
 * Flatten a nested Result
 */
export function flatten<T, E>(result: Result<Result<T, E>, E>): Result<T, E> {
  if (isOk(result)) {
    return result.value;
  }
  return result;
}

/**
 * Execute a function that returns a Result and flatten the result
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (isOk(result)) {
    return fn(result.value);
  }
  return result;
}

/**
 * Execute a function that returns a Result only if the first is Ok
 */
export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  return andThen(result, fn);
}