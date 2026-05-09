/**
 * @navora/mcp
 * MCP Server Builder - constructs an MCP server with tools and resources.
 *
 * Dependency rules (HARD):
 * - mcp → protocol, shared (never reverse)
 */

import type {
  ToolRegistry,
  ResourceRegistry,
  ToolExecutionContext,
  ToolDefinition,
  ResourceDefinition,
} from "./types.js";
import {
  ToolRegistry as ToolRegistryImpl,
  ResourceRegistry as ResourceRegistryImpl,
} from "./types.js";
import type { Result } from "@navora/shared";
import {
  createJSONRPCSuccessResponse,
  createMethodNotFoundResponse,
  createInvalidParamsResponse,
  createInternalErrorResponse,
  createInvalidRequestResponse,
  JSONRPCErrorCode,
  serializeJSONRPCResponse,
  serializeJSONRPCBatchResponse,
  parseJSONRPCRequest,
  type JSONRPCRequest,
  type JSONRPCResponse,
} from "./json-rpc.js";
import { err, ok } from "@navora/shared";
import { generate } from "@navora/shared";
import type { Logger } from "@navora/shared";

// =============================================================================
// MCP Server Methods
// =============================================================================

/** Capabilities exposed by the MCP server */
export interface MCPServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
}

/** Server info */
export interface MCPServerInfo {
  name: string;
  version: string;
  capabilities?: MCPServerCapabilities;
}

/** Initialize result */
export interface InitializeResult {
  protocolVersion: string;
  serverInfo: MCPServerInfo;
  capabilities: MCPServerCapabilities;
}

/** List tools result */
export interface ListToolsResult {
  tools: ToolDefinition[];
}

/** List resources result */
export interface ListResourcesResult {
  resources: ResourceDefinition[];
}

// =============================================================================
// MCP Server Builder
// =============================================================================

/** Options for creating an MCP server */
export interface MCPServerOptions {
  /** Server name */
  serverName: string;
  /** Server version */
  serverVersion: string;
  /** Logger instance */
  logger?: Logger;
  /** Default session timeout in ms */
  defaultSessionTimeout?: number;
  /** Custom tool registry (defaults to internal) */
  toolRegistry?: ToolRegistry;
  /** Custom resource registry (defaults to internal) */
  resourceRegistry?: ResourceRegistry;
}

/**
 * MCPServerBuilder - constructs an MCP server with tools and resources.
 *
 * The MCP server follows the JSON-RPC 2.0 protocol and supports:
 * - initialize: Server capability negotiation
 * - tools/list: List available tools
 * - tools/call: Execute a tool
 * - resources/list: List available resources
 * - resources/read: Read a resource
 */
export class MCPServerBuilder {
  private readonly options: Required<MCPServerOptions>;
  private toolRegistry: ToolRegistry;
  private resourceRegistry: ResourceRegistry;
  private initialized = false;
  private protocolVersion = "2024-11-05";

  constructor(options: MCPServerOptions) {
    this.options = {
      serverName: options.serverName,
      serverVersion: options.serverVersion,
      logger: options.logger ?? createDefaultLogger(),
      defaultSessionTimeout: options.defaultSessionTimeout ?? 60000,
      toolRegistry: options.toolRegistry ?? new ToolRegistryImpl(),
      resourceRegistry: options.resourceRegistry ?? new ResourceRegistryImpl(),
    };
    this.toolRegistry = this.options.toolRegistry;
    this.resourceRegistry = this.options.resourceRegistry;
  }

  /**
   * Get the tool registry for registering tools
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Get the resource registry for registering resources
   */
  getResourceRegistry(): ResourceRegistry {
    return this.resourceRegistry;
  }

  /**
   * Set a custom tool registry
   */
  setToolRegistry(registry: ToolRegistry): this {
    this.toolRegistry = registry;
    return this;
  }

  /**
   * Set a custom resource registry
   */
  setResourceRegistry(registry: ResourceRegistry): this {
    this.resourceRegistry = registry;
    return this;
  }

  /**
   * Set the protocol version to use
   */
  setProtocolVersion(version: string): this {
    this.protocolVersion = version;
    return this;
  }

