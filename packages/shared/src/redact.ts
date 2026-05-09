/**
 * Redact sensitive keys from objects using deep scanning
 * Pattern-based redaction for URLs, emails, and strings
 */

/**
 * Default sensitive keys that should be redacted
 */
const DEFAULT_SENSITIVE_KEYS = [
  "password",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "secret",
  "credential",
  "private_key",
  "access_token",
  "refresh_token",
  "session_id",
  "auth",
  "pwd",
];

/**
 * Default patterns that should be redacted in strings
 */
const DEFAULT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  // URLs with potential tokens
  { pattern: /(https?:\/\/[^\s]+(?:token|key|auth)[^\s]*)/gi, replacement: "[URL]" },
  // Bearer tokens
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: "Bearer [TOKEN]" },
  // AWS keys (20 char alphanumeric)
  { pattern: /\b[A-Z0-9]{20}\b/g, replacement: "[AWS_KEY]" },
  // Generic UUID-like tokens (after "token=", "key=", etc.)
  { pattern: /(token|key|auth|secret)=([a-zA-Z0-9\-_]{20,})/gi, replacement: "$1=[TOKEN]" },
];

export interface RedactOptions {
  /** Keys to treat as sensitive (case-insensitive partial match) */
  sensitiveKeys?: string[];
  /** Custom patterns to redact */
  patterns?: Array<{ pattern: RegExp; replacement: string }>;
  /** Maximum depth to traverse (default: 10) */
  maxDepth?: number;
  /** Whether to redact array items */
  redactArrays?: boolean;
  /** Placeholder for redacted values */
  placeholder?: string;
}

/**
 * Check if a key should be treated as sensitive
 */
function isSensitiveKey(key: string, sensitiveKeys: string[]): boolean {
  const lowerKey = key.toLowerCase();
  return sensitiveKeys.some((sensitive) =>
    lowerKey.includes(sensitive.toLowerCase())
  );
}

/**
 * Redact patterns from a string value
 */
function redactStringPatterns(
  value: string,
  patterns: Array<{ pattern: RegExp; replacement: string }>
): string {
  let result = value;
  for (const { pattern, replacement } of patterns) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Deep scan and redact an object
 */
export function redact(
  input: unknown,
  options: RedactOptions = {}
): unknown {
  const {
    sensitiveKeys = DEFAULT_SENSITIVE_KEYS,
    patterns = DEFAULT_PATTERNS,
    maxDepth = 10,
    redactArrays = true,
    placeholder = "<redacted>",
  } = options;

  function scan(value: unknown, depth: number): unknown {
    // Stop at max depth to prevent infinite recursion
    if (depth > maxDepth) {
      return value;
    }

    // Primitives
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value !== "object") {
      return value;
    }

    // Arrays
    if (Array.isArray(value)) {
      if (!redactArrays) {
        return value;
      }
      return value.map((item) => scan(item, depth + 1));
    }

    // Plain object — scan each key recursively
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(value as object)) {
      const val = (value as Record<string, unknown>)[key];

      if (isSensitiveKey(key, sensitiveKeys)) {
        result[key] = placeholder;
      } else if (typeof val === "object" && val !== null) {
        result[key] = scan(val, depth + 1);
      } else if (typeof val === "string") {
        result[key] = redactStringPatterns(val, patterns);
      } else {
        result[key] = val;
      }
    }

    return result;
  }

  return scan(input, 0);
}

/**
 * Redact a specific set of keys from an object (shallow redaction)
 */
export function redactKeys(
  input: Record<string, unknown>,
  keys: string[],
  placeholder: string = "<redacted>"
): Record<string, unknown> {
  const result = { ...input };

  for (const key of keys) {
    if (key in result) {
      result[key] = placeholder;
    }
  }

  return result;
}

/**
 * Redact a specific path in a nested object (e.g., "user.token")
 */
export function redactPath(
  input: unknown,
  path: string,
  placeholder: string = "<redacted>"
): unknown {
  const parts = path.split(".");

  if (parts.length === 0) {
    return input;
  }

  if (typeof input !== "object" || input === null) {
    return input;
  }

  const result = Array.isArray(input) ? [...input] : { ...input };

  if (parts.length === 0) {
    return result;
  }

  const firstKey = parts[0]!;
  const remainingPath = parts.slice(1).join(".");

  if (parts.length === 1) {
    if (firstKey in result) {
      (result as Record<string, unknown>)[firstKey] = placeholder;
    }
    return result;
  }

  const child = (result as Record<string, unknown>)[firstKey];
  if (typeof child === "object" && child !== null) {
    (result as Record<string, unknown>)[firstKey] = redactPath(
      child,
      remainingPath,
      placeholder
    );
  }

  return result;
}

/**
 * Check if a string contains any sensitive patterns
 */
export function containsSensitiveData(
  value: string,
  patterns: Array<{ pattern: RegExp; replacement: string }> = DEFAULT_PATTERNS
): boolean {
  return patterns.some(({ pattern }) => pattern.test(value));
}