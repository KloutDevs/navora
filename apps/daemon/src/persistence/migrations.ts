/**
 * Schema migrations runner
 */

import Database from "better-sqlite3";

export interface Migration {
  version: string;
  description: string;
}

// Inline the initial migration SQL
const MIGRATION_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS schema_meta (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    description TEXT
);

CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    profile_name TEXT NOT NULL,
    chrome_user_data_dir TEXT,
    extension_version TEXT,
    protocol_version TEXT NOT NULL DEFAULT '1.0.0',
    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
    disconnected_at TEXT,
    last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    connection_id TEXT,
    profile_id TEXT NOT NULL,
    transport TEXT NOT NULL,
    client_id TEXT,
    tool_name TEXT NOT NULL,
    params_json TEXT NOT NULL,
    scope TEXT NOT NULL,
    permission_decision TEXT NOT NULL,
    permission_grant_id TEXT REFERENCES permission_grants(id),
    status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'error')),
    error_code TEXT,
    duration_ms INTEGER,
    result_blob_id TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
);

CREATE TABLE IF NOT EXISTS permission_grants (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    origin_pattern TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('safe', 'mutating', 'dangerous')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    created_by TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS cache_entries (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('screenshot', 'dom_snapshot', 'console_logs', 'network_logs')),
    profile_id TEXT NOT NULL,
    tool_call_id TEXT REFERENCES tool_calls(id),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    FOREIGN KEY (profile_id) REFERENCES profile_connections(profile_id)
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_profile_id ON tool_calls(profile_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_connection_id ON tool_calls(connection_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_started_at ON tool_calls(started_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_permission_grants_profile_id ON permission_grants(profile_id);
CREATE INDEX IF NOT EXISTS idx_permission_grants_origin ON permission_grants(origin_pattern);
CREATE INDEX IF NOT EXISTS idx_cache_entries_profile_id ON cache_entries(profile_id);
CREATE INDEX IF NOT EXISTS idx_cache_entries_expires_at ON cache_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_entries_tool_call_id ON cache_entries(tool_call_id);

INSERT OR IGNORE INTO schema_meta (version, description) VALUES ('0001_initial', 'Initial schema');
`;

/**
 * Get the current database version
 */
export function getDatabaseVersion(db: Database.Database): string | null {
  try {
    const row = db
      .prepare("SELECT version FROM schema_meta ORDER BY version DESC LIMIT 1")
      .get() as { version: string } | undefined;
    return row?.version ?? null;
  } catch {
    // Table doesn't exist yet
    return null;
  }
}

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database): Migration[] {
  const applied: Migration[] = [];

  // Check current version
  const currentVersion = getDatabaseVersion(db);
  const version = "0001_initial";

  // Skip if already applied
  if (currentVersion && version <= currentVersion) {
    return applied;
  }

  // Run migration in a transaction
  const transaction = db.transaction(() => {
    // Split into individual statements and execute
    const statements = MIGRATION_SQL.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    for (const statement of statements) {
      if (statement.trim()) {
        db.exec(statement);
      }
    }
  });

  transaction();
  applied.push({ version, description: "Applied 0001_initial" });

  return applied;
}