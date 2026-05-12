/**
 * Dispatcher routing: nm:* vs cdp:* registry keys and adapter errors.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SqlitePersistenceLayer } from "../src/persistence/index";
import { createPermissionStore } from "../src/permissions/permission-store";
import { createAdapterRegistry } from "../src/dispatcher/adapter-registry";
import { createDispatcher, resolveAdapterRegistryKey, PERSISTENCE_ONLY_TOOLS } from "../src/dispatcher/pipeline";
import { RateLimiter } from "../src/dispatcher/rate-limiter";
import { FakeAdapter } from "@navora/browser-tools";
import { createLogger } from "@navora/shared";
import { ExtensionNotConnectedError, CdpNotAvailableError } from "../src/dispatcher/adapter-errors";

describe("PERSISTENCE_ONLY_TOOLS", () => {
  it("contains all persistence-only tool names", () => {
    expect(PERSISTENCE_ONLY_TOOLS.has("get_tool_calls")).toBe(true);
    expect(PERSISTENCE_ONLY_TOOLS.has("clear_tool_calls")).toBe(true);
    expect(PERSISTENCE_ONLY_TOOLS.has("confirm_hud")).toBe(true);
    expect(PERSISTENCE_ONLY_TOOLS.has("cancel_hud")).toBe(true);
  });

  it("does not contain browser or cdp tools", () => {
    expect(PERSISTENCE_ONLY_TOOLS.has("browser_click")).toBe(false);
    expect(PERSISTENCE_ONLY_TOOLS.has("browser_navigate")).toBe(false);
    expect(PERSISTENCE_ONLY_TOOLS.has("cdp_evaluate")).toBe(false);
  });
});

describe("resolveAdapterRegistryKey", () => {
  it("routes browser_* to nm:<profileId>", () => {
    const r = resolveAdapterRegistryKey("browser_click", "default", 9222);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("nm:default");
  });

  it("routes cdp_* to cdp:<port>", () => {
    const r = resolveAdapterRegistryKey("cdp_evaluate", "ignored", 9222);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("cdp:9222");
  });
});

describe("Dispatcher adapter routing", () => {
  let dir: string;
  let persistence: SqlitePersistenceLayer | null = null;
  const logger = createLogger({ name: "dispatcher-routing-test" });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "navora-disp-"));
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

  async function setupDispatcher(cdpPort = 9222) {
    const dbPath = join(dir, "test.db");
    const blobPath = join(dir, "blobs");
    const open = await SqlitePersistenceLayer.open({ dbPath, blobBasePath: blobPath, logger });
    expect(open.ok).toBe(true);
    if (!open.ok) throw open.error;
    persistence = open.value;

    const permissions = createPermissionStore({ persistence });
    const grantClick = permissions.grant({
      profileId: "default",
      tool: "browser_click",
      originPattern: "unknown",
      scope: "safe",
      createdBy: "test",
    });
    expect(grantClick.ok).toBe(true);

    const grantCdp = permissions.grant({
      profileId: "default",
      tool: "cdp_evaluate",
      originPattern: "unknown",
      scope: "safe",
      createdBy: "test",
    });
    expect(grantCdp.ok).toBe(true);

    const rateLimiter = new RateLimiter({ maxRequests: 10_000, windowMs: 60_000 });
    const adapterRegistry = createAdapterRegistry({});

    const dispatcher = createDispatcher({
      persistence,
      permissions,
      rateLimiter,
      adapterRegistry,
      cdpPort,
      logger,
    });

    return { dispatcher, adapterRegistry };
  }

  it("browser_click without nm adapter returns ExtensionNotConnectedError message", async () => {
    const { dispatcher } = await setupDispatcher();
    const res = await dispatcher.dispatch({
      id: "t1",
      toolName: "browser_click",
      params: { selector: "#btn" },
      profileId: "default",
      timestamp: new Date().toISOString(),
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe(new ExtensionNotConnectedError("default").message);
  });

  it("browser_click with nm:default succeeds", async () => {
    const { dispatcher, adapterRegistry } = await setupDispatcher();
    adapterRegistry.register("nm:default", new FakeAdapter());

    const res = await dispatcher.dispatch({
      id: "t2",
      toolName: "browser_click",
      params: { selector: "#btn" },
      profileId: "default",
      timestamp: new Date().toISOString(),
    });
    expect(res.success).toBe(true);
  });

  it("cdp_evaluate without cdp adapter returns CdpNotAvailableError message", async () => {
    const { dispatcher } = await setupDispatcher(9222);
    const res = await dispatcher.dispatch({
      id: "t3",
      toolName: "cdp_evaluate",
      params: { expression: "1+1" },
      profileId: "default",
      timestamp: new Date().toISOString(),
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe(new CdpNotAvailableError(9222).message);
  });
});
