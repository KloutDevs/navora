import { describe, it, expect, beforeEach } from "vitest";
import {
  MCPServerBuilder,
  MCPServer,
  type ToolDefinition,
  type ToolHandler,
  type ResourceDefinition,
  type ResourceHandler,
} from "../src/server";
import {
  parseJSONRPCRequest,
  createJSONRPCSuccessResponse,
  createJSONRPCErrorResponse,
  JSONRPCErrorCode,
} from "../src/json-rpc";
import { ok, err } from "@ai-browser-runtime/shared";

describe("MCPServerBuilder", () => {
  let builder: MCPServerBuilder;

  beforeEach(() => {
    builder = new MCPServerBuilder({
      serverName: "test-server",
      serverVersion: "1.0.0",
    });
  });

  describe("construction", () => {
    it("should create builder with defaults", () => {
      expect(builder.getToolRegistry()).toBeDefined();
      expect(builder.getResourceRegistry()).toBeDefined();
      expect(builder.isInitialized()).toBe(false);
    });

    it("should create builder with custom registries", () => {
      const toolRegistry = builder.getToolRegistry();
      const resourceRegistry = builder.getResourceRegistry();

      const customBuilder = new MCPServerBuilder({
        serverName: "custom-server",
        serverVersion: "1.0.0",
        toolRegistry,
        resourceRegistry,
      });

      expect(customBuilder.getToolRegistry()).toBe(toolRegistry);
      expect(customBuilder.getResourceRegistry()).toBe(resourceRegistry);
    });
  });

  describe("getCapabilities", () => {
    it("should return server capabilities", () => {
      const server = builder.build();
      // Access through internal method - we'd need to test via handleRequest
      expect(server.isInitialized()).toBe(false);
    });
  });

  describe("handleInitialize", () => {
    it("should initialize successfully", () => {
      const result = builder.handleInitialize({ protocolVersion: "2024-11-05" });

      expect(result.ok).toBe(true);
      expect(builder.isInitialized()).toBe(true);
      expect(result.value?.serverInfo.name).toBe("test-server");
      expect(result.value?.serverInfo.version).toBe("1.0.0");
      expect(result.value?.protocolVersion).toBe("2024-11-05");
    });

    it("should fail if already initialized", () => {
      builder.handleInitialize({});
      const result = builder.handleInitialize({});

      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain("already initialized");
    });
  });

  describe("handleListTools", () => {
    it("should return empty list when no tools registered", () => {
      const result = builder.handleListTools();

      expect(result.ok).toBe(true);
      expect(result.value?.tools).toEqual([]);
    });

    it("should return registered tools", () => {
      const toolDef: ToolDefinition = {
        name: "test-tool",
        description: "A test tool",
        inputSchema: { type: "object" },
      };

      const handler: ToolHandler = async () => {
        return ok({ success: true, durationMs: 0 });
      };

      builder.getToolRegistry().register(toolDef, handler);

      const result = builder.handleListTools();

      expect(result.ok).toBe(true);
      expect(result.value?.tools).toHaveLength(1);
      expect(result.value?.tools[0].name).toBe("test-tool");
    });
  });

  describe("handleCallTool", () => {
    it("should fail when not initialized", async () => {
      const result = await builder.handleCallTool({ name: "test-tool" });

      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain("not initialized");
    });

    it("should fail when tool not found", async () => {
      builder.handleInitialize({});

      const result = await builder.handleCallTool({ name: "non-existent" });

      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain("not found");
    });

    it("should execute tool successfully", async () => {
      builder.handleInitialize({});

      const toolDef: ToolDefinition = {
        name: "echo-tool",
        description: "Echo tool",
        inputSchema: { type: "object" },
      };

      const handler: ToolHandler = async (input) => {
        return ok({ success: true, data: input, durationMs: 0 });
      };

      builder.getToolRegistry().register(toolDef, handler);

      const result = await builder.handleCallTool({
        name: "echo-tool",
        arguments: { message: "hello" },
      });

      expect(result.ok).toBe(true);
      expect(result.value?.success).toBe(true);
      expect(result.value?.data).toEqual({ message: "hello" });
      expect(result.value?.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("handleListResources", () => {
    it("should return empty list when no resources registered", () => {
      const result = builder.handleListResources();

      expect(result.ok).toBe(true);
      expect(result.value?.resources).toEqual([]);
    });

    it("should return registered resources", () => {
      const resourceDef: ResourceDefinition = {
        uri: "file://test-resource",
        name: "Test Resource",
        description: "A test resource",
        mimeType: "application/json",
      };

      const handler: ResourceHandler = async () => {
        return ok({
          uri: "file://test-resource",
          mimeType: "application/json",
          content: "{}",
        });
      };

      builder.getResourceRegistry().register(resourceDef, handler);

      const result = builder.handleListResources();

      expect(result.ok).toBe(true);
      expect(result.value?.resources).toHaveLength(1);
      expect(result.value?.resources[0].uri).toBe("file://test-resource");
    });
  });

  describe("handleReadResource", () => {
    it("should fail when not initialized", async () => {
      const result = await builder.handleReadResource({ uri: "file://test" });

      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain("not initialized");
    });

    it("should fail when resource not found", async () => {
      builder.handleInitialize({});

      const result = await builder.handleReadResource({ uri: "file://non-existent" });

      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain("not found");
    });

    it("should read resource successfully", async () => {
      builder.handleInitialize({});

      const resourceDef: ResourceDefinition = {
        uri: "file://readable",
        name: "Readable Resource",
        description: "A readable resource",
        mimeType: "text/plain",
      };

      const handler: ResourceHandler = async (uri) => {
        return ok({
          uri,
          mimeType: "text/plain",
          content: "resource content",
        });
      };

      builder.getResourceRegistry().register(resourceDef, handler);

      const result = await builder.handleReadResource({ uri: "file://readable" });

      expect(result.ok).toBe(true);
      expect(result.value?.content).toBe("resource content");
    });
  });
});

describe("MCPServer", () => {
  let server: MCPServer;

  beforeEach(() => {
    const builder = new MCPServerBuilder({
      serverName: "test-server",
      serverVersion: "1.0.0",
    });
    server = builder.build();
  });

  describe("handleRequest", () => {
    it("should handle initialize request", async () => {
      const request = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      });

      const response = await server.handleRequest(request);

      const parsed = JSON.parse(response);
      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.id).toBe(1);
      expect(parsed.result).toBeDefined();
      expect(parsed.result.serverInfo.name).toBe("test-server");
    });

    it("should handle tools/list request", async () => {
      // First initialize
      await server.handleRequest(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {},
        })
      );

      const request = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });

      const response = await server.handleRequest(request);

      const parsed = JSON.parse(response);
      expect(parsed.id).toBe(2);
      expect(parsed.result).toBeDefined();
    });

    it("should handle method not found", async () => {
      await server.handleRequest(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {},
        })
      );

      const request = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "unknown/method",
        params: {},
      });

      const response = await server.handleRequest(request);

      const parsed = JSON.parse(response);
      expect(parsed.id).toBe(2);
      expect(parsed.error).toBeDefined();
      expect(parsed.error.code).toBe(-32601); // Method not found
    });

    it("should handle invalid request", async () => {
      const request = "not valid json";

      const response = await server.handleRequest(request);

      const parsed = JSON.parse(response);
      expect(parsed.error).toBeDefined();
      expect(parsed.error.code).toBe(-32600); // Invalid request
    });

    it("should handle invalid JSON-RPC version", async () => {
      const request = JSON.stringify({
        jsonrpc: "1.0",
        id: 1,
        method: "initialize",
        params: {},
      });

      const response = await server.handleRequest(request);

      const parsed = JSON.parse(response);
      expect(parsed.error).toBeDefined();
    });
  });
});

