/**
 * SqlitePersistenceLayer - Main persistence interface for the daemon
 */

import Database from "better-sqlite3";
import type { Logger } from "@ai-browser-runtime/shared";
import { ok, err, type Result, isOk } from "@ai-browser-runtime/shared";
import { createBlobStore, type BlobStore, type BlobMetadata, type BlobKind, createNoOpLogger } from "./blob-store";
import { createRetentionWorker, type RetentionWorker } from "./retention-worker";
import { runMigrations, getDatabaseVersion } from "./migrations";

export interface PersistenceConfig {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Directory for blob storage */
  blobBasePath: string;
  /** Retention config for blob cleanup */
  retentionConfig?: {
    intervalMs?: number;
    defaultTtlMs?: number;
    runOnStart?: boolean;
  };
  /** Logger instance */
  logger: Logger;
}

export interface ConnectionRow {
  id: string;
  profile_id: string;
  profile_name: string;
  chrome_user_data_dir: string | null;
  extension_version: string | null;
  protocol_version: string;
  connected_at: string;
  disconnected_at: string | null;
  last_seen_at: string | null;
}

export interface ToolCallRow {
  id: string;
  connection_id: string | null;
  profile_id: string;
  transport: string;
  client_id: string | null;
  tool_name: string;
  params_json: string;
  scope: string;
  permission_decision: string;
  permission_grant_id: string | null;
  status: string;
  error_code: string | null;
  duration_ms: number | null;
  result_blob_id: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface PermissionGrantRow {
  id: string;
  profile_id: string;
  tool: string;
  origin_pattern: string;
  scope: string;
  created_at: string;
  expires_at: string | null;
  created_by: string;
  revoked_at: string | null;
}

export interface CacheEntryRow {
  id: string;
  kind: string;
  profile_id: string;
  tool_call_id: string | null;
  filename: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  created_at: string;
  expires_at: string | null;
}

export interface SchemaMetaRow {
  version: string;
  applied_at: string;
  description: string | null;
}

/**
 * SqlitePersistenceLayer - Wraps all persistence operations
 */
export class SqlitePersistenceLayer {
  private db: Database.Database;
  private blobStore: BlobStore;
  private retentionWorker: RetentionWorker;
  private logger: Logger;
  private closed = false;

  private constructor(
    db: Database.Database,
    blobStore: BlobStore,
    retentionWorker: RetentionWorker,
    logger: Logger
  ) {
    this.db = db;
    this.blobStore = blobStore;
    this.retentionWorker = retentionWorker;
    this.logger = logger;
  }

