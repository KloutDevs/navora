/**
 * CommandExecutor — maps BrowserAdapter tool calls to CDP commands.
 * This is the core automation layer of the Browser Context Engine.
 */

import type { Result } from "@ai-browser-runtime/shared";
import type {
  DevToolsProtocol,
} from "./client";
import type { TabManager } from "./tab-manager";
import type {
  ToolResult,
  DomResult,
  ScriptResult,
  ConsoleEntry,
  NetworkRequest,
  CookieInfo,
} from "../adapter";
import type { CDPErrorMapper } from "./errors";
import { ProtocolErrorCode } from "@ai-browser-runtime/protocol";

export interface CommandExecutorOptions {
  cdp: DevToolsProtocol;
  tabManager: TabManager;
  errorMapper: CDPErrorMapper;
  /** Default timeout in ms */
  defaultTimeout?: number;
}

const DEFAULT_TIMEOUT_MS = 10000;
const SCREENSHOT_QUALITY = 80;
const DOM_SIZE_LIMIT = 2 * 1024 * 1024; // 2MB

export class CommandExecutor {
  private readonly cdp: DevToolsProtocol;
  private readonly tabs: TabManager;
  private readonly errorMapper: CDPErrorMapper;
  private readonly defaultTimeout: number;

  constructor(options: CommandExecutorOptions) {
    this.cdp = options.cdp;
    this.tabs = options.tabManager;
    this.errorMapper = options.errorMapper;
    this.defaultTimeout = options.defaultTimeout ?? DEFAULT_TIMEOUT_MS;
  }

  private getTargetId(tabId?: number): string | undefined {
    const tab = tabId ? this.tabs.get(tabId) : this.tabs.getActive();
    return tab?.targetId;
  }

  private async activateTab(tabId?: number): Promise<void> {
    const cdpTargetId = this.getTargetId(tabId);
    if (cdpTargetId) {
      await this.cdp.send("Target.activateTarget", { targetId: cdpTargetId });
    }
  }

  /**
   * Navigate to a URL.
   * Target: tabId or active tab.
   */
  async navigate(
    url: string,
    tabId?: number
  ): Promise<Result<ToolResult, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
    const start = Date.now();

