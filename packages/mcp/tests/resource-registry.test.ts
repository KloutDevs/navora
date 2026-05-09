import { describe, it, expect, beforeEach } from "vitest";
import {
  ResourceRegistry,
  type ResourceDefinition,
  type ResourceHandler,
  type ResourceContent,
  type ToolExecutionContext,
} from "../src/types";
import { ok } from "@navora/shared";

describe("ResourceRegistry", () => {
  let registry: ResourceRegistry;

  beforeEach(() => {
    registry = new ResourceRegistry();
  });

  describe("register", () => {
    it("should register a resource with handler", () => {
      const resourceDef: ResourceDefinition = {
        uri: "file://test-resource",
        name: "Test Resource",
        description: "A test resource",
        mimeType: "application/json",
        traversable: true,
      };

      const handler: ResourceHandler = async (uri, context) => {
        return ok({
          uri,
          mimeType: "application/json",
          content: '{"test": true}',
        });
      };

      registry.register(resourceDef, handler);

      expect(registry.size()).toBe(1);
      expect(registry.has("file://test-resource")).toBe(true);
    });

    it("should throw when registering duplicate resource", () => {
      const resourceDef: ResourceDefinition = {
        uri: "file://duplicate",
        name: "Duplicate Resource",
        description: "A resource",
        mimeType: "text/plain",
      };

      const handler: ResourceHandler = async () => {
        return ok({
          uri: "file://duplicate",
          mimeType: "text/plain",
          content: "content",
        });
      };

      registry.register(resourceDef, handler);

      expect(() => registry.register(resourceDef, handler)).toThrow(
        "Resource 'file://duplicate' is already registered"
      );
    });

    it("should store resource definition and handler", () => {
      const resourceDef: ResourceDefinition = {
        uri: "file://stored-resource",
        name: "Stored Resource",
        description: "A stored resource",
        mimeType: "text/html",
        uriTemplate: {
          template: "file://{filename}",
          variables: ["filename"],
        },
      };

      const handler: ResourceHandler = async () => {
        return ok({
          uri: "file://stored-resource",
          mimeType: "text/html",
          content: "<html></html>",
        });
      };

      registry.register(resourceDef, handler);

      const stored = registry.get("file://stored-resource");
      expect(stored?.name).toBe("Stored Resource");
      expect(stored?.uriTemplate?.template).toBe("file://{filename}");

      const storedHandler = registry.getHandler("file://stored-resource");
      expect(storedHandler).toBe(handler);
    });
  });

  describe("get", () => {
    it("should return undefined for non-existent resource", () => {
      expect(registry.get("file://non-existent")).toBeUndefined();
    });

    it("should return registered resource", () => {
      const resourceDef: ResourceDefinition = {
        uri: "file://get-resource",
        name: "Get Resource",
        description: "Resource to get",
        mimeType: "application/json",
      };

      const handler: ResourceHandler = async () => {
        return ok({
          uri: "file://get-resource",
          mimeType: "application/json",
          content: "{}",
        });
      };

      registry.register(resourceDef, handler);

      const retrieved = registry.get("file://get-resource");
      expect(retrieved?.name).toBe("Get Resource");
    });
  });

  describe("getAll", () => {
    it("should return empty array when empty", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("should return all registered resources", () => {
      const resource1: ResourceDefinition = {
        uri: "file://resource-1",
        name: "Resource 1",
        description: "First resource",
        mimeType: "application/json",
      };
      const resource2: ResourceDefinition = {
        uri: "file://resource-2",
        name: "Resource 2",
        description: "Second resource",
        mimeType: "text/plain",
      };

      const handler: ResourceHandler = async () => {
        return ok({
          uri: "",
          mimeType: "text/plain",
          content: "",
        });
      };

      registry.register(resource1, handler);
      registry.register(resource2, handler);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.uri).sort()).toEqual([
        "file://resource-1",
        "file://resource-2",
      ]);
    });
  });

  describe("getHandler", () => {
    it("should return undefined for non-existent handler", () => {
      expect(registry.getHandler("file://non-existent")).toBeUndefined();
    });

    it("should return registered handler", () => {
      const resourceDef: ResourceDefinition = {
        uri: "file://handler-resource",
        name: "Handler Resource",
        description: "Resource with handler",
        mimeType: "application/json",
      };

      const handler: ResourceHandler = async (uri, context) => {
        return ok({
          uri,
          mimeType: "application/json",
          content: '{"data": "test"}',
        });
      };

      registry.register(resourceDef, handler);

      const retrievedHandler = registry.getHandler("file://handler-resource");
      expect(retrievedHandler).toBe(handler);
    });
  });

  describe("has", () => {
    it("should return false for non-existent resource", () => {
      expect(registry.has("file://non-existent")).toBe(false);
    });

    it("should return true for registered resource", () => {
      const resourceDef: ResourceDefinition = {
        uri: "file://has-resource",
        name: "Has Resource",
        description: "Resource that exists",
        mimeType: "text/plain",
      };

      const handler: ResourceHandler = async () => {
        return ok({
          uri: "file://has-resource",
          mimeType: "text/plain",
          content: "content",
        });
      };

      registry.register(resourceDef, handler);

      expect(registry.has("file://has-resource")).toBe(true);
    });
  });

  describe("unregister", () => {
    it("should return false for non-existent resource", () => {
      expect(registry.unregister("file://non-existent")).toBe(false);
    });

    it("should remove resource and return true", () => {
      const resourceDef: ResourceDefinition = {
        uri: "file://remove-resource",
        name: "Remove Resource",
        description: "Resource to remove",
        mimeType: "text/plain",
      };

      const handler: ResourceHandler = async () => {
        return ok({
          uri: "file://remove-resource",
          mimeType: "text/plain",
          content: "content",
        });
      };

      registry.register(resourceDef, handler);
      expect(registry.has("file://remove-resource")).toBe(true);

      const result = registry.unregister("file://remove-resource");
      expect(result).toBe(true);
      expect(registry.has("file://remove-resource")).toBe(false);
      expect(registry.size()).toBe(0);
    });
  });

  describe("size", () => {
    it("should return 0 for empty registry", () => {
      expect(registry.size()).toBe(0);
    });

    it("should return count of registered resources", () => {
      const resource1: ResourceDefinition = {
        uri: "file://size-1",
        name: "R1",
        description: "R1",
        mimeType: "text/plain",
      };
      const resource2: ResourceDefinition = {
        uri: "file://size-2",
        name: "R2",
        description: "R2",
        mimeType: "text/plain",
      };

      const handler: ResourceHandler = async () => {
        return ok({
          uri: "",
          mimeType: "text/plain",
          content: "",
        });
      };

      registry.register(resource1, handler);
      registry.register(resource2, handler);

      expect(registry.size()).toBe(2);
    });
  });

  describe("clear", () => {
    it("should remove all resources", () => {
      const resource1: ResourceDefinition = {
        uri: "file://clear-1",
        name: "Clear 1",
        description: "C1",
        mimeType: "text/plain",
      };
      const resource2: ResourceDefinition = {
        uri: "file://clear-2",
        name: "Clear 2",
        description: "C2",
        mimeType: "text/plain",
      };

      const handler: ResourceHandler = async () => {
        return ok({
          uri: "",
          mimeType: "text/plain",
          content: "",
        });
      };

      registry.register(resource1, handler);
      registry.register(resource2, handler);
      expect(registry.size()).toBe(2);

      registry.clear();

      expect(registry.size()).toBe(0);
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe("listUris", () => {
    it("should return empty array for empty registry", () => {
      expect(registry.listUris()).toEqual([]);
    });

    it("should return all resource URIs", () => {
      const resource1: ResourceDefinition = {
        uri: "file://list-a",
        name: "List A",
        description: "A",
        mimeType: "text/plain",
      };
      const resource2: ResourceDefinition = {
        uri: "file://list-b",
        name: "List B",
        description: "B",
        mimeType: "text/plain",
      };

      const handler: ResourceHandler = async () => {
        return ok({
          uri: "",
          mimeType: "text/plain",
          content: "",
        });
      };

      registry.register(resource1, handler);
      registry.register(resource2, handler);

      const uris = registry.listUris();
      expect(uris.sort()).toEqual(["file://list-a", "file://list-b"]);
    });
  });

  describe("listTraversable", () => {
    it("should return empty array when no traversable resources", () => {
      const resourceDef: ResourceDefinition = {
        uri: "file://not-traversable",
        name: "Not Traversable",
        description: "Not traversable",
        mimeType: "text/plain",
        traversable: false,
      };

      const handler: ResourceHandler = async () => {
        return ok({
          uri: "",
          mimeType: "text/plain",
          content: "",
        });
      };

      registry.register(resourceDef, handler);

      expect(registry.listTraversable()).toEqual([]);
    });

    it("should return only traversable resources", () => {
      const resource1: ResourceDefinition = {
        uri: "file://traversable",
        name: "Traversable",
        description: "Is traversable",
        mimeType: "text/plain",
        traversable: true,
      };
      const resource2: ResourceDefinition = {
        uri: "file://not-traversable",
        name: "Not Traversable",
        description: "Not traversable",
        mimeType: "text/plain",
        traversable: false,
      };

      const handler: ResourceHandler = async () => {
        return ok({
          uri: "",
          mimeType: "text/plain",
          content: "",
        });
      };

      registry.register(resource1, handler);
      registry.register(resource2, handler);

      const traversable = registry.listTraversable();
      expect(traversable).toHaveLength(1);
      expect(traversable[0].uri).toBe("file://traversable");
    });
  });
});