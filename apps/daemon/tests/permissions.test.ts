/**
 * Unit tests for permissions module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { existsSync, mkdirSync, rmdSync } from "fs";
import { SqlitePersistenceLayer } from "../src/persistence/index";
import { SqlitePermissionStore, createPermissionStore } from "../src/permissions/permission-store";
import { ConfirmationGate, createConfirmationGate } from "../src/permissions/confirmation-gate";
import { createLogger } from "@navora/shared";

describe("SqlitePermissionStore", () => {
  let dbPath: string;
  let blobPath: string;
  let persistence: SqlitePersistenceLayer | null = null;
  let store: SqlitePermissionStore | null = null;
  const logger = createLogger({ name: "permission-test" });

  beforeEach(() => {
    // Create temp directories with absolute paths
    const baseDir = "C:\\Users\\bigma\\Desktop\\Nahuel\\Trabajo\\Tools\\ai-browser-runtime\\apps\\daemon";
    const testDir = join(baseDir, ".test-temp-perms");
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    dbPath = join(testDir, `perms-${Date.now()}.db`);
    blobPath = join(testDir, `blobs-${Date.now()}`);
    if (!existsSync(blobPath)) {
      mkdirSync(blobPath, { recursive: true });
    }
  });

  afterEach(async () => {
    if (persistence) {
      persistence.close();
      persistence = null;
    }
    store = null;
    // Cleanup temp files
    try {
      const testDir = join(process.cwd(), ".test-temp-perms");
      if (existsSync(testDir)) {
        rmdSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should grant and check permission", async () => {
    const result = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    persistence = result.value;

    store = createPermissionStore({ persistence });

    // Grant a permission
    const grantResult = store.grant({
      profileId: "profile-001",
      tool: "navigate",
      originPattern: "https://example.com",
      scope: "mutating",
      createdBy: "test-user",
    });

    expect(grantResult.ok).toBe(true);
    if (!grantResult.ok) return;
    expect(grantResult.value).toBeDefined();

    // Check if allowed
    const checkResult = store.isAllowed({
      profileId: "profile-001",
      tool: "navigate",
      origin: "https://example.com",
      scope: "mutating",
    });

    expect(checkResult.ok).toBe(true);
    if (!checkResult.ok) return;
    expect(checkResult.value).not.toBeNull();
    if (checkResult.value) {
      expect(checkResult.value.tool).toBe("navigate");
    }
  });

  it("should return null for non-granted permission", async () => {
    const result = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    persistence = result.value;

    store = createPermissionStore({ persistence });

    // Check a permission that was never granted
    const checkResult = store.isAllowed({
      profileId: "profile-001",
      tool: "navigate",
      origin: "https://unknown.com",
      scope: "safe",
    });

    expect(checkResult.ok).toBe(true);
    if (!checkResult.ok) return;
    expect(checkResult.value).toBeNull();
  });

  it("should revoke a permission", async () => {
    const result = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    persistence = result.value;

    store = createPermissionStore({ persistence });

    // Grant a permission
    const grantResult = store.grant({
      profileId: "profile-001",
      tool: "execute_script",
      originPattern: "https://example.com",
      scope: "dangerous",
      createdBy: "test-user",
    });

    expect(grantResult.ok).toBe(true);
    if (!grantResult.ok) return;
    const grantId = grantResult.value;

    // Revoke it
    const revokeResult = store.revoke(grantId);
    expect(revokeResult.ok).toBe(true);

    // Check it's no longer allowed
    const checkResult = store.isAllowed({
      profileId: "profile-001",
      tool: "execute_script",
      origin: "https://example.com",
      scope: "dangerous",
    });

    expect(checkResult.ok).toBe(true);
    if (!checkResult.ok) return;
    expect(checkResult.value).toBeNull();
  });

  it("should list permissions for a profile", async () => {
    const result = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    persistence = result.value;

    store = createPermissionStore({ persistence });

    // Grant multiple permissions
    store.grant({
      profileId: "profile-001",
      tool: "navigate",
      originPattern: "https://example.com",
      scope: "mutating",
      createdBy: "test-user",
    });

    store.grant({
      profileId: "profile-001",
      tool: "get_tabs",
      originPattern: "*",
      scope: "safe",
      createdBy: "test-user",
    });

    // List permissions
    const listResult = store.list("profile-001");
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value.length).toBeGreaterThanOrEqual(2);
  });
});

describe("ConfirmationGate", () => {
  let gate: ConfirmationGate | null = null;
  const timeoutCallback = vi.fn();

  beforeEach(() => {
    timeoutCallback.mockClear();
  });

  it("should create pending confirmation and resolve it", async () => {
    gate = createConfirmationGate({
      defaultTimeoutMs: 5000,
      maxTimeoutMs: 30000,
      onTimeout: timeoutCallback,
    });

    const request = {
      profileId: "profile-001",
      tool: "navigate",
      origin: "https://example.com",
      scope: "mutating" as const,
      params: { url: "https://example.com" },
    };

    // Request confirmation
    const promise = gate.request(request);

    // Get pending confirmation
    const pending = gate.getPendingForProfile("profile-001");
    expect(pending.length).toBe(1);
    expect(pending[0].tool).toBe("navigate");

    // Resolve it
    const confirmId = pending[0].id;
    const resolveResult = gate.resolve(confirmId, {
      allowed: true,
      grantScope: "mutating",
      rememberDecision: true,
    });

    expect(resolveResult.ok).toBe(true);

    // Check promise resolved
    const decision = await promise;
    expect(decision.allowed).toBe(true);
    expect(decision.grantScope).toBe("mutating");
    expect(decision.rememberDecision).toBe(true);
  });

  it("should reject confirmation on timeout", async () => {
    gate = createConfirmationGate({
      defaultTimeoutMs: 100, // Very short for test
      maxTimeoutMs: 1000,
      onTimeout: timeoutCallback,
    });

    const request = {
      profileId: "profile-002",
      tool: "execute_script",
      origin: "https://example.com",
      scope: "dangerous" as const,
      params: { source: "alert('test')" },
    };

    // Request confirmation - should timeout
    await expect(gate.request(request)).rejects.toThrow("Confirmation request timed out");

    // Timeout callback should have been called
    expect(timeoutCallback).toHaveBeenCalledTimes(1);
  });

  it("should reject a confirmation manually", async () => {
    gate = createConfirmationGate({
      defaultTimeoutMs: 5000,
      maxTimeoutMs: 30000,
      onTimeout: timeoutCallback,
    });

    const request = {
      profileId: "profile-003",
      tool: "get_cookies",
      origin: "*",
      scope: "safe" as const,
      params: {},
    };

    const promise = gate.request(request);

    // Get the confirmation ID
    const pending = gate.getPendingForProfile("profile-003");
    expect(pending.length).toBe(1);

    // Reject it
    const rejectResult = gate.reject(pending[0].id, new Error("User cancelled"));
    expect(rejectResult.ok).toBe(true);

    // Check promise rejected
    await expect(promise).rejects.toThrow("User cancelled");
  });

  it("should cancel all pending for profile", async () => {
    gate = createConfirmationGate({
      defaultTimeoutMs: 5000,
      maxTimeoutMs: 30000,
      onTimeout: timeoutCallback,
    });

    // Create multiple pending requests (don't await - they should be cancelled)
    gate.request({
      profileId: "profile-004",
      tool: "navigate",
      origin: "https://a.com",
      scope: "safe",
      params: {},
    });

    gate.request({
      profileId: "profile-004",
      tool: "get_tabs",
      origin: "https://b.com",
      scope: "safe",
      params: {},
    });

    expect(gate.pendingCount()).toBe(2);

    // Cancel all for profile - we expect the promises to reject
    const cancelled = gate.cancelAllForProfile("profile-004");
    expect(cancelled).toBe(2);
    expect(gate.pendingCount()).toBe(0);
  });

  it("should update timeout for pending confirmation", async () => {
    gate = createConfirmationGate({
      defaultTimeoutMs: 5000,
      maxTimeoutMs: 10000,
      onTimeout: timeoutCallback,
    });

    const request = {
      profileId: "profile-005",
      tool: "navigate",
      origin: "https://example.com",
      scope: "mutating",
      params: {},
    };

    const promise = gate.request(request);

    // Get confirmation ID
    const pending = gate.getPendingForProfile("profile-005");
    expect(pending.length).toBe(1);
    const confirmId = pending[0].id;

    // Update timeout to 100ms (very short)
    const updateResult = gate.updateTimeout(confirmId, 100);
    expect(updateResult.ok).toBe(true);

    // Should timeout
    await expect(promise).rejects.toThrow("Confirmation request timed out");
  });

  it("should reject update timeout if exceeds max", async () => {
    gate = createConfirmationGate({
      defaultTimeoutMs: 5000,
      maxTimeoutMs: 10000,
      onTimeout: timeoutCallback,
    });

    const request = {
      profileId: "profile-006",
      tool: "navigate",
      origin: "https://example.com",
      scope: "mutating",
      params: {},
    };

    const promise = gate.request(request);

    // Get confirmation ID
    const pending = gate.getPendingForProfile("profile-006");
    const confirmId = pending[0].id;

    // Try to update to more than max (10s)
    const updateResult = gate.updateTimeout(confirmId, 20000);
    expect(updateResult.ok).toBe(false);
    if (!updateResult.ok) {
      expect(updateResult.error.message).toContain("exceeds maximum");
    }
  });

it("should destroy cleanly", () => {
    gate = createConfirmationGate({
      defaultTimeoutMs: 5000,
      maxTimeoutMs: 30000,
      onTimeout: timeoutCallback,
    });

    // Create pending requests but don't await them (they'll be cleaned up on destroy)
    gate.request({
      profileId: "profile-007",
      tool: "navigate",
      origin: "https://example.com",
      scope: "mutating",
      params: {},
    });

    expect(gate.pendingCount()).toBe(1);

    // Destroy - the pending promise will reject, so catch it
    gate.destroy();

    expect(gate.pendingCount()).toBe(0);
  });
});