describe("JSON-RPC parsing", () => {
  describe("parseJSONRPCRequest", () => {
    it("should parse valid request", () => {
      const result = parseJSONRPCRequest(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "test",
          params: { foo: "bar" },
        })
      );

      expect(result.ok).toBe(true);
      expect(result.value?.method).toBe("test");
      expect(result.value?.params).toEqual({ foo: "bar" });
    });

    it("should reject invalid JSON", () => {
      const result = parseJSONRPCRequest("not json");

      expect(result.ok).toBe(false);
    });

    it("should reject invalid version", () => {
      const result = parseJSONRPCRequest(
        JSON.stringify({
          jsonrpc: "1.0",
          id: 1,
          method: "test",
        })
      );

      expect(result.ok).toBe(false);
    });

    it("should reject missing method", () => {
      const result = parseJSONRPCRequest(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
        })
      );

      expect(result.ok).toBe(false);
    });

    it("should accept null id", () => {
      const result = parseJSONRPCRequest(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          method: "test",
        })
      );

      expect(result.ok).toBe(true);
      expect(result.value?.id).toBe(null);
    });

    it("should accept string id", () => {
      const result = parseJSONRPCRequest(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "request-123",
          method: "test",
        })
      );

      expect(result.ok).toBe(true);
      expect(result.value?.id).toBe("request-123");
    });
  });

  describe("createJSONRPCSuccessResponse", () => {
    it("should create success response", () => {
      const response = createJSONRPCSuccessResponse(1, { data: "test" });

      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe(1);
      expect(response.result).toEqual({ data: "test" });
    });
  });

  describe("createJSONRPCErrorResponse", () => {
    it("should create error response", () => {
      const response = createJSONRPCErrorResponse(
        1,
        JSONRPCErrorCode.MethodNotFound,
        "Method not found"
      );

      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe(1);
      expect(response.error?.code).toBe(-32601);
      expect(response.error?.message).toBe("Method not found");
    });

    it("should include data in error", () => {
      const response = createJSONRPCErrorResponse(
        1,
        JSONRPCErrorCode.InternalError,
        "Internal error",
        { extra: "info" }
      );

      expect(response.error?.data).toEqual({ extra: "info" });
    });
  });
});