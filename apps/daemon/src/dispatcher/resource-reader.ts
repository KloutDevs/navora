/**
 * Resource Readers - MCP resource providers for the daemon
 * Provides access to tool calls, connections, permissions, and blobs
 */

import type { Logger } from "@navora/shared";
import { ok, err, isOk, isError, type Result } from "@navora/shared";
import type { SqlitePersistenceLayer, ToolCallRow } from "../persistence/index";
import type { SqlitePermissionStore, ListedPermission } from "../permissions/permission-store";

export interface ResourceReaderConfig {
  persistence: SqlitePersistenceLayer;
  permissions: SqlitePermissionStore;
  logger?: Logger;
}

/**
 * ResourceReader - Provides MCP resources
 */
export class ResourceReader {
  private persistence: SqlitePersistenceLayer;
  private permissions: SqlitePermissionStore;
  private logger: Logger;

  constructor(config: ResourceReaderConfig) {
    this.persistence = config.persistence;
    this.permissions = config.permissions;
    this.logger = config.logger ?? this.createDefaultLogger();
  }

  private createDefaultLogger(): Logger {
    return {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: console.warn,
      error: console.error,
      child: () => this.createDefaultLogger(),
    };
  }

  /**
   * Read a resource by URI
   */
  read(uri: string, params?: Record<string, unknown>): Result<ResourceContent, Error> {
    const [scheme, rest] = uri.split("://");
    if (!rest) {
      return err(new Error(`Invalid resource URI: ${uri}`));
    }

    switch (scheme) {
      case "tool-calls":
        return this.readToolCalls(rest, params);

      case "connections":
        return this.readConnections(rest, params);

      case "permissions":
        return this.readPermissions(rest, params);

      case "blobs":
        return this.readBlob(rest);

      case "stats":
        return this.readStats(rest);

      default:
        return err(new Error(`Unknown resource scheme: ${scheme}`));
    }
  }

  /**
   * List available resources
   */
  list(): ResourceEntry[] {
    return [
      {
        uri: "tool-calls://recent",
        name: "Recent Tool Calls",
        description: "List of recent tool calls across all profiles",
        mimeType: "application/json",
      },
      {
        uri: "connections://active",
        name: "Active Connections",
        description: "Currently active browser connections",
        mimeType: "application/json",
      },
      {
        uri: "permissions://granted",
        name: "Granted Permissions",
        description: "List of granted permission rules",
        mimeType: "application/json",
      },
      {
        uri: "stats://overview",
        name: "System Stats",
        description: "Overview of dispatcher statistics",
        mimeType: "application/json",
      },
    ];
  }

  /**
   * Read tool calls resource
   */
  private readToolCalls(path: string, params?: Record<string, unknown>): Result<ResourceContent, Error> {
    const parts = path.split("/");
    const profileId = params?.["profileId"] as string | undefined;

    try {
      let toolCalls: ToolCallRow[] | ToolCallRow | null;

      if (parts[0] === "recent") {
        const limit = (params?.["limit"] as number) ?? 100;
        if (profileId) {
          const result = this.persistence.listToolCalls(profileId, { limit });
          if (isError(result)) {
            return err(result.error);
          }
          toolCalls = result.value;
        } else {
          return err(new Error("Profile ID required for tool-calls resource"));
        }
      } else if (parts[0] === "detail" && parts[1]) {
        const result = this.persistence.getToolCall(parts[1]);
        if (isError(result)) {
          return err(result.error);
        }
        toolCalls = result.value;
      } else {
        return err(new Error(`Unknown tool-calls path: ${path}`));
      }

      return ok({
        content: JSON.stringify(toolCalls, null, 2),
        mimeType: "application/json",
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Read connections resource
   */
  private readConnections(path: string, _params?: Record<string, unknown>): Result<ResourceContent, Error> {
    try {
      const db = this.persistence.getDatabase();
      let rows: unknown[];

      if (path === "active") {
        rows = db
          .prepare(
            `SELECT * FROM connections 
             WHERE disconnected_at IS NULL 
             ORDER BY connected_at DESC`
          )
          .all();
      } else {
        return err(new Error(`Unknown connections path: ${path}`));
      }

      return ok({
        content: JSON.stringify(rows, null, 2),
        mimeType: "application/json",
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Read permissions resource
   */
  private readPermissions(path: string, params?: Record<string, unknown>): Result<ResourceContent, Error> {
    try {
      let permissions: ListedPermission[];

      if (path === "granted" || path === "list") {
        const profileId = params?.["profileId"] as string | undefined;
        const result = this.permissions.list(profileId ?? "");
        if (isError(result)) {
          return err(result.error);
        }
        permissions = result.value;
      } else {
        return err(new Error(`Unknown permissions path: ${path}`));
      }

      return ok({
        content: JSON.stringify(permissions, null, 2),
        mimeType: "application/json",
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Read blob resource
   */
  private readBlob(path: string): Result<ResourceContent, Error> {
    try {
      // path is the blob ID
      const result = this.persistence.readBlob(path);
      if (isError(result)) {
        return err(result.error);
      }

      const metadataResult = this.persistence.getBlobMetadata(path);
      let mimeType = "application/octet-stream";
      if (isOk(metadataResult)) {
        mimeType = metadataResult.value.mimeType;
      }

      // Convert buffer to base64 for text-based types, or return raw for binary
      if (mimeType.startsWith("text/") || mimeType === "application/json") {
        return ok({
          content: result.value.toString("utf-8"),
          mimeType,
        });
      }

      // For binary, return base64
      return ok({
        content: result.value.toString("base64"),
        mimeType: `${mimeType};base64`,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Read stats resource
   */
  private readStats(_path: string): Result<ResourceContent, Error> {
    try {
      const db = this.persistence.getDatabase();

      const toolCallCount = db.prepare("SELECT COUNT(*) as count FROM tool_calls").get() as { count: number };
      const connectionCount = db.prepare("SELECT COUNT(*) as count FROM connections WHERE disconnected_at IS NULL").get() as { count: number };
      const permissionCount = db.prepare("SELECT COUNT(*) as count FROM permission_grants WHERE revoked_at IS NULL").get() as { count: number };
      const blobCount = db.prepare("SELECT COUNT(*) as count FROM cache_entries").get() as { count: number };

      const stats = {
        toolCalls: toolCallCount.count,
        activeConnections: connectionCount.count,
        grantedPermissions: permissionCount.count,
        cachedBlobs: blobCount.count,
        timestamp: new Date().toISOString(),
      };

      return ok({
        content: JSON.stringify(stats, null, 2),
        mimeType: "application/json",
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export interface ResourceContent {
  content: string;
  mimeType: string;
}

export interface ResourceEntry {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/**
 * Create a resource reader
 */
export function createResourceReader(config: ResourceReaderConfig): ResourceReader {
  return new ResourceReader(config);
}