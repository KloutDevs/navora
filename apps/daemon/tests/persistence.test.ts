/**
 * Unit tests for persistence layer
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { unlinkSync, existsSync, mkdirSync, rmdSync } from "fs";
import { SqlitePersistenceLayer } from "../src/persistence/index";
import type { Logger } from "@ai-browser-runtime/shared";
import { createLogger } from "@ai-browser-runtime/shared";

describe("SqlitePersistenceLayer", () => {
  let dbPath: string;
  let blobPath: string;
  let persistence: SqlitePersistenceLayer | null = null;
  let logger: Logger;

  beforeEach(() => {
    // Create temp directories with ABSOLUTE paths
    const baseDir = "C:\\Users\\bigma\\Desktop\\Nahuel\\Trabajo\\Tools\\ai-browser-runtime\\apps\\daemon";
    const testDir = join(baseDir, ".test-temp");
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    dbPath = join(testDir, `test-${Date.now()}.db`);
    blobPath = join(testDir, `blobs-${Date.now()}`);
    if (!existsSync(blobPath)) {
      mkdirSync(blobPath, { recursive: true });
    }
    logger = createLogger({ name: "persistence-test" });
  });

  afterEach(async () => {
    if (persistence) {
      persistence.close();
      persistence = null;
    }
    // Cleanup temp files
    try {
      const testDir = join(process.cwd(), ".test-temp");
      if (existsSync(testDir)) {
        rmdSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should open and initialize database", async () => {
    const result = await SqlitePersistenceLayer.open({
      dbPath,
      blobBasePath: blobPath,
      logger,
    });

    // Debug: print full result structure
    console.log("Full result:", JSON.stringify(result, (k, v) => {
      if (k === 'error') return v?.message;
      return v;
    }, 2));
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      persistence = result.value;
      expect(persistence).not.toBeNull();
    }
  });

  it("should insert and retrieve tool calls", async () => {
    const result = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    persistence = result.value;

    // Insert a tool call
    const insertResult = persistence.insertToolCall({
      id: "test-call-001",
      connection_id: null,
      profile_id: "profile-001",
      transport: "stdio",
      client_id: null,
      tool_name: "get_tabs",
      params_json: "{}",
      scope: "safe",
      permission_decision: "allowed",
      permission_grant_id: null,
      status: "pending",
      error_code: null,
      duration_ms: null,
      result_blob_id: null,
    });

    expect(insertResult.ok).toBe(true);

    // Retrieve the tool call
    if (insertResult.ok) {
      const getResult = persistence.getToolCall("test-call-001");
      expect(getResult.ok).toBe(true);
      if (getResult.ok && getResult.value) {
        expect(getResult.value.tool_name).toBe("get_tabs");
        expect(getResult.value.profile_id).toBe("profile-001");
      }
    }
  });

  it("should update tool call status", async () => {
    const result = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    persistence = result.value;

    // Insert a tool call
    persistence.insertToolCall({
      id: "test-call-002",
      connection_id: null,
      profile_id: "profile-001",
      transport: "websocket",
      client_id: "client-001",
      tool_name: "navigate",
      params_json: '{"url":"https://example.com"}',
      scope: "mutating",
      permission_decision: "allowed",
      permission_grant_id: null,
      status: "pending",
      error_code: null,
      duration_ms: null,
      result_blob_id: null,
    });

    // Update with result
    const updateResult = persistence.updateToolCall("test-call-002", {
      status: "success",
      duration_ms: 150,
    });

    expect(updateResult.ok).toBe(true);

    // Verify update
    const getResult = persistence.getToolCall("test-call-002");
    if (getResult.ok && getResult.value) {
      expect(getResult.value.status).toBe("success");
      expect(getResult.value.duration_ms).toBe(150);
    }
  });

  it("should insert and list connections", async () => {
    const result = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    persistence = result.value;

    // Insert a connection
    const connResult = persistence.insertConnection({
      id: "conn-001",
      profile_id: "profile-001",
      profile_name: "Test Profile",
      chrome_user_data_dir: null,
      extension_version: "1.0.0",
      protocol_version: "1.0.0",
    });

    expect(connResult.ok).toBe(true);
    if (!connResult.ok) {
      console.error("Insert connection failed:", connResult.error);
    }

    // Insert a tool call to list
    persistence.insertToolCall({
      id: "test-call-003",
      connection_id: "conn-001",
      profile_id: "profile-001",
      transport: "stdio",
      client_id: null,
      tool_name: "get_tabs",
      params_json: "{}",
      scope: "safe",
      permission_decision: "allowed",
      permission_grant_id: null,
      status: "success",
      error_code: null,
      duration_ms: 50,
      result_blob_id: null,
    });

    // List tool calls
    const listResult = persistence.listToolCalls("profile-001");
    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      expect(listResult.value.length).toBeGreaterThan(0);
    }
  });

  it("should manage permission grants", async () => {
    const result = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    persistence = result.value;

    // Insert a permission grant
    const grantResult = persistence.insertPermissionGrant({
      id: "grant-001",
      profile_id: "profile-001",
      tool: "navigate",
      origin_pattern: "https://example.com",
      scope: "mutating",
      expires_at: null,
      created_by: "user",
    });

    expect(grantResult.ok).toBe(true);

    // Check if granted
    if (grantResult.ok) {
      const checkResult = persistence.isPermissionGranted(
        "profile-001",
        "navigate",
        "https://example.com"
      );
      expect(checkResult.ok).toBe(true);
      if (checkResult.ok && checkResult.value) {
        expect(checkResult.value.id).toBe("grant-001");
      }
    }

    // Revoke permission
    const revokeResult = persistence.revokePermissionGrant("grant-001");
    expect(revokeResult.ok).toBe(true);

    // Verify revoked
    if (revokeResult.ok) {
      const checkResult = persistence.isPermissionGranted(
        "profile-001",
        "navigate",
        "https://example.com"
      );
      if (checkResult.ok) {
        expect(checkResult.value).toBeNull();
      }
    }
  });

  it("should store and retrieve blobs", async () => {
    const result = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    persistence = result.value;

    // Store a blob (screenshot)
    const blobData = Buffer.from("fake-image-data");
    const storeResult = persistence.storeBlob(blobData, "screenshot", {
      profileId: "profile-001",
      toolCallId: "test-call-004",
      mimeType: "image/png",
    });

    expect(storeResult.ok).toBe(true);
    if (!storeResult.ok) return;

    const blobId = storeResult.value.id;

    // Read the blob
    const readResult = persistence.readBlob(blobId);
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value.equals(blobData)).toBe(true);
    }

    // Get metadata
    const metaResult = persistence.getBlobMetadata(blobId);
    expect(metaResult.ok).toBe(true);
    if (metaResult.ok && metaResult.value) {
      expect(metaResult.value.mimeType).toBe("image/png");
      expect(metaResult.value.byteSize).toBe(blobData.length);
    }
  });

  it("should always create tool call row even for denied calls", async () => {
    const result = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    persistence = result.value;

    // Insert a DENIED tool call
    const insertResult = persistence.insertToolCall({
      id: "test-call-denied",
      connection_id: null,
      profile_id: "profile-001",
      transport: "stdio",
      client_id: null,
      tool_name: "execute_script",
      params_json: '{"source":"dangerous"}',
      scope: "dangerous",
      permission_decision: "denied",
      permission_grant_id: null,
      status: "error",
      error_code: "PERMISSION_DENIED",
      duration_ms: 5,
      result_blob_id: null,
    });

    expect(insertResult.ok).toBe(true);

    // Verify it exists (critical audit invariant)
    const getResult = persistence.getToolCall("test-call-denied");
    expect(getResult.ok).toBe(true);
    if (getResult.ok && getResult.value) {
      expect(getResult.value.permission_decision).toBe("denied");
      expect(getResult.value.status).toBe("error");
    }
  });
});