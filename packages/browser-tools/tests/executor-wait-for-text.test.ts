/**
 * CommandExecutor.waitForText — polling, timeout, case sensitivity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DevToolsProtocol } from "../src/cdp/client";
import { CommandExecutor } from "../src/cdp/executor";
import { TabManager } from "../src/cdp/tab-manager";
import { createCDPErrorMapper } from "../src/cdp/errors";

/** Build poll responses: each Runtime.evaluate returns whether innerText matches the tool's expression. */
function makeTextPollMock(
  matchesPerCall: boolean[],
  expressionChecker: (expression: string) => boolean
) {
  let i = 0;
  return vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "Target.activateTarget") return { ok: true, value: {} };
    if (method === "Runtime.evaluate") {
      const expression = String(params?.expression ?? "");
      const match = expressionChecker(expression);
      const use = matchesPerCall[i] ?? false;
      i++;
      return { ok: true, value: { result: { value: use && match } } };
    }
    return { ok: true, value: {} };
  });
}

function makeTabs() {
  const tabs = new TabManager();
  tabs.syncTabs([{ targetId: "t1", url: "https://example.com", title: "Ex" }]);
  const first = tabs.getAll()[0];
  if (first) tabs.updateTab(first.tabId, { active: true });
  return tabs;
}

describe("CommandExecutor.waitForText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves ok on first poll when text is already present", async () => {
    const send = makeTextPollMock([true], () => true);
    const ex = new CommandExecutor({
      cdp: { send } as unknown as DevToolsProtocol,
      tabManager: makeTabs(),
      errorMapper: createCDPErrorMapper(),
      defaultTimeout: 2000,
    });
    const p = ex.waitForText("Hello", { timeout: 600 }, undefined);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.ok).toBe(true);
    expect(send.mock.calls.filter((c) => c[0] === "Runtime.evaluate").length).toBe(1);
  });

  it("resolves ok after N polls when DOM updates", async () => {
    const send = makeTextPollMock([false, false, true], (expr) =>
      expr.includes("later") || expr.includes("later".toLowerCase())
    );
    const ex = new CommandExecutor({
      cdp: { send } as unknown as DevToolsProtocol,
      tabManager: makeTabs(),
      errorMapper: createCDPErrorMapper(),
      defaultTimeout: 2000,
    });
    const p = ex.waitForText("later", { timeout: 2000 }, undefined);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.ok).toBe(true);
    expect(send.mock.calls.filter((c) => c[0] === "Runtime.evaluate").length).toBe(3);
  });

  it("returns error whose message mentions timeout when text never appears", async () => {
    const send = makeTextPollMock([], () => false);
    const ex = new CommandExecutor({
      cdp: { send } as unknown as DevToolsProtocol,
      tabManager: makeTabs(),
      errorMapper: createCDPErrorMapper(),
      defaultTimeout: 2000,
    });
    const p = ex.waitForText("nope", { timeout: 400 }, undefined);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error.message).toMatch(/within\s+400ms/i);
  });

  it("caseSensitive false (default): Submit matches submit in DOM", async () => {
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "Target.activateTarget") return { ok: true, value: {} };
      if (method === "Runtime.evaluate") {
        const expr = String(params?.expression ?? "");
        expect(expr).toContain("toLowerCase()");
        expect(expr).toContain("'submit'");
        return { ok: true, value: { result: { value: true } } };
      }
      return { ok: true, value: {} };
    });
    const ex = new CommandExecutor({
      cdp: { send } as unknown as DevToolsProtocol,
      tabManager: makeTabs(),
      errorMapper: createCDPErrorMapper(),
    });
    const p = ex.waitForText("Submit", undefined, undefined);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.ok).toBe(true);
  });

  it("caseSensitive true: Submit does not match submit", async () => {
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "Target.activateTarget") return { ok: true, value: {} };
      if (method === "Runtime.evaluate") {
        const expr = String(params?.expression ?? "");
        expect(expr).not.toContain("toLowerCase()");
        expect(expr).toContain("'Submit'");
        return { ok: true, value: { result: { value: false } } };
      }
      return { ok: true, value: {} };
    });
    const ex = new CommandExecutor({
      cdp: { send } as unknown as DevToolsProtocol,
      tabManager: makeTabs(),
      errorMapper: createCDPErrorMapper(),
      defaultTimeout: 2000,
    });
    const p = ex.waitForText("Submit", { timeout: 400, caseSensitive: true }, undefined);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.ok).toBe(false);
  });
});
