/**
 * Dispatcher.resolveErrorCode — HTTP-style codes from thrown errors.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CDPError } from "@navora/browser-tools";
import { createLogger } from "@navora/shared";
import { SqlitePersistenceLayer } from "../src/persistence/index";
import { createPermissionStore } from "../src/permissions/permission-store";
import { createAdapterRegistry } from "../src/dispatcher/adapter-registry";
import { createDispatcher } from "../src/dispatcher/pipeline";
import { RateLimiter } from "../src/dispatcher/rate-limiter";

describe("Dispatcher.resolveErrorCode", () => {
  let dir: string;
  let persistence: SqlitePersistenceLayer | null = null;
  const logger = createLogger({ name: "dispatcher-error-codes" });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "navora-errcode-"));
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

  async function makeDispatcher() {
    const dbPath = join(dir, "t.db");
    const blobPath = join(dir, "blobs");
    const open = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(open.ok).toBe(true);
    if (!open.ok) throw open.error;
    persistence = open.value;

    const permissions = createPermissionStore({ persistence });
    const rateLimiter = new RateLimiter({ maxRequests: 10_000, windowMs: 60_000 });
    const adapterRegistry = createAdapterRegistry({});
    const dispatcher = createDispatcher({
      persistence,
      permissions,
      rateLimiter,
      adapterRegistry,
      logger,
    });
    return dispatcher;
  }

  it("maps CDPError codes to HTTP-style status codes", async () => {
    const d = await makeDispatcher();
    const resolve = (d as unknown as { resolveErrorCode(e: unknown): number }).resolveErrorCode.bind(d);
    expect(resolve(new CDPError("x", -1, "m"))).toBe(503);
    expect(resolve(new CDPError("x", -2, "m"))).toBe(504);
    expect(resolve(new CDPError("x", -32000, "m"))).toBe(503);
    expect(resolve(new Error("element not found"))).toBe(404);
    expect(resolve(new Error("selector #btn not found"))).toBe(404);
    expect(resolve(new Error("generic failure"))).toBe(500);
    expect(resolve(42)).toBe(500);
  });
});
