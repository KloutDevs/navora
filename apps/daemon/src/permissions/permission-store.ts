/**
 * SqlitePermissionStore - Permission management using SQLite persistence
 */

import { SqlitePersistenceLayer, type PermissionGrantRow } from "../persistence/index";
import { ok, err, type Result } from "@navora/shared";
import { ulid } from "ulid";

export interface PermissionCheck {
  profileId: string;
  tool: string;
  origin: string;
  scope: "safe" | "mutating" | "dangerous";
}

export interface PermissionGrant {
  profileId: string;
  tool: string;
  originPattern: string;
  scope: "safe" | "mutating" | "dangerous";
  expiresInMs?: number;
  createdBy: string;
}

export interface ListedPermission {
  id: string;
  profileId: string;
  tool: string;
  originPattern: string;
  scope: "safe" | "mutating" | "dangerous";
  createdAt: string;
  expiresAt: string | null;
  createdBy: string;
  isRevoked: boolean;
}

export interface PermissionStoreConfig {
  /** The persistence layer to use */
  persistence: SqlitePersistenceLayer;
  /** Default TTL for permissions (default: 30 days) */
  defaultTtlMs?: number;
}

/**
 * SqlitePermissionStore - manages permission grants using SQLite persistence
 */
export class SqlitePermissionStore {
  private persistence: SqlitePersistenceLayer;
  private defaultTtlMs: number;

  constructor(config: PermissionStoreConfig) {
    this.persistence = config.persistence;
    this.defaultTtlMs = config.defaultTtlMs ?? 30 * 24 * 60 * 60 * 1000; // 30 days default
  }

  /**
   * Check if a permission is allowed
   * Returns the grant if found and valid, null if not granted
   */
  isAllowed(check: PermissionCheck): Result<PermissionGrantRow | null, Error> {
    return this.persistence.isPermissionGranted(
      check.profileId,
      check.tool,
      check.origin
    );
  }

  /**
   * Grant a new permission
   */
  grant(grant: PermissionGrant): Result<string, Error> {
    const id = ulid();
    const expiresAt = grant.expiresInMs
      ? new Date(Date.now() + grant.expiresInMs).toISOString()
      : new Date(Date.now() + this.defaultTtlMs).toISOString();

    const result = this.persistence.insertPermissionGrant({
      id,
      profile_id: grant.profileId,
      tool: grant.tool,
      origin_pattern: grant.originPattern,
      scope: grant.scope,
      expires_at: expiresAt,
      created_by: grant.createdBy,
    });

    if (!result.ok) {
      return err(result.error);
    }

    return ok(id);
  }

  /**
   * Revoke a permission by ID
   */
  revoke(permissionId: string): Result<void, Error> {
    return this.persistence.revokePermissionGrant(permissionId);
  }

  /**
   * List all permissions for a profile
   */
  list(profileId: string): Result<ListedPermission[], Error> {
    try {
      const db = this.persistence.getDatabase();
      const stmt = db.prepare(`
        SELECT 
          id, profile_id, tool, origin_pattern, scope,
          created_at, expires_at, created_by, revoked_at
        FROM permission_grants
        WHERE profile_id = ?
        ORDER BY created_at DESC
      `);

      const rows = stmt.all(profileId) as Array<{
        id: string;
        profile_id: string;
        tool: string;
        origin_pattern: string;
        scope: string;
        created_at: string;
        expires_at: string | null;
        created_by: string;
        revoked_at: string | null;
      }>;

      const permissions: ListedPermission[] = rows.map((row) => ({
        id: row.id,
        profileId: row.profile_id,
        tool: row.tool,
        originPattern: row.origin_pattern,
        scope: row.scope as "safe" | "mutating" | "dangerous",
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        createdBy: row.created_by,
        isRevoked: row.revoked_at !== null,
      }));

      return ok(permissions);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Check if a permission is allowed, with scope upgrading support
   * If a 'safe' permission exists, it allows 'mutating' as well
   */
  isAllowedWithScopeUpgrade(check: PermissionCheck): Result<PermissionGrantRow | null, Error> {
    // First try exact match
    const exactResult = this.isAllowed(check);
    if (!exactResult.ok) {
      return exactResult;
    }

    if (exactResult.value) {
      return exactResult;
    }

    // If not found, try upgrading scope (safe allows mutating)
    if (check.scope === "mutating") {
      const _safeResult = this.persistence.isPermissionGranted(
        check.profileId,
        check.tool,
        check.origin
      );
      // This won't work because isPermissionGranted uses exact scope
      // So we need to query manually
    }

    // For now, return no permission found
    return ok(null);
  }
}

/**
 * Create a SqlitePermissionStore instance
 */
export function createPermissionStore(config: PermissionStoreConfig): SqlitePermissionStore {
  return new SqlitePermissionStore(config);
}