  /**
   * Build the server - mark as ready
   */
  build(): MCPServer {
    return new MCPServer(this);
  }

  /**
   * Internal: Get server capabilities
   */
  getCapabilities(): MCPServerCapabilities {
    return {
      tools: {
        listChanged: false,
      },
      resources: {
        subscribe: false,
        listChanged: false,
      },
    };
  }

  /**
   * Internal: Get server info
   */
  getServerInfo(): MCPServerInfo {
    return {
      name: this.options.serverName,
      version: this.options.serverVersion,
      capabilities: this.getCapabilities(),
    };
  }

  /**
   * Internal: Handle initialization
   */
  handleInitialize(
    params: Record<string, unknown>
  ): Result<InitializeResult, Error> {
    if (this.initialized) {
      return err(new Error("Server already initialized"));
    }

    // Extract protocol version from client if provided
    if (params["protocolVersion"] && typeof params["protocolVersion"] === "string") {
      this.options.logger.debug(
        `Client protocol version: ${params["protocolVersion"]}`
      );
    }

    this.initialized = true;

    return ok({
      protocolVersion: this.protocolVersion,
      serverInfo: this.getServerInfo(),
      capabilities: this.getCapabilities(),
    });
  }

  /**
   * Internal: Handle tools/list
   */
  handleListTools(): Result<ListToolsResult, Error> {
    return ok({
      tools: this.toolRegistry.getAll(),
    });
  }

  /**
   * Internal: Handle tools/call
   */
  async handleCallTool(
    params: Record<string, unknown>
  ): Promise<Result<unknown, Error>> {
    if (!this.initialized) {
      return err(new Error("Server not initialized"));
    }

    const name = params["name"];
    if (typeof name !== "string") {
      return err(new Error("Invalid params: 'name' is required"));
    }

    const handler = this.toolRegistry.getHandler(name);
    if (!handler) {
      return err(new Error(`Tool not found: ${name}`));
    }

    const input = params["arguments"] ?? {};
    const metaVal = params["meta"];
    const meta: Record<string, unknown> =
      typeof metaVal === "object" && metaVal !== null
        ? (metaVal as Record<string, unknown>)
        : {};
    const context: ToolExecutionContext = {
      sessionId: (params["sessionId"] as string) ?? generate(),
      requestId: generate(),
      timestamp: Date.now(),
      meta,
    };

    const startTime = Date.now();
    const result = await handler(input, context);
    const durationMs = Date.now() - startTime;

    if (result.ok) {
      return ok({
        ...result.value,
        durationMs,
      });
    } else {
      return err(result.error);
    }
  }

  /**
   * Internal: Handle resources/list
   */
  handleListResources(): Result<ListResourcesResult, Error> {
    return ok({
      resources: this.resourceRegistry.getAll(),
    });
  }

  /**
   * Internal: Handle resources/read
   */
  async handleReadResource(
    params: Record<string, unknown>
  ): Promise<Result<unknown, Error>> {
    if (!this.initialized) {
      return err(new Error("Server not initialized"));
    }

    const uri = params["uri"];
    if (typeof uri !== "string") {
      return err(new Error("Invalid params: 'uri' is required"));
    }

    const handler = this.resourceRegistry.getHandler(uri);
    if (!handler) {
      return err(new Error(`Resource not found: ${uri}`));
    }

    const sessionId = params["sessionId"] as string | undefined;
    const metaVal = params["meta"];
    const meta: Record<string, unknown> =
      typeof metaVal === "object" && metaVal !== null
        ? (metaVal as Record<string, unknown>)
        : {};
    const context: ToolExecutionContext = {
      sessionId: sessionId ?? generate(),
      requestId: generate(),
      timestamp: Date.now(),
      meta,
    };

    const result = await handler(uri, context);

    if (result.ok) {
      return ok(result.value);
    } else {
      return err(result.error);
    }
  }

  /**
   * Check if server is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// =============================================================================
// MCP Server (handle requests)
// =============================================================================

/**
 * MCP Server - handles incoming JSON-RPC requests
 */
export class MCPServer {
  private readonly builder: MCPServerBuilder;

