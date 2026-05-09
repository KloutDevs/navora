/**
 * Protocol error codes used across NM and WS transports.
 * These map to specific failure scenarios in the browser runtime.
 */
export enum ProtocolErrorCode {
  // Transport errors (1xxx)
  PROTOCOL_PARSE_ERROR = 1000,
  PROTOCOL_VERSION_MISMATCH = 1001,
  PROTOCOL_TIMEOUT = 1002,
  PROTOCOL_CONNECTION_CLOSED = 1003,

  // Bridge errors (2xxx)
  BRIDGE_TIMEOUT = 2000,
  BRIDGE_DISCONNECTED = 2001,
  BRIDGE_MESSAGE_TOO_LARGE = 2002,
  BRIDGE_FRAMING_ERROR = 2003,

  // Session errors (3xxx)
  SESSION_NOT_FOUND = 3000,
  SESSION_LIMIT_REACHED = 3001,
  SESSION_EXPIRED = 3002,
  SESSION_INVALID_TOKEN = 3003,

  // Permission errors (4xxx)
  PERMISSION_DENIED = 4000,
  DOMAIN_NOT_ALLOWED = 4001,
  HUD_TIMEOUT = 4002,
  HUD_DENIED = 4003,

  // Tool execution errors (5xxx)
  TOOL_NOT_FOUND = 5000,
  INVALID_PARAMS = 5001,
  TOOL_TIMEOUT = 5002,
  TOOL_EXECUTION_FAILED = 5003,
  SELECTOR_DRIFT = 5004,

  // Browser context errors (6xxx)
  CONTEXT_CLOSED = 6000,
  CONTEXT_TAB_NOT_FOUND = 6001,
  CONTEXT_NAVIGATION_FAILED = 6002,
  CONTEXT_STALE = 6003,
}

/**
 * Error codes for WebSocket protocol violations and warnings.
 */
export enum WSProtocolError {
  INVALID_JSON = 6000,
  MISSING_METHOD = 6001,
  INVALID_SUBSCRIPTION = 6002,
  RATE_LIMIT_EXCEEDED = 6003,
  AUTHENTICATION_FAILED = 6004,
  UNKNOWN_ERROR = 6005,
}

/**
 * Warning types that don't stop operation but should be logged.
 */
export enum WSProtocolWarning {
  LARGE_PAYLOAD = 7000,
  SLOW_RESPONSE = 7001,
  MISSING_TIMESTAMP = 7002,
  UNSUBSCRIBED_EVENT = 7003,
}