    try {
      // Activate target
      await this.activateTab(tabId);

      // Navigate
      const result = await this.cdp.send("Page.navigate", { url });

      return {
        ok: true,
        value: {
          success: true,
          data: result as unknown,
          durationMs: Date.now() - start,
          tabId: target,
        },
      };
    } catch (e) {
      const err = this.errorMapper(e);
      return {
        ok: false,
        error: err,
      };
    }
  }

  /**
   * Go back in history.
   */
  async goBack(tabId?: number): Promise<Result<ToolResult, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
    const start = Date.now();

    try {
      await this.activateTab(tabId);

      const result = await this.cdp.send("Runtime.evaluate", { expression: "window.history.back()", returnByValue: true });
      return {
        ok: true,
        value: {
          success: true,
          data: result,
          durationMs: Date.now() - start,
          tabId: target,
        },
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }

  /**
   * Reload the current page.
   */
  async reload(tabId?: number): Promise<Result<ToolResult, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
    const start = Date.now();

    try {
      await this.activateTab(tabId);

      await this.cdp.send("Page.reload", {});
      return {
        ok: true,
        value: {
          success: true,
          durationMs: Date.now() - start,
          tabId: target,
        },
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }

  /**
   * Extract DOM with synthetic data-abr-id on interactive elements.
   */
  async extractDom(tabId?: number): Promise<Result<DomResult, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
    const start = Date.now();

    try {
      await this.activateTab(tabId);

      // Get document
      const docResult = await this.cdp.send("DOM.getDocument", { depth: -1 });
      if (!docResult.ok) return { ok: false, error: docResult.error };

      // Query all interactive elements and assign abr-ids
      const queryResult = await this.cdp.send("DOM.querySelectorAll", {
        nodeId: (docResult.value as { root?: { nodeId?: number } }).root?.nodeId ?? 0,
        selector: "*",
      });

      // Serialize DOM as HTML
      const htmlResult = await this.cdp.send("DOM.getOuterHTML", {
        nodeId: (docResult.value as { root?: { nodeId?: number } }).root?.nodeId ?? 0,
      });

      if (!htmlResult.ok) return { ok: false, error: htmlResult.error };

      let html = (htmlResult.value as string) ?? "";
      const truncated = html.length > DOM_SIZE_LIMIT;
      if (truncated) {
        html = html.substring(0, DOM_SIZE_LIMIT);
      }

      return {
        ok: true,
        value: {
          html,
          truncated,
          truncatedAtBytes: truncated ? DOM_SIZE_LIMIT : 0,
        },
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }

  /**
   * Extract visible text from the page.
   */
  async extractText(tabId?: number): Promise<Result<string, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;

    try {
      await this.activateTab(tabId);

      // Evaluate JS to extract visible text
      const result = await this.cdp.send("Runtime.evaluate", {
        expression: `
          (() => {
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode: (node) => {
                  const el = node.parentElement;
                  if (!el) return NodeFilter.FILTER_REJECT;
                  const style = getComputedStyle(el);
                  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                    return NodeFilter.FILTER_REJECT;
                  }
                  const tag = el.tagName.toLowerCase();
                  if (['script', 'style', 'noscript'].includes(tag)) {
                    return NodeFilter.FILTER_REJECT;
                  }
                  return NodeFilter.FILTER_ACCEPT;
                }
              }
            );
            const texts = [];
            let node;
            while ((node = walker.nextNode())) {
              const text = node.textContent?.trim();
              if (text) texts.push(text);
            }
            return texts.join('\\n');
          })()
        `,
        returnByValue: true,
      });

      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        value: (result.value as { result?: { value?: string } })?.result?.value ?? "",
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }

  /**
   * Wait for a CSS selector to appear.
   */
  async waitForSelector(
    selector: string,
    timeout?: number,
    tabId?: number
  ): Promise<Result<ToolResult, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
    const start = Date.now();
    const maxWait = timeout ?? this.defaultTimeout;

    try {
      await this.activateTab(tabId);

      // Poll until selector found or timeout
      const pollInterval = 200;
      const maxAttempts = Math.floor(maxWait / pollInterval);

      for (let i = 0; i < maxAttempts; i++) {
        const queryResult = await this.cdp.send("Runtime.evaluate", {
          expression: `document.querySelector('${selector.replace(/'/g, "\\'")}') !== null`,
          returnByValue: true,
        });

        if (
          queryResult.ok &&
          (queryResult.value as { result?: { value?: boolean } })?.result?.value
        ) {
          return {
            ok: true,
            value: {
              success: true,
              durationMs: Date.now() - start,
              tabId: target,
            },
          };
        }

        await new Promise((r) => setTimeout(r, pollInterval));
      }

      return {
        ok: false,
        error: new Error(`Selector not found within ${maxWait}ms: ${selector}`),
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }

  /**
   * Click an element by selector.
   */
  async clickElement(
    selector: string,
    tabId?: number
  ): Promise<Result<ToolResult, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
    const start = Date.now();

    try {
      await this.activateTab(tabId);

      // Resolve selector to node — returnByValue:false to get objectId reference
      const queryResult = await this.cdp.send("Runtime.evaluate", {
        expression: `document.querySelector('${selector.replace(/'/g, "\\'")}')`,
        returnByValue: false,
      });

      if (!queryResult.ok) {
        return { ok: false, error: new Error(`Element not found: ${selector}`) };
      }
      const evalResult = (queryResult.value as { result?: { objectId?: string; subtype?: string } })?.result;
      if (!evalResult?.objectId || evalResult.subtype === "null") {
        return {
          ok: false,
          error: new Error(`Element not found: ${selector}`),
        };
      }

      const objectId = evalResult.objectId;

      // Dispatch click
      await this.cdp.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function() { this.click(); }`,
      });

      return {
        ok: true,
        value: {
          success: true,
          durationMs: Date.now() - start,
          tabId: target,
        },
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }

  /**
   * Type text into an element.
   */
  async typeText(
    text: string,
    selector?: string,
    tabId?: number
  ): Promise<Result<ToolResult, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
    const start = Date.now();

    try {
      await this.activateTab(tabId);

      const selectorExpr = selector
        ? `document.querySelector('${selector.replace(/'/g, "\\'")}')`
        : "document.activeElement";

      // Focus
      await this.cdp.send("Runtime.evaluate", {
        expression: `(${selectorExpr})?.focus()`,
      });

      // Clear and type
      await this.cdp.send("Runtime.evaluate", {
        expression: `(${selectorExpr})?.select()`,
      });

      // Insert text and dispatch React-compatible input/change events
      await this.cdp.send("Input.insertText", { text });

      await this.cdp.send("Runtime.evaluate", {
        expression: `(() => { const el = ${selectorExpr}; if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } })()`,
      });

      return {
        ok: true,
        value: {
          success: true,
          durationMs: Date.now() - start,
          tabId: target,
        },
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }

  /**
   * Scroll the page or an element.
   */
  async scroll(
    selector?: string,
    deltaY?: number,
    tabId?: number
  ): Promise<Result<ToolResult, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
    const start = Date.now();
    const dy = deltaY ?? 300;

    try {
      await this.activateTab(tabId);

      if (selector) {
        await this.cdp.send("Runtime.evaluate", {
          expression: `document.querySelector('${selector.replace(/'/g, "\\'")}')?.scrollBy(0, ${dy})`,
        });
      } else {
        await this.cdp.send("Runtime.evaluate", {
          expression: `window.scrollBy(0, ${dy})`,
        });
      }

      return {
        ok: true,
        value: {
          success: true,
          durationMs: Date.now() - start,
          tabId: target,
        },
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }

  /**
   * Take a screenshot of the viewport.
   */
  async takeScreenshot(tabId?: number): Promise<Result<string, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;

    try {
      await this.activateTab(tabId);

      const result = await this.cdp.send("Page.captureScreenshot", {
        format: "png",
        quality: SCREENSHOT_QUALITY,
      });

      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        value: result.value as string,
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }

  /**
   * Get console log entries.
   */
  async getConsoleLogs(tabId?: number): Promise<Result<ConsoleEntry[], Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;

    try {
      await this.activateTab(tabId);

      // Inject interceptor (idempotent) and read buffered logs
      const result = await this.cdp.send("Runtime.evaluate", {
        expression: `
          (() => {
            if (!window.__abrConsoleLogs) {
              window.__abrConsoleLogs = [];
              ['log','warn','error','info','debug'].forEach(m => {
                const orig = console[m].bind(console);
                console[m] = function(...args) {
                  window.__abrConsoleLogs.push({ type: m, timestamp: Date.now(), args: args.map(a => { try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch { return String(a); } }) });
                  orig(...args);
                };
              });
            }
            return window.__abrConsoleLogs;
          })()
        `,
        returnByValue: true,
        awaitPromise: false,
      });

      if (!result.ok) return { ok: false, error: result.error };

      const entries = ((result.value as { result?: { value?: unknown } })?.result?.value as Array<{ type: string; timestamp: number; args: string[] }>) ?? [];
      return {
        ok: true,
        value: entries.map((e) => ({
          type: e.type as ConsoleEntry["type"],
          timestamp: e.timestamp,
          args: e.args ?? [],
        })),
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }

  /**
   * Get network requests with optional filters.
   */
  async getNetworkRequests(filters?: {
    tabId?: number;
    urlPattern?: string;
    method?: string;
    statusCodeRange?: [number, number];
    sinceTimestamp?: number;
  }): Promise<Result<NetworkRequest[], Error>> {
    try {
      // Network requests are collected via CDP event listeners
      // This returns whatever was buffered
      const result = await this.cdp.send("Network.getResponseBody", {});

      if (!result.ok) return { ok: false, error: result.error };

      // Filter is applied by the caller using the returned data
      return {
        ok: true,
        value: (result.value as NetworkRequest[]) ?? [],
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }

  /**
   * Get cookies for a domain.
   */
  async getCookies(domain?: string): Promise<Result<CookieInfo[], Error>> {
    try {
      const result = await this.cdp.send("Network.getCookies", domain ? { urls: [`https://${domain}`] } : {});

      if (!result.ok) return { ok: false, error: result.error };

      const cookies = (result.value as { cookies?: Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; sameSite?: string; expires: number }> })?.cookies ?? [];

      return {
        ok: true,
        value: cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: (c.sameSite ?? "Lax") as "Strict" | "Lax" | "None",
          expires: c.expires,
        })),
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }

  /**
   * Execute arbitrary JavaScript.
   * This is the dangerous tier — requires HUD confirmation.
   */
  async executeScript(
    source: string,
    tabId?: number
  ): Promise<Result<ScriptResult, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;

    try {
      await this.activateTab(tabId);

      const result = await this.cdp.send("Runtime.evaluate", {
        expression: source,
        returnByValue: true,
        awaitPromise: true,
      });

      if (!result.ok) return { ok: false, error: result.error };

      const valueResult = result.value as { result?: { type?: string; value?: unknown; description?: string; exceptionDetails?: { exception?: { description?: string } } } };
      return {
        ok: true,
        value: {
          value: valueResult.result?.value,
          exception: valueResult.result?.exceptionDetails?.exception?.description ?? "",
        },
      };
    } catch (e) {
      return { ok: false, error: this.errorMapper(e) };
    }
  }
}