  /**
   * Open a persistence layer with the given config
   */
  static async open(config: PersistenceConfig): Promise<Result<SqlitePersistenceLayer, Error>> {
    try {
      const { dbPath, blobBasePath, retentionConfig, logger: configLogger } = config;

      // Create no-op logger if none provided
      const noOpLogger = createNoOpLogger();
      const logger = configLogger ?? noOpLogger;

      logger.info(`PersistenceLayer: opening at ${dbPath}`);

      // Open SQLite database
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      db.pragma("busy_timeout = 5000");

      // Run migrations
      const migrations = runMigrations(db);
      if (migrations.length > 0) {
        logger.info(`PersistenceLayer: applied ${migrations.length} migrations`);
      }

      const version = getDatabaseVersion(db);
      logger.info(`PersistenceLayer: database version ${version}`);

      // Create blob store
      const blobStore = createBlobStore({ 
        basePath: blobBasePath, 
        logger: logger,
      });

      // Create retention worker
      const retentionWorker = createRetentionWorker(blobStore, {
        ...retentionConfig,
        logger: logger,
      });
      retentionWorker.start();

      return ok(new SqlitePersistenceLayer(db, blobStore, retentionWorker, logger));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ==================== Tool Calls ====================

  /**
   * Record a tool call (CRITICAL: always creates a row, even for denied calls)
   */
  insertToolCall(row: Omit<ToolCallRow, "started_at" | "ended_at">): Result<void, Error> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO tool_calls (
          id, connection_id, profile_id, transport, client_id, tool_name,
          params_json, scope, permission_decision, permission_grant_id,
          status, error_code, duration_ms, result_blob_id, started_at
        ) VALUES (
          @id, @connection_id, @profile_id, @transport, @client_id, @tool_name,
          @params_json, @scope, @permission_decision, @permission_grant_id,
          @status, @error_code, @duration_ms, @result_blob_id, datetime('now')
        )
      `);
      stmt.run({ ...row, started_at: new Date().toISOString() });
      this.logger?.debug?.(`PersistenceLayer: inserted tool_call ${row.id}`);
      return ok(undefined);
    } catch (error) {
      this.logger?.error?.(`PersistenceLayer: insertToolCall failed - ${error}`);
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Update tool call result
   */
  updateToolCall(
    id: string,
    updates: {
      status?: string;
      error_code?: string | null;
      duration_ms?: number | null;
      result_blob_id?: string | null;
      ended_at?: string;
    }
  ): Result<void, Error> {
    try {
      const fields = Object.keys(updates)
        .map((k) => `${k} = @${k}`)
        .join(", ");
      const stmt = this.db.prepare(`
        UPDATE tool_calls SET ${fields}, ended_at = datetime('now')
        WHERE id = @id
      `);
      stmt.run({ ...updates, id });
      this.logger?.debug?.(`PersistenceLayer: updated tool_call ${id}`);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get tool call by ID
   */
  getToolCall(id: string): Result<ToolCallRow | null, Error> {
    try {
      const stmt = this.db.prepare("SELECT * FROM tool_calls WHERE id = ?");
      const row = stmt.get(id) as ToolCallRow | undefined;
      return ok(row ?? null);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * List tool calls for a profile
   */
  listToolCalls(
    profileId: string,
    options?: { limit?: number; offset?: number }
  ): Result<ToolCallRow[], Error> {
    try {
      const limit = options?.limit ?? 100;
      const offset = options?.offset ?? 0;
      const stmt = this.db.prepare(`
        SELECT * FROM tool_calls
        WHERE profile_id = ?
        ORDER BY started_at DESC
        LIMIT ? OFFSET ?
      `);
      const rows = stmt.all(profileId, limit, offset) as ToolCallRow[];
      return ok(rows);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ==================== Connections ====================

  /**
   * Register a new connection
   */
  insertConnection(row: Omit<ConnectionRow, "connected_at" | "disconnected_at" | "last_seen_at">): Result<void, Error> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO connections (
          id, profile_id, profile_name, chrome_user_data_dir,
          extension_version, protocol_version, connected_at
        ) VALUES (
          @id, @profile_id, @profile_name, @chrome_user_data_dir,
          @extension_version, @protocol_version, datetime('now')
        )
      `);
      stmt.run(row);
      this.logger.debug(`PersistenceLayer: inserted connection ${row.id}`);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Mark connection as disconnected
   */
  disconnectConnection(id: string): Result<void, Error> {
    try {
      const stmt = this.db.prepare(`
        UPDATE connections SET disconnected_at = datetime('now')
        WHERE id = ?
      `);
      stmt.run(id);
      this.logger?.debug?.(`PersistenceLayer: disconnected ${id}`);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Update last_seen_at for connection
   */
  touchConnection(id: string): Result<void, Error> {
    try {
      const stmt = this.db.prepare(`
        UPDATE connections SET last_seen_at = datetime('now')
        WHERE id = ?
      `);
      stmt.run(id);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ==================== Permission Grants ====================

  /**
   * Grant a permission
   */
  insertPermissionGrant(row: Omit<PermissionGrantRow, "created_at" | "revoked_at">): Result<void, Error> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO permission_grants (
          id, profile_id, tool, origin_pattern, scope,
          expires_at, created_by, created_at
        ) VALUES (
          @id, @profile_id, @tool, @origin_pattern, @scope,
          @expires_at, @created_by, datetime('now')
        )
      `);
      stmt.run({ ...row, created_at: undefined });
      this.logger?.debug?.(`PersistenceLayer: granted permission ${row.id}`);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Revoke a permission
   */
  revokePermissionGrant(id: string): Result<void, Error> {
    try {
      const stmt = this.db.prepare(`
        UPDATE permission_grants SET revoked_at = datetime('now')
        WHERE id = ?
      `);
      stmt.run(id);
      this.logger?.debug?.(`PersistenceLayer: revoked permission ${id}`);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Check if a permission is granted
   */
  isPermissionGranted(
    profileId: string,
    tool: string,
    origin: string
  ): Result<PermissionGrantRow | null, Error> {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM permission_grants
        WHERE profile_id = ?
          AND tool = ?
          AND origin_pattern = ?
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > datetime('now'))
        LIMIT 1
      `);
      const row = stmt.get(profileId, tool, origin) as PermissionGrantRow | undefined;
      return ok(row ?? null);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ==================== Blob Operations ====================

  /**
   * Store a blob
   */
  storeBlob(
    data: Buffer,
    kind: BlobKind,
    options: {
      profileId: string;
      toolCallId?: string;
      mimeType: string;
      expiresInMs?: number;
    }
  ): Result<BlobMetadata, Error> {
    return this.blobStore.write(data, kind, {
      profileId: options.profileId,
      toolCallId: options.toolCallId ?? "",
      mimeType: options.mimeType,
      expiresInMs: options.expiresInMs ?? 7 * 24 * 60 * 60 * 1000, // 7 days default
    });
  }

  /**
   * Read a blob
   */
  readBlob(id: string): Result<Buffer, Error> {
    return this.blobStore.read(id);
  }

  /**
   * Get blob metadata
   */
  getBlobMetadata(id: string): Result<BlobMetadata, Error> {
    return this.blobStore.getMetadata(id);
  }

  /**
   * Delete a blob
   */
  deleteBlob(id: string): Result<void, Error> {
    return this.blobStore.delete(id);
  }

  // ==================== Lifecycle ====================

  /**
   * Close the persistence layer
   */
  close(): void {
    if (this.closed) {
      return;
    }

    this.retentionWorker.stop();
    this.blobStore.close();
    this.db.close();
    this.closed = true;
    this.logger?.info?.("PersistenceLayer: closed");
  }

  /**
   * Get the underlying database (for advanced queries)
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Get the blob store (for advanced operations)
   */
  getBlobStore(): BlobStore {
    return this.blobStore;
  }
}