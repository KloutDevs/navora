import { describe, it, expect, beforeEach } from "vitest";
import {
  ToolRegistry,
  type ToolDefinition,
  type ToolHandler,
  type ToolExecutionContext,
} from "../src/types";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("register", () => {
    it("should register a tool with handler", () => {
      const toolDef: ToolDefinition = {
        name: "test-tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: {
            input: { type: "string", description: "Test input" },
          },
          required: ["input"],
        },
      };

      const handler: ToolHandler = async (input, context) => {
        return { ok: true, value: { success: true, data: input, durationMs: 0 } };
      };

      registry.register(toolDef, handler);

      expect(registry.size()).toBe(1);
      expect(registry.has("test-tool")).toBe(true);
    });

    it("should throw when registering duplicate tool", () => {
      const toolDef: ToolDefinition = {
        name: "duplicate-tool",
        description: "A tool",
        inputSchema: { type: "object" },
      };

      const handler: ToolHandler = async () => {
        return { ok: true, value: { success: true, durationMs: 0 } };
      };

      registry.register(toolDef, handler);

      expect(() => registry.register(toolDef, handler)).toThrow(
        "Tool 'duplicate-tool' is already registered"
      );
    });

    it("should store tool definition and handler separately", () => {
      const toolDef: ToolDefinition = {
        name: "stored-tool",
        description: "A stored tool",
        inputSchema: { type: "object" },
        tags: ["browser", "automation"],
      };

      const handler: ToolHandler = async () => {
        return { ok: true, value: { success: true, durationMs: 0 } };
      };

      registry.register(toolDef, handler);

      const stored = registry.get("stored-tool");
      expect(stored?.name).toBe("stored-tool");
      expect(stored?.tags).toEqual(["browser", "automation"]);

      const storedHandler = registry.getHandler("stored-tool");
      expect(storedHandler).toBe(handler);
    });
  });

  describe("get", () => {
    it("should return undefined for non-existent tool", () => {
      expect(registry.get("non-existent")).toBeUndefined();
    });

    it("should return registered tool", () => {
      const toolDef: ToolDefinition = {
        name: "get-tool",
        description: "Tool to get",
        inputSchema: { type: "object" },
      };

      const handler: ToolHandler = async () => {
        return { ok: true, value: { success: true, durationMs: 0 } };
      };

      registry.register(toolDef, handler);

      const retrieved = registry.get("get-tool");
      expect(retrieved?.name).toBe("get-tool");
      expect(retrieved?.description).toBe("Tool to get");
    });
  });

  describe("getAll", () => {
    it("should return empty array when empty", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("should return all registered tools", () => {
      const tool1: ToolDefinition = {
        name: "tool-1",
        description: "First tool",
        inputSchema: { type: "object" },
      };
      const tool2: ToolDefinition = {
        name: "tool-2",
        description: "Second tool",
        inputSchema: { type: "object" },
      };

      const handler: ToolHandler = async () => {
        return { ok: true, value: { success: true, durationMs: 0 } };
      };

      registry.register(tool1, handler);
      registry.register(tool2, handler);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((t) => t.name).sort()).toEqual(["tool-1", "tool-2"]);
    });
  });

  describe("getHandler", () => {
    it("should return undefined for non-existent handler", () => {
      expect(registry.getHandler("non-existent")).toBeUndefined();
    });

    it("should return registered handler", () => {
      const toolDef: ToolDefinition = {
        name: "handler-tool",
        description: "Tool with handler",
        inputSchema: { type: "object" },
      };

      const handler: ToolHandler = async (input, context) => {
        return { ok: true, value: { success: true, data: input, durationMs: 0 } };
      };

      registry.register(toolDef, handler);

      const retrievedHandler = registry.getHandler("handler-tool");
      expect(retrievedHandler).toBe(handler);
    });
  });

  describe("has", () => {
    it("should return false for non-existent tool", () => {
      expect(registry.has("non-existent")).toBe(false);
    });

    it("should return true for registered tool", () => {
      const toolDef: ToolDefinition = {
        name: "has-tool",
        description: "Tool that exists",
        inputSchema: { type: "object" },
      };

      const handler: ToolHandler = async () => {
        return { ok: true, value: { success: true, durationMs: 0 } };
      };

      registry.register(toolDef, handler);

      expect(registry.has("has-tool")).toBe(true);
    });
  });

  describe("unregister", () => {
    it("should return false for non-existent tool", () => {
      expect(registry.unregister("non-existent")).toBe(false);
    });

    it("should remove tool and return true", () => {
      const toolDef: ToolDefinition = {
        name: "remove-tool",
        description: "Tool to remove",
        inputSchema: { type: "object" },
      };

      const handler: ToolHandler = async () => {
        return { ok: true, value: { success: true, durationMs: 0 } };
      };

      registry.register(toolDef, handler);
      expect(registry.has("remove-tool")).toBe(true);

      const result = registry.unregister("remove-tool");
      expect(result).toBe(true);
      expect(registry.has("remove-tool")).toBe(false);
      expect(registry.size()).toBe(0);
    });
  });

  describe("size", () => {
    it("should return 0 for empty registry", () => {
      expect(registry.size()).toBe(0);
    });

    it("should return count of registered tools", () => {
      const tool1: ToolDefinition = { name: "size-1", description: "T1", inputSchema: { type: "object" } };
      const tool2: ToolDefinition = { name: "size-2", description: "T2", inputSchema: { type: "object" } };
      const tool3: ToolDefinition = { name: "size-3", description: "T3", inputSchema: { type: "object" } };

      const handler: ToolHandler = async () => {
        return { ok: true, value: { success: true, durationMs: 0 } };
      };

      registry.register(tool1, handler);
      registry.register(tool2, handler);
      registry.register(tool3, handler);

      expect(registry.size()).toBe(3);
    });
  });

  describe("clear", () => {
    it("should remove all tools", () => {
      const tool1: ToolDefinition = { name: "clear-1", description: "T1", inputSchema: { type: "object" } };
      const tool2: ToolDefinition = { name: "clear-2", description: "T2", inputSchema: { type: "object" } };

      const handler: ToolHandler = async () => {
        return { ok: true, value: { success: true, durationMs: 0 } };
      };

      registry.register(tool1, handler);
      registry.register(tool2, handler);
      expect(registry.size()).toBe(2);

      registry.clear();

      expect(registry.size()).toBe(0);
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe("listNames", () => {
    it("should return empty array for empty registry", () => {
      expect(registry.listNames()).toEqual([]);
    });

    it("should return all tool names", () => {
      const tool1: ToolDefinition = { name: "list-a", description: "A", inputSchema: { type: "object" } };
      const tool2: ToolDefinition = { name: "list-b", description: "B", inputSchema: { type: "object" } };

      const handler: ToolHandler = async () => {
        return { ok: true, value: { success: true, durationMs: 0 } };
      };

      registry.register(tool1, handler);
      registry.register(tool2, handler);

      const names = registry.listNames();
      expect(names.sort()).toEqual(["list-a", "list-b"]);
    });
  });
});