  constructor(builder: MCPServerBuilder) {
    this.builder = builder;
  }

  /**
   * Handle an incoming JSON-RPC request
   */
  async handleRequest(rawRequest: string): Promise<string> {
    const parseResult = parseJSONRPCRequest(rawRequest);

    if (!parseResult.ok) {
      const response = createInvalidRequestResponse(
        null,
        parseResult.error.message
      );
      return serializeJSONRPCResponse(response);
    }

    const request = parseResult.value;
    return this.handleParsedRequest(request);
  }

  /**
   * Handle a parsed JSON-RPC request
   */
  async handleParsedRequest(request: JSONRPCRequest): Promise<string> {
    const { method, id } = request;
    const params = request.params ?? {};

    try {
      switch (method) {
        case "initialize":
          return this.handleMethod(id, async () => {
            const result = this.builder.handleInitialize(params);
            if (!result.ok) {
              return createInternalErrorResponse(id, result.error.message);
            }
            return createJSONRPCSuccessResponse(id, result.value);
          });

        case "tools/list":
          return this.handleMethod(id, async () => {
            const result = this.builder.handleListTools();
            if (!result.ok) {
              return createInternalErrorResponse(id, result.error.message);
            }
            return createJSONRPCSuccessResponse(id, result.value);
          });

        case "tools/call":
          return this.handleMethod(id, async () => {
            const result = await this.builder.handleCallTool(params);
            if (!result.ok) {
              return createInternalErrorResponse(
                id,
                result.error.message,
                { code: JSONRPCErrorCode.ToolExecutionError }
              );
            }
            return createJSONRPCSuccessResponse(id, result.value);
          });

        case "resources/list":
          return this.handleMethod(id, async () => {
            const result = this.builder.handleListResources();
            if (!result.ok) {
              return createInternalErrorResponse(id, result.error.message);
            }
            return createJSONRPCSuccessResponse(id, result.value);
          });

        case "resources/read":
          return this.handleMethod(id, async () => {
            const result = await this.builder.handleReadResource(params);
            if (!result.ok) {
              return createInternalErrorResponse(
                id,
                result.error.message,
                { code: JSONRPCErrorCode.ResourceAccessError }
              );
            }
            return createJSONRPCSuccessResponse(id, result.value);
          });

        default:
          return serializeJSONRPCResponse(createMethodNotFoundResponse(id, method));
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      return serializeJSONRPCResponse(createInternalErrorResponse(id, errorMessage));
    }
  }

  /**
   * Handle a method with error catching
   */
  private async handleMethod(
    id: string | number | null,
    handler: () => Promise<JSONRPCResponse>
  ): Promise<string> {
    try {
      const response = await handler();
      return serializeJSONRPCResponse(response);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      return serializeJSONRPCResponse(
        createInternalErrorResponse(id, errorMessage)
      );
    }
  }

  /**
   * Get the tool registry
   */
  getToolRegistry(): ToolRegistry {
    return this.builder.getToolRegistry();
  }

  /**
   * Get the resource registry
   */
  getResourceRegistry(): ResourceRegistry {
    return this.builder.getResourceRegistry();
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.builder.isInitialized();
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Create a simple default logger */
function createDefaultLogger(): Logger {
  return {
    trace: () => {},
    debug: console.log,
    info: console.log,
    warn: console.warn,
    error: console.error,
    child: () => createDefaultLogger(),
  };
}

// Re-export types and functions
export {
  parseJSONRPCRequest,
  parseJSONRPCBatchRequest,
  createJSONRPCSuccessResponse,
  createJSONRPCErrorResponse,
  JSONRPCErrorCode,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCError,
} from "./json-rpc.js";

export type {
  ToolDefinition,
  ToolHandler,
  ToolExecutionContext,
  ToolExecutionResult,
  ResourceDefinition,
  ResourceHandler,
  ResourceContent,
  ToolRegistry,
  ResourceRegistry,
  ToolInputSchema,
  ToolOutputSchema,
} from "./types.js";