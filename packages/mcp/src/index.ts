/**
 * @ai-browser-runtime/mcp
 * MCP (Model Context Protocol) server implementation.
 *
 * Provides:
 * - Tool registry for registering and managing tools
 * - Resource registry for managing resources
 * - JSON-RPC 2.0 request/response handling
 * - MCPServerBuilder for constructing MCP servers
 *
 * Dependency rules (HARD):
 * - mcp → protocol, shared (never reverse)
 */

// Tool types and registry
export type {
  ToolDefinition,
  ToolInputSchema,
  ToolPropertySchema,
  ToolOutputSchema,
  ToolHandler,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types.js";

export { ToolRegistry } from "./types.js";

// Resource types and registry
export type {
  ResourceDefinition,
  ResourceUriTemplate,
  ResourceMimeType,
  ResourceHandler,
  ResourceContent,
} from "./types.js";

export { ResourceRegistry } from "./types.js";

// JSON-RPC types and handlers
export {
  JSONRPCErrorCode,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCError,
  parseJSONRPCRequest,
  parseJSONRPCBatchRequest,
  createJSONRPCSuccessResponse,
  createJSONRPCErrorResponse,
  createMethodNotFoundResponse,
  createInvalidParamsResponse,
  createInternalErrorResponse,
  serializeJSONRPCResponse,
  serializeJSONRPCBatchResponse,
} from "./json-rpc.js";

// Server builder and server
export {
  MCPServerBuilder,
  MCPServer,
  type MCPServerOptions,
  type MCPServerCapabilities,
  type MCPServerInfo,
  type InitializeResult,
  type ListToolsResult,
  type ListResourcesResult,
} from "./server.js";