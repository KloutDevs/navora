-- 0001_initial.sql - SQLite schema for ai-browser-runtime daemon
-- Version: 1.0.0
-- WAL mode, foreign_keys=ON

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- Schema metadata - tracks applied migrations
CREATE TABLE IF NOT EXISTS schema_meta (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    description TEXT
);

-- Connections - active browser connections
CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    profile_name TEXT NOT NULL,
    chrome_user_data_dir TEXT,
    extension_version TEXT,
    protocol_version TEXT NOT NULL DEFAULT '1.0.0',
    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
    disconnected_at TEXT,
    last_seen_at TEXT,
    FOREIGN KEY (profile_id) REFERENCES profile_connections(profile_id)
);

-- Profile connections - logical grouping for connections per profile
CREATE TABLE IF NOT EXISTS profile_connections (
    profile_id TEXT PRIMARY KEY,
    profile_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tool calls - every tool call (even denied) for audit
-- This is a CRITICAL invariant: every tool call gets a row
CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    connection_id TEXT,
    profile_id TEXT NOT NULL,
    transport TEXT NOT NULL CHECK (transport IN ('stdio', 'websocket')),
    client_id TEXT,
    tool_name TEXT NOT NULL,
    params_json TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('safe', 'mutating', 'dangerous')),
    permission_decision TEXT NOT NULL CHECK (permission_decision IN ('allowed', 'denied', 'error')),
    permission_grant_id TEXT REFERENCES permission_grants(id),
    status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'error')),
    error_code TEXT,
    duration_ms INTEGER,
    result_blob_id TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    FOREIGN KEY (connection_id) REFERENCES connections(id),
    FOREIGN KEY (profile_id) REFERENCES profile_connections(profile_id)
);

-- Permission grants - domain allowlist
CREATE TABLE IF NOT EXISTS permission_grants (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    origin_pattern TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('safe', 'mutating', 'dangerous')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    created_by TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY (profile_id) REFERENCES profile_connections(profile_id)
);

-- Cache entries - blob metadata for screenshots and DOM snapshots
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

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_tool_calls_profile_id ON tool_calls(profile_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_connection_id ON tool_calls(connection_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_started_at ON tool_calls(started_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_permission_grants_profile_id ON permission_grants(profile_id);
CREATE INDEX IF NOT EXISTS idx_permission_grants_origin ON permission_grants(origin_pattern);
CREATE INDEX IF NOT EXISTS idx_cache_entries_profile_id ON cache_entries(profile_id);
CREATE INDEX IF NOT EXISTS idx_cache_entries_expires_at ON cache_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_entries_tool_call_id ON cache_entries(tool_call_id);

-- Insert initial schema version
INSERT OR IGNORE INTO schema_meta (version, description) VALUES ('0001_initial', 'Initial schema');