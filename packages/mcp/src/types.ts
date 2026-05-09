/**
 * @ai-browser-runtime/mcp
 * MCP (Model Context Protocol) types for tool and resource registration.
 *
 * Dependency rules (HARD):
 * - mcp → protocol, shared (never reverse)
 */

import type { Result } from "@ai-browser-runtime/shared";

// =============================================================================
// Tool Types
// =============================================================================

/** Input schema for a tool (JSON Schema-like) */
export interface ToolInputSchema {
  type: "object";
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

/** Property schema within tool input */
export interface ToolPropertySchema {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

/** Output schema for a tool result */
export interface ToolOutputSchema {
  type: "object" | "string" | "number" | "boolean" | "array";
  properties?: Record<string, ToolPropertySchema>;
}

/** Tool definition - describes a callable tool */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  /** Unique tool name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Input validation schema */
  inputSchema: ToolInputSchema;
  /** Output schema */
  outputSchema?: ToolOutputSchema;
  /** Whether this tool requires user confirmation (dangerous/mutating) */
  requiresConfirmation?: boolean;
  /** Categories for UI display */
  tags?: string[];
}

/** Result from tool execution */
export interface ToolExecutionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  durationMs: number;
}

/** Handler function for a tool */
export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ToolExecutionContext
) => Promise<Result<ToolExecutionResult<TOutput>, Error>>;

/** Context passed to tool handlers */
export interface ToolExecutionContext {
  /** Session ID for the request */
  sessionId: string;
  /** Request ID for tracing */
  requestId: string;
  /** Timestamp when request started */
  timestamp: number;
  /** Additional context from the MCP request */
  meta?: Record<string, unknown>;
}

// =============================================================================
// Tool Registry
// =============================================================================

/** Tool registry for managing available tools */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private handlers: Map<string, ToolHandler> = new Map();

  /**
   * Register a tool with its handler
   */
  register<TInput = unknown, TOutput = unknown>(
    definition: ToolDefinition<TInput, TOutput>,
    handler: ToolHandler<TInput, TOutput>
  ): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool '${definition.name}' is already registered`);
    }
    this.tools.set(definition.name, definition);
    this.handlers.set(definition.name, handler as ToolHandler);
  }

  /**
   * Get a tool definition by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get a tool handler by name
   */
  getHandler(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  /**
   * Check if a tool is registered
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    const toolExists = this.tools.has(name);
    this.tools.delete(name);
    this.handlers.delete(name);
    return toolExists;
  }

  /**
   * Get the number of registered tools
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
    this.handlers.clear();
  }

  /**
   * List all tool names
   */
  listNames(): string[] {
    return Array.from(this.tools.keys());
  }
}

// =============================================================================
// Resource Types
// =============================================================================

/** Resource URI template */
export interface ResourceUriTemplate {
  /** URI template pattern (e.g., "file://{filename}") */
  template: string;
  /** List of variable names in the template */
  variables: string[];
}

/** MIME type for resource content */
export type ResourceMimeType =
  | "application/json"
  | "text/plain"
  | "text/html"
  | "application/octet-stream";

/** Resource definition - describes an available resource */
export interface ResourceDefinition {
  /** Unique resource URI */
  uri: string;
  /** Human-readable name */
  name: string;
  /** Description of what this resource provides */
  description: string;
  /** MIME type of the resource */
  mimeType: ResourceMimeType;
  /** Whether this resource can be listed */
  traversable?: boolean;
  /** URI templates for dynamic resource access */
  uriTemplate?: ResourceUriTemplate;
}

/** Resource content result */
export interface ResourceContent {
  uri: string;
  mimeType: ResourceMimeType;
  content: string;
  /** Timestamp when resource was last modified */
  lastModified?: number;
}

/** Handler function for reading a resource */
export type ResourceHandler = (
  uri: string,
  context: ToolExecutionContext
) => Promise<Result<ResourceContent, Error>>;

// =============================================================================
// Resource Registry
// =============================================================================

/** Resource registry for managing available resources */
export class ResourceRegistry {
  private resources: Map<string, ResourceDefinition> = new Map();
  private handlers: Map<string, ResourceHandler> = new Map();

  /**
   * Register a resource with its handler
   */
  register(definition: ResourceDefinition, handler: ResourceHandler): void {
    if (this.resources.has(definition.uri)) {
      throw new Error(`Resource '${definition.uri}' is already registered`);
    }
    this.resources.set(definition.uri, definition);
    this.handlers.set(definition.uri, handler);
  }

  /**
   * Get a resource definition by URI
   */
  get(uri: string): ResourceDefinition | undefined {
    return this.resources.get(uri);
  }

  /**
   * Get all registered resources
   */
  getAll(): ResourceDefinition[] {
    return Array.from(this.resources.values());
  }

  /**
   * Get a resource handler by URI
   */
  getHandler(uri: string): ResourceHandler | undefined {
    return this.handlers.get(uri);
  }

  /**
   * Check if a resource is registered
   */
  has(uri: string): boolean {
    return this.resources.has(uri);
  }

  /**
   * Unregister a resource
   */
  unregister(uri: string): boolean {
    const resourceExists = this.resources.has(uri);
    this.resources.delete(uri);
    this.handlers.delete(uri);
    return resourceExists;
  }

  /**
   * Get the number of registered resources
   */
  size(): number {
    return this.resources.size;
  }

  /**
   * Clear all registered resources
   */
  clear(): void {
    this.resources.clear();
    this.handlers.clear();
  }

  /**
   * List all resource URIs
   */
  listUris(): string[] {
    return Array.from(this.resources.keys());
  }

  /**
   * List all traversable (listable) resources
   */
  listTraversable(): ResourceDefinition[] {
    return Array.from(this.resources.values()).filter(
      (r) => r.traversable === true
    );
  }
}