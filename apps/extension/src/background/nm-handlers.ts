/**
 * NM RPC handlers — one per NMMethod string (matches packages/browser-tools nm-types).
 */

import { resolveTabId, navigateAndWait } from "./tab-resolver";

export type NmHandler = (params: Record<string, unknown>) => Promise<unknown>;

async function injectMain<T>(tabId: number, func: (...args: unknown[]) => T, args: unknown[]): Promise<T> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: func as (...args: never[]) => T,
    args: args as never[],
  });
  const inj = results[0];
  if (!inj) {
    throw new Error("Script injection returned no result");
  }
  const raw = inj as { result?: T; error?: unknown };
  if (raw.error !== undefined && raw.error !== null) {
    throw new Error(String(raw.error));
  }
  return raw.result as T;
}

async function tabInfoFromChrome(tab: chrome.tabs.Tab) {
  return {
    tabId: tab.id ?? 0,
    url: tab.url ?? "",
    title: tab.title ?? "",
    favIconUrl: tab.favIconUrl,
    status: tab.status === "loading" ? ("loading" as const) : tab.status === "complete" ? ("complete" as const) : ("pending" as const),
    windowId: tab.windowId ?? 0,
    active: tab.active ?? false,
  };
}

export const nmHandlers: Record<string, NmHandler> = {
  async ping() {
    return { ok: true as const };
  },

  async "tabs/list"() {
    const tabs = await chrome.tabs.query({});
    return Promise.all(tabs.map((t) => tabInfoFromChrome(t)));
  },

  async "tabs/active"() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const t = tabs[0];
    if (!t?.id) throw new Error("No active tab");
    return tabInfoFromChrome(t);
  },

  async navigate(params) {
    const url = params["url"] as string;
    if (!url) throw new Error("Missing url");
    const tabId = await resolveTabId(params["tabId"] as number | undefined);
    const start = Date.now();
    await navigateAndWait(tabId, url);
    return {
      success: true,
      durationMs: Date.now() - start,
      tabId,
    };
  },

  async go_back(params) {
    const tabId = await resolveTabId(params["tabId"] as number | undefined);
    const start = Date.now();
    await chrome.tabs.goBack(tabId);
    return { success: true, durationMs: Date.now() - start, tabId };
  },

  async reload(params) {
    const tabId = await resolveTabId(params["tabId"] as number | undefined);
    const start = Date.now();
    await chrome.tabs.reload(tabId);
    return { success: true, durationMs: Date.now() - start, tabId };
  },

  async get_dom(params) {
    const tabId = await resolveTabId(params["tabId"] as number | undefined);
    const html = await injectMain(tabId, () => document.documentElement.outerHTML, []);
    const MAX = 2 * 1024 * 1024;
    const truncated = html.length > MAX;
    return {
      html: truncated ? html.slice(0, MAX) : html,
      truncated,
      truncatedAtBytes: truncated ? MAX : undefined,
    };
  },

  async get_text(params) {
    const tabId = await resolveTabId(params["tabId"] as number | undefined);
    return await injectMain(tabId, () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
          const s = window.getComputedStyle(p);
          if (s.display === "none" || s.visibility === "hidden") return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const parts: string[] = [];
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const t = n.textContent?.trim();
        if (t) parts.push(t);
      }
      return parts.join(" ");
    }, []);
  },

  async wait_for(params) {
    const selector = params["selector"] as string;
    const timeout = (params["timeout"] as number) ?? 10000;
    const tabId = await resolveTabId(params["tabId"] as number | undefined);
    const start = Date.now();
    const ok = await injectMain(
      tabId,
      (...args: unknown[]) => {
        const [sel, ms] = args as [string, number];
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          if (document.querySelector(sel)) return true;
        }
        return false;
      },
      [selector, timeout]
    );
    return {
      success: ok,
      durationMs: Date.now() - start,
      tabId,
      error: ok ? undefined : `Timeout waiting for ${selector}`,
    };
  },

  async click(params) {
    const selector = params["selector"] as string;
    const tabId = await resolveTabId(params["tabId"] as number | undefined);
    const start = Date.now();
    await injectMain(
      tabId,
      (...args: unknown[]) => {
        const [sel] = args as [string];
        function resolveEl(s: string): Element | null {
          try {
            const byAbr = document.querySelector(`[data-abr-id="${CSS.escape(s)}"]`);
            if (byAbr) return byAbr;
          } catch {
            /* ignore */
          }
          try {
            return document.querySelector(s);
          } catch {
            return null;
          }
        }
        const el = resolveEl(sel);
        if (!el) throw new Error(`Element not found: ${sel}`);
        (el as HTMLElement).focus();
        (el as HTMLElement).click();
      },
      [selector]
    );
    return { success: true, durationMs: Date.now() - start, tabId };
  },

  async type(params) {
    const text = params["text"] as string;
    const selector = params["selector"] as string | undefined;
    const tabId = await resolveTabId(params["tabId"] as number | undefined);
    const start = Date.now();
    await injectMain(
      tabId,
      (...args: unknown[]) => {
        const [txt, sel] = args as [string, string | undefined];
        const el: Element | null = sel
          ? ((): Element | null => {
              try {
                const byAbr = document.querySelector(`[data-abr-id="${CSS.escape(sel)}"]`);
                if (byAbr) return byAbr;
              } catch {
                /* ignore */
              }
              try {
                return document.querySelector(sel);
              } catch {
                return null;
              }
            })()
          : document.activeElement;
        if (!el || !(el instanceof HTMLElement)) throw new Error("No target element");
        el.focus();
        const inputEl = el as HTMLInputElement;
        const proto =
          inputEl instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        const next = (inputEl.value ?? "") + txt;
        if (setter) setter.call(inputEl, next);
        else inputEl.value = next;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      [text, selector]
    );
    return { success: true, durationMs: Date.now() - start, tabId };
  },

  async scroll(params) {
    const deltaY = (params["deltaY"] as number) ?? 300;
    const selector = params["selector"] as string | undefined;
    const tabId = await resolveTabId(params["tabId"] as number | undefined);
    const start = Date.now();
    await injectMain(
      tabId,
      (...args: unknown[]) => {
        const [dy, sel] = args as [number, string | undefined];
        if (sel) {
          try {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (el) {
              el.scrollBy({ top: dy, behavior: "smooth" });
              return;
            }
          } catch {
            /* fall through */
          }
        }
        window.scrollBy({ top: dy, behavior: "smooth" });
      },
      [deltaY, selector]
    );
    return { success: true, durationMs: Date.now() - start, tabId };
  },

  async screenshot(params) {
    const tabId = await resolveTabId(params["tabId"] as number | undefined);
    const tab = await chrome.tabs.get(tabId);
    const windowId = tab.windowId;
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    return b64;
  },

  async execute_script(params) {
    const source = params["source"] as string;
    const tabId = await resolveTabId(params["tabId"] as number | undefined);
    const result = await injectMain(
      tabId,
      (...args: unknown[]) => {
        const [src] = args as [string];
        try {
          // eslint-disable-next-line no-new-func
          return { value: new Function(`return (${src})`)() };
        } catch (e) {
          return { exception: e instanceof Error ? e.message : String(e) };
        }
      },
      [source]
    );
    const r = result as { value?: unknown; exception?: string };
    if (r.exception) {
      return { value: undefined, exception: r.exception };
    }
    return { value: r.value };
  },

  async get_console(params) {
    const tabId = await resolveTabId(params["tabId"] as number | undefined);
    const logs = await injectMain(
      tabId,
      () => {
        type Level = "log" | "warn" | "error" | "info" | "debug";
        const flush = (window as unknown as { __navoraFlushConsole?: () => Array<{ level: Level; args: string[]; timestamp: number }> })
          .__navoraFlushConsole;
        return flush?.() ?? [];
      },
      []
    );
    return logs.map((entry: { level: string; args: string[]; timestamp: number }) => ({
      type: entry.level as "log" | "warn" | "error" | "info" | "debug",
      timestamp: entry.timestamp,
      args: entry.args,
    }));
  },
};
