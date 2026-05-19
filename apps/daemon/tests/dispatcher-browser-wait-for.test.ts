/**
 * dispatcher browser_wait_for — routes text vs selector and validates params.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAdapter } from "@navora/browser-tools";
import { createLogger } from "@navora/shared";
import { SqlitePersistenceLayer } from "../src/persistence/index";
import { createPermissionStore } from "../src/permissions/permission-store";
import { createAdapterRegistry } from "../src/dispatcher/adapter-registry";
import { createDispatcher } from "../src/dispatcher/pipeline";
import { RateLimiter } from "../src/dispatcher/rate-limiter";

describe("dispatcher browser_wait_for", () => {
  let dir: string;
  let persistence: SqlitePersistenceLayer | null = null;
  const logger = createLogger({ name: "dispatcher-browser-wait-for" });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "navora-wait-"));
  });

  afterEach(() => {
    persistence?.close();
    persistence = null;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  async function setup() {
    const dbPath = join(dir, "t.db");
    const blobPath = join(dir, "blobs");
    const open = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(open.ok).toBe(true);
    if (!open.ok) throw open.error;
    persistence = open.value;

    const permissions = createPermissionStore({ persistence });
    const g = permissions.grant({
      profileId: "default",
      tool: "browser_wait_for",
      originPattern: "unknown",
      scope: "safe",
      createdBy: "test",
    });
    expect(g.ok).toBe(true);

    const rateLimiter = new RateLimiter({ maxRequests: 10_000, windowMs: 60_000 });
    const adapterRegistry = createAdapterRegistry({});
    const fake = new FakeAdapter();
    const reg = adapterRegistry.register("nm:default", fake);
    expect(reg.ok).toBe(true);

    const dispatcher = createDispatcher({
      persistence,
      permissions,
      rateLimiter,
      adapterRegistry,
      logger,
    });
    return { dispatcher, fake };
  }

  it("{ text } calls waitForText, not waitForSelector", async () => {
    const { dispatcher, fake } = await setup();
    const wt = vi.spyOn(fake, "waitForText");
    const ws = vi.spyOn(fake, "waitForSelector");
    const res = await dispatcher.dispatch({
      id: "1",
      toolName: "browser_wait_for",
      params: { text: "Submit" },
      profileId: "default",
      timestamp: new Date().toISOString(),
    });
    expect(res.success).toBe(true);
    expect(wt).toHaveBeenCalledTimes(1);
    expect(ws).not.toHaveBeenCalled();
  });

  it("{ selector } calls waitForSelector, not waitForText", async () => {
    const { dispatcher, fake } = await setup();
    const wt = vi.spyOn(fake, "waitForText");
    const ws = vi.spyOn(fake, "waitForSelector");
    const res = await dispatcher.dispatch({
      id: "2",
      toolName: "browser_wait_for",
      params: { selector: "#btn" },
      profileId: "default",
      timestamp: new Date().toISOString(),
    });
    expect(res.success).toBe(true);
    expect(ws).toHaveBeenCalledTimes(1);
    expect(wt).not.toHaveBeenCalled();
  });

  it("{} returns validation error (400)", async () => {
    const { dispatcher } = await setup();
    const res = await dispatcher.dispatch({
      id: "3",
      toolName: "browser_wait_for",
      params: {},
      profileId: "default",
      timestamp: new Date().toISOString(),
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain("Missing required");
    expect(res.errorCode).toBe(400);
  });

  it("passes caseSensitive: true to waitForText", async () => {
    const { dispatcher, fake } = await setup();
    const wt = vi.spyOn(fake, "waitForText");
    await dispatcher.dispatch({
      id: "4",
      toolName: "browser_wait_for",
      params: { text: "ok", caseSensitive: true },
      profileId: "default",
      timestamp: new Date().toISOString(),
    });
    expect(wt).toHaveBeenCalledWith("ok", { caseSensitive: true }, undefined);
  });
});
