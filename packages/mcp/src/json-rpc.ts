/**
 * @navora/mcp
 * JSON-RPC 2.0 request/response handling for MCP protocol.
 *
 * Dependency rules (HARD):
 * - mcp → protocol, shared (never reverse)
 */

import type { Result } from "@navora/shared";
import { err, ok } from "@navora/shared";

// =============================================================================
// JSON-RPC Types
// =============================================================================

/** JSON-RPC 2.0 request */
export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response */
export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JSONRPCError;
}

/** JSON-RPC 2.0 error */
export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC 2.0 error codes */
export enum JSONRPCErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  ServerError = -32000,
  // MCP-specific codes
  ToolNotFound = -32001,
  ResourceNotFound = -32002,
  ToolExecutionError = -32003,
  ResourceAccessError = -32004,
}

// =============================================================================
// JSON-RPC Parser
// =============================================================================

/**
 * Parse a JSON-RPC request from a raw string
 */
export function parseJSONRPCRequest(
  raw: string
): Result<JSONRPCRequest, Error> {
  try {
    const parsed = JSON.parse(raw);

    // Validate JSON-RPC version
    if (parsed.jsonrpc !== "2.0") {
      return err(
        new Error(`Invalid JSON-RPC version: ${parsed.jsonrpc}`)
      );
    }

    // Validate method
    if (typeof parsed.method !== "string" || parsed.method.length === 0) {
      return err(new Error("Invalid method: must be a non-empty string"));
    }

    // Validate id
    if (
      parsed.id !== undefined &&
      typeof parsed.id !== "string" &&
      typeof parsed.id !== "number" &&
      parsed.id !== null
    ) {
      return err(new Error("Invalid id: must be string, number, or null"));
    }

    return ok({
      jsonrpc: "2.0",
      id: parsed.id,
      method: parsed.method,
      params: parsed.params,
    });
  } catch (e) {
    return err(new Error(`Failed to parse JSON-RPC request: ${e}`));
  }
}

/**
 * Parse a JSON-RPC batch request
 */
export function parseJSONRPCBatchRequest(
  raw: string
): Result<JSONRPCRequest[], Error> {
  try {
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return err(new Error("Batch request must be an array"));
    }

    if (parsed.length === 0) {
      return err(new Error("Batch request must not be empty"));
    }

    const requests: JSONRPCRequest[] = [];
    for (const item of parsed) {
      if (item.jsonrpc !== "2.0" || typeof item.method !== "string") {
        return err(new Error("Invalid batch request item"));
      }
      requests.push({
        jsonrpc: "2.0",
        id: item.id,
        method: item.method,
        params: item.params,
      });
    }

    return ok(requests);
  } catch (e) {
    return err(new Error(`Failed to parse JSON-RPC batch request: ${e}`));
  }
}

// =============================================================================
// JSON-RPC Response Builders
// =============================================================================

/**
 * Create a successful JSON-RPC response
 */
export function createJSONRPCSuccessResponse(
  id: string | number | null,
  result: unknown
): JSONRPCResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

/**
 * Create an error JSON-RPC response
 */
export function createJSONRPCErrorResponse(
  id: string | number | null,
  code: JSONRPCErrorCode,
  message: string,
  data?: unknown
): JSONRPCResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

/**
 * Create a parse error response
 */
export function createParseErrorResponse(
  id: string | number | null,
  message: string
): JSONRPCResponse {
  return createJSONRPCErrorResponse(
    id,
    JSONRPCErrorCode.ParseError,
    message
  );
}

/**
 * Create an invalid request error response
 */
export function createInvalidRequestResponse(
  id: string | number | null,
  message: string
): JSONRPCResponse {
  return createJSONRPCErrorResponse(
    id,
    JSONRPCErrorCode.InvalidRequest,
    message
  );
}

/**
 * Create a method not found error response
 */
export function createMethodNotFoundResponse(
  id: string | number | null,
  method: string
): JSONRPCResponse {
  return createJSONRPCErrorResponse(
    id,
    JSONRPCErrorCode.MethodNotFound,
    `Method not found: ${method}`
  );
}

/**
 * Create an invalid params error response
 */
export function createInvalidParamsResponse(
  id: string | number | null,
  message: string
): JSONRPCResponse {
  return createJSONRPCErrorResponse(
    id,
    JSONRPCErrorCode.InvalidParams,
    message
  );
}

/**
 * Create an internal error response
 */
export function createInternalErrorResponse(
  id: string | number | null,
  message: string,
  data?: unknown
): JSONRPCResponse {
  return createJSONRPCErrorResponse(
    id,
    JSONRPCErrorCode.InternalError,
    message,
    data
  );
}

// =============================================================================
// Response Serialization
// =============================================================================

/**
 * Serialize a JSON-RPC response to string
 */
export function serializeJSONRPCResponse(response: JSONRPCResponse): string {
  return JSON.stringify(response);
}

/**
 * Serialize a batch of JSON-RPC responses to string
 */
export function serializeJSONRPCBatchResponse(
  responses: JSONRPCResponse[]
): string {
  return JSON.stringify(responses);
}

/**
 * Create and serialize a JSON-RPC response in one step
 */
export function createResponse(
  id: string | number | null,
  resultOrError: { result: unknown } | { error: JSONRPCError }
): string {
  const response: JSONRPCResponse = {
    jsonrpc: "2.0",
    id,
    ...resultOrError,
  };
  return JSON.stringify(response);
}