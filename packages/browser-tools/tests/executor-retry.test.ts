/**
 * CommandExecutor.withRetry — transient CDP errors and waitForSelector isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DevToolsProtocol } from "../src/cdp/client";
import { CommandExecutor } from "../src/cdp/executor";
import { TabManager } from "../src/cdp/tab-manager";
import { CDPError, createCDPErrorMapper, isCDPError } from "../src/cdp/errors";

function makeExecutor(cdp: { send: ReturnType<typeof vi.fn> }) {
  const tabs = new TabManager();
  tabs.syncTabs([
    {
      targetId: "t1",
      url: "https://example.com",
      title: "Ex",
    },
  ]);
  const first = tabs.getAll()[0];
  if (first) {
    tabs.updateTab(first.tabId, { active: true });
  }
  return new CommandExecutor({
    cdp: cdp as unknown as DevToolsProtocol,
    tabManager: tabs,
    errorMapper: createCDPErrorMapper(),
    defaultTimeout: 5000,
  });
}

describe("CommandExecutor.withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries on transient CDP (-1) and returns success on second attempt", async () => {
    let nav = 0;
    const send = vi.fn(async (method: string) => {
      if (method === "Target.activateTarget") return { ok: true, value: {} };
      if (method === "Page.navigate") {
        nav++;
        if (nav === 1) {
          return {
            ok: false,
            error: { code: -1, method: "Page.navigate", message: "not connected" },
          };
        }
        return { ok: true, value: {} };
      }
      return { ok: true, value: {} };
    });
    const ex = makeExecutor({ send });
    const p = ex.navigate("https://a.test");
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.ok).toBe(true);
    expect(nav).toBe(2);
  });

  it("returns last transient error after exhausting retries (no throw)", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "Target.activateTarget") return { ok: true, value: {} };
      if (method === "Page.navigate") {
        return {
          ok: false,
          error: { code: -1, method: "Page.navigate", message: "still down" },
        };
      }
      return { ok: true, value: {} };
    });
    const ex = makeExecutor({ send });
    const p = ex.navigate("https://b.test");
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(isCDPError(r.error)).toBe(true);
    expect((r.error as CDPError).code).toBe(-1);
    expect(send.mock.calls.filter((c) => c[0] === "Page.navigate")).toHaveLength(2);
  });

  it("does not retry on non-transient CDP (e.g. -99) — single navigate attempt", async () => {
    let nav = 0;
    const send = vi.fn(async (method: string) => {
      if (method === "Target.activateTarget") return { ok: true, value: {} };
      if (method === "Page.navigate") {
        nav++;
        return { ok: false, error: { code: -99, method: "Page.navigate", message: "bad" } };
      }
      return { ok: true, value: {} };
    });
    const ex = makeExecutor({ send });
    const p = ex.navigate("https://c.test");
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.ok).toBe(false);
    expect((r.error as CDPError).code).toBe(-99);
    expect(nav).toBe(1);
  });

  it("waitForSelector does not use withRetry (no withRetry invocation)", async () => {
    const withRetrySpy = vi.spyOn(CommandExecutor.prototype as unknown as { withRetry: unknown }, "withRetry");
    let evalCalls = 0;
    const send = vi.fn(async (method: string) => {
      if (method === "Target.activateTarget") return { ok: true, value: {} };
      if (method === "Runtime.evaluate") {
        evalCalls++;
        return {
          ok: true,
          value: { result: { value: false } },
        };
      }
      return { ok: true, value: {} };
    });
    const ex = makeExecutor({ send });
    const p = ex.waitForSelector("#missing", 250);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(withRetrySpy).not.toHaveBeenCalled();
    expect(evalCalls).toBeGreaterThan(0);
    withRetrySpy.mockRestore();
  });
});
