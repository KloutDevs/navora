/**
 * CommandExecutor — maps BrowserAdapter tool calls to CDP commands.
 * This is the core automation layer of the Browser Context Engine.
 */

import type { Result } from "@navora/shared";
import { createNoOpLogger, type Logger } from "@navora/shared";
import type { DevToolsProtocol } from "./client";
import type { TabManager } from "./tab-manager";
import type {
  ToolResult,
  DomResult,
  ScriptResult,
  ConsoleEntry,
  NetworkRequest,
  CookieInfo,
} from "../adapter";
import { isCDPError, isTransientCDPError, type CDPErrorMapper } from "./errors";

export interface CommandExecutorOptions {
  cdp: DevToolsProtocol;
  tabManager: TabManager;
  errorMapper: CDPErrorMapper;
  /** Default timeout in ms */
  defaultTimeout?: number;
  logger?: Logger;
}

const DEFAULT_TIMEOUT_MS = 10000;
const SCREENSHOT_QUALITY = 80;
const DOM_SIZE_LIMIT = 2 * 1024 * 1024; // 2MB

export class CommandExecutor {
  private readonly cdp: DevToolsProtocol;
  private readonly tabs: TabManager;
  private readonly errorMapper: CDPErrorMapper;
  private readonly defaultTimeout: number;
  private readonly logger: Logger;

  private readonly MAX_RETRY_ATTEMPTS = 2;
  private readonly RETRY_BACKOFF_MS = [200, 400] as const;

  constructor(options: CommandExecutorOptions) {
    this.cdp = options.cdp;
    this.tabs = options.tabManager;
    this.errorMapper = options.errorMapper;
    this.defaultTimeout = options.defaultTimeout ?? DEFAULT_TIMEOUT_MS;
    this.logger = options.logger ?? createNoOpLogger();
  }

  private async withRetry<T>(
    fn: () => Promise<Result<T, Error>>,
    methodName: string
  ): Promise<Result<T, Error>> {
    let lastResult: Result<T, Error> | undefined;
    for (let attempt = 0; attempt < this.MAX_RETRY_ATTEMPTS; attempt++) {
      const result = await fn();
      if (result.ok || !isTransientCDPError(result.error)) {
        return result;
      }
      lastResult = result;
      const delayMs = this.RETRY_BACKOFF_MS[attempt] ?? 400;
      this.logger.warn("cdp transient error, retrying", {
        method: methodName,
        attempt: attempt + 1,
        code: isCDPError(result.error) ? result.error.code : undefined,
        delayMs,
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
    this.logger.error("cdp retry exhausted", undefined, {
      method: methodName,
      attempts: this.MAX_RETRY_ATTEMPTS,
    });
    return lastResult!;
  }

  private async pollUntil(
    expression: string,
    timeoutMs: number,
    _tabId: number | undefined
  ): Promise<Result<void, Error>> {
    const start = Date.now();
    const pollInterval = 200;
    const maxAttempts = Math.floor(timeoutMs / pollInterval);

    for (let i = 0; i < maxAttempts; i++) {
      const queryResult = await this.cdp.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
      });
      if (
        queryResult.ok &&
        (queryResult.value as { result?: { value?: boolean } })?.result?.value
      ) {
        this.logger.debug("pollUntil matched", {
          expression: expression.slice(0, 60),
          elapsed: Date.now() - start,
        });
        return { ok: true, value: undefined };
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }
    return { ok: false, error: new Error(`Condition not met within ${timeoutMs}ms`) };
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
    return this.withRetry(async () => {
      const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
      const start = Date.now();
      this.logger.debug("navigate", { url, tabId: target });

      try {
        await this.activateTab(tabId);

        const result = await this.cdp.send("Page.navigate", { url });
        if (!result.ok) {
          const err = this.errorMapper(result.error);
          this.logger.error("navigate failed", err, { url, tabId: target });
          return { ok: false, error: err };
        }

        return {
          ok: true,
          value: {
            success: true,
            data: result.value as unknown,
            durationMs: Date.now() - start,
            tabId: target,
          },
        };
      } catch (e) {
        const err = this.errorMapper(e);
        this.logger.error("navigate failed", err, { url, tabId: target });
        return { ok: false, error: err };
      }
    }, "navigate");
  }

  /**
   * Go back in history.
   */
  async goBack(tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.withRetry(async () => {
      const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
      const start = Date.now();
      this.logger.debug("goBack", { tabId: target });

      try {
        await this.activateTab(tabId);

        const result = await this.cdp.send("Runtime.evaluate", {
          expression: "window.history.back()",
          returnByValue: true,
        });
        if (!result.ok) {
          const err = this.errorMapper(result.error);
          this.logger.error("goBack failed", err, { tabId: target });
          return { ok: false, error: err };
        }
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
        const err = this.errorMapper(e);
        this.logger.error("goBack failed", err, { tabId: target });
        return { ok: false, error: err };
      }
    }, "goBack");
  }

  /**
   * Reload the current page.
   */
  async reload(tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.withRetry(async () => {
      const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
      const start = Date.now();
      this.logger.debug("reload", { tabId: target });

      try {
        await this.activateTab(tabId);

        const reloadResult = await this.cdp.send("Page.reload", {});
        if (!reloadResult.ok) {
          const err = this.errorMapper(reloadResult.error);
          this.logger.error("reload failed", err, { tabId: target });
          return { ok: false, error: err };
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
        const err = this.errorMapper(e);
        this.logger.error("reload failed", err, { tabId: target });
        return { ok: false, error: err };
      }
    }, "reload");
  }

  /**
   * Extract DOM with synthetic data-abr-id on interactive elements.
   */
  async extractDom(tabId?: number): Promise<Result<DomResult, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
    this.logger.debug("extractDom", { tabId: target });

    try {
      await this.activateTab(tabId);

      // Get document
      const docResult = await this.cdp.send("DOM.getDocument", { depth: -1 });
      if (!docResult.ok) {
        const err = this.errorMapper(docResult.error);
        this.logger.error("extractDom failed", err, { tabId: target, step: "getDocument" });
        return { ok: false, error: err };
      }

      // Query all interactive elements and assign abr-ids
      const queryResult = await this.cdp.send("DOM.querySelectorAll", {
        nodeId: (docResult.value as { root?: { nodeId?: number } }).root?.nodeId ?? 0,
        selector: "*",
      });

      // Serialize DOM as HTML
      const htmlResult = await this.cdp.send("DOM.getOuterHTML", {
        nodeId: (docResult.value as { root?: { nodeId?: number } }).root?.nodeId ?? 0,
      });

      if (!queryResult.ok) {
        const err = this.errorMapper(queryResult.error);
        this.logger.error("extractDom failed", err, { tabId: target, step: "querySelectorAll" });
        return { ok: false, error: err };
      }

      if (!htmlResult.ok) {
        const err = this.errorMapper(htmlResult.error);
        this.logger.error("extractDom failed", err, { tabId: target, step: "getOuterHTML" });
        return { ok: false, error: err };
      }

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
      const err = this.errorMapper(e);
      this.logger.error("extractDom failed", err, { tabId: target });
      return { ok: false, error: err };
    }
  }

  /**
   * Extract visible text from the page.
   */
  async extractText(tabId?: number): Promise<Result<string, Error>> {
    return this.withRetry(async () => {
      const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
      this.logger.debug("extractText", { tabId: target });

      try {
        await this.activateTab(tabId);

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

        if (!result.ok) {
          const err = this.errorMapper(result.error);
          this.logger.error("extractText failed", err, { tabId: target });
          return { ok: false, error: err };
        }
        return {
          ok: true,
          value: (result.value as { result?: { value?: string } })?.result?.value ?? "",
        };
      } catch (e) {
        const err = this.errorMapper(e);
        this.logger.error("extractText failed", err, { tabId: target });
        return { ok: false, error: err };
      }
    }, "extractText");
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
    this.logger.debug("waitForSelector", { selector, timeout: maxWait, tabId: target });

    try {
      await this.activateTab(tabId);

      const expression = `document.querySelector('${selector.replace(/'/g, "\\'")}') !== null`;
      const pollResult = await this.pollUntil(expression, maxWait, tabId);

      if (pollResult.ok) {
        return {
          ok: true,
          value: {
            success: true,
            durationMs: Date.now() - start,
            tabId: target,
          },
        };
      }

      const err = new Error(`Selector not found within ${maxWait}ms: ${selector}`);
      this.logger.error("waitForSelector failed", err, { selector, tabId: target });
      return { ok: false, error: err };
    } catch (e) {
      const err = this.errorMapper(e);
      this.logger.error("waitForSelector failed", err, { selector, tabId: target });
      return { ok: false, error: err };
    }
  }

  async waitForText(
    text: string,
    options?: { timeout?: number; caseSensitive?: boolean },
    tabId?: number
  ): Promise<Result<void, Error>> {
    const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
    const timeoutMs = options?.timeout ?? this.defaultTimeout;
    const cs = options?.caseSensitive ?? false;

    await this.activateTab(tabId);

    const escaped = text.replace(/'/g, "\\'");
    const expression = cs
      ? `document.body.innerText.includes('${escaped}')`
      : `document.body.innerText.toLowerCase().includes('${escaped.toLowerCase()}')`;

    this.logger.debug("waitForText start", {
      text,
      caseSensitive: cs,
      timeout: timeoutMs,
      tabId: target,
    });

    const result = await this.pollUntil(expression, timeoutMs, tabId);

    if (result.ok) {
      this.logger.info("waitForText found", { text, tabId: target });
    } else {
      this.logger.warn("waitForText timeout", { text, timeout: timeoutMs, tabId: target });
    }

    return result;
  }

  /**
   * Click an element by selector.
   */
  async clickElement(
    selector: string,
    tabId?: number
  ): Promise<Result<ToolResult, Error>> {
    return this.withRetry(async () => {
      const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
      const start = Date.now();
      this.logger.debug("clickElement", { selector, tabId: target });

      try {
        await this.activateTab(tabId);

        const queryResult = await this.cdp.send("Runtime.evaluate", {
          expression: `document.querySelector('${selector.replace(/'/g, "\\'")}')`,
          returnByValue: false,
        });

        if (!queryResult.ok) {
          const err = this.errorMapper(queryResult.error);
          this.logger.error("clickElement failed", err, { selector, tabId: target });
          return { ok: false, error: err };
        }
        const evalResult = (queryResult.value as { result?: { objectId?: string; subtype?: string } })?.result;
        if (!evalResult?.objectId || evalResult.subtype === "null") {
          const err = new Error(`Element not found: ${selector}`);
          this.logger.error("clickElement failed", err, { selector, tabId: target });
          return { ok: false, error: err };
        }

        const objectId = evalResult.objectId;

        const clickResult = await this.cdp.send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: `function() { this.click(); }`,
        });
        if (!clickResult.ok) {
          const err = this.errorMapper(clickResult.error);
          this.logger.error("clickElement failed", err, { selector, tabId: target });
          return { ok: false, error: err };
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
        const err = this.errorMapper(e);
        this.logger.error("clickElement failed", err, { selector, tabId: target });
        return { ok: false, error: err };
      }
    }, "clickElement");
  }

  /**
   * Type text into an element.
   */
  async typeText(
    text: string,
    selector?: string,
    tabId?: number
  ): Promise<Result<ToolResult, Error>> {
    return this.withRetry(async () => {
      const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
      const start = Date.now();
      this.logger.debug("typeText", { tabId: target, hasSelector: Boolean(selector) });

      try {
        await this.activateTab(tabId);

        const selectorExpr = selector
          ? `document.querySelector('${selector.replace(/'/g, "\\'")}')`
          : "document.activeElement";

        const focusResult = await this.cdp.send("Runtime.evaluate", {
          expression: `(${selectorExpr})?.focus()`,
        });
        if (!focusResult.ok) {
          const err = this.errorMapper(focusResult.error);
          this.logger.error("typeText failed", err, { tabId: target });
          return { ok: false, error: err };
        }

        const selectResult = await this.cdp.send("Runtime.evaluate", {
          expression: `(${selectorExpr})?.select()`,
        });
        if (!selectResult.ok) {
          const err = this.errorMapper(selectResult.error);
          this.logger.error("typeText failed", err, { tabId: target });
          return { ok: false, error: err };
        }

        const insertResult = await this.cdp.send("Input.insertText", { text });
        if (!insertResult.ok) {
          const err = this.errorMapper(insertResult.error);
          this.logger.error("typeText failed", err, { tabId: target });
          return { ok: false, error: err };
        }

        const dispatchResult = await this.cdp.send("Runtime.evaluate", {
          expression: `(() => { const el = ${selectorExpr}; if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } })()`,
        });
        if (!dispatchResult.ok) {
          const err = this.errorMapper(dispatchResult.error);
          this.logger.error("typeText failed", err, { tabId: target });
          return { ok: false, error: err };
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
        const err = this.errorMapper(e);
        this.logger.error("typeText failed", err, { tabId: target });
        return { ok: false, error: err };
      }
    }, "typeText");
  }

  /**
   * Scroll the page or an element.
   */
  async scroll(
    selector?: string,
    deltaY?: number,
    tabId?: number
  ): Promise<Result<ToolResult, Error>> {
    return this.withRetry(async () => {
      const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
      const start = Date.now();
      const dy = deltaY ?? 300;
      this.logger.debug("scroll", { tabId: target, hasSelector: Boolean(selector), deltaY: dy });

      try {
        await this.activateTab(tabId);

        const scrollResult = selector
          ? await this.cdp.send("Runtime.evaluate", {
              expression: `document.querySelector('${selector.replace(/'/g, "\\'")}')?.scrollBy(0, ${dy})`,
            })
          : await this.cdp.send("Runtime.evaluate", {
              expression: `window.scrollBy(0, ${dy})`,
            });

        if (!scrollResult.ok) {
          const err = this.errorMapper(scrollResult.error);
          this.logger.error("scroll failed", err, { tabId: target });
          return { ok: false, error: err };
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
        const err = this.errorMapper(e);
        this.logger.error("scroll failed", err, { tabId: target });
        return { ok: false, error: err };
      }
    }, "scroll");
  }

  /**
   * Take a screenshot of the viewport.
   */
  async takeScreenshot(tabId?: number): Promise<Result<string, Error>> {
    return this.withRetry(async () => {
      const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
      this.logger.debug("takeScreenshot", { tabId: target });

      try {
        await this.activateTab(tabId);

        const result = await this.cdp.send("Page.captureScreenshot", {
          format: "png",
          quality: SCREENSHOT_QUALITY,
        });

        if (!result.ok) {
          const err = this.errorMapper(result.error);
          this.logger.error("takeScreenshot failed", err, { tabId: target });
          return { ok: false, error: err };
        }
        return {
          ok: true,
          value: result.value as string,
        };
      } catch (e) {
        const err = this.errorMapper(e);
        this.logger.error("takeScreenshot failed", err, { tabId: target });
        return { ok: false, error: err };
      }
    }, "takeScreenshot");
  }

  /**
   * Get console log entries.
   */
  async getConsoleLogs(tabId?: number): Promise<Result<ConsoleEntry[], Error>> {
    return this.withRetry(async () => {
      const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
      this.logger.debug("getConsoleLogs", { tabId: target });

      try {
        await this.activateTab(tabId);

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

        if (!result.ok) {
          const err = this.errorMapper(result.error);
          this.logger.error("getConsoleLogs failed", err, { tabId: target });
          return { ok: false, error: err };
        }

        const entries =
          ((result.value as { result?: { value?: unknown } })?.result?.value as Array<{
            type: string;
            timestamp: number;
            args: string[];
          }>) ?? [];
        return {
          ok: true,
          value: entries.map((e) => ({
            type: e.type as ConsoleEntry["type"],
            timestamp: e.timestamp,
            args: e.args ?? [],
          })),
        };
      } catch (e) {
        const err = this.errorMapper(e);
        this.logger.error("getConsoleLogs failed", err, { tabId: target });
        return { ok: false, error: err };
      }
    }, "getConsoleLogs");
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
    this.logger.debug("getNetworkRequests", { filters });

    try {
      const result = await this.cdp.send("Network.getResponseBody", {});

      if (!result.ok) {
        const err = this.errorMapper(result.error);
        this.logger.error("getNetworkRequests failed", err, {});
        return { ok: false, error: err };
      }

      return {
        ok: true,
        value: (result.value as NetworkRequest[]) ?? [],
      };
    } catch (e) {
      const err = this.errorMapper(e);
      this.logger.error("getNetworkRequests failed", err, {});
      return { ok: false, error: err };
    }
  }

  /**
   * Get cookies for a domain.
   */
  async getCookies(domain?: string): Promise<Result<CookieInfo[], Error>> {
    this.logger.debug("getCookies", { domain });

    try {
      const result = await this.cdp.send("Network.getCookies", domain ? { urls: [`https://${domain}`] } : {});

      if (!result.ok) {
        const err = this.errorMapper(result.error);
        this.logger.error("getCookies failed", err, { domain });
        return { ok: false, error: err };
      }

      const cookies =
        (
          result.value as {
            cookies?: Array<{
              name: string;
              value: string;
              domain: string;
              path: string;
              secure: boolean;
              httpOnly: boolean;
              sameSite?: string;
              expires: number;
            }>;
          }
        )?.cookies ?? [];

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
      const err = this.errorMapper(e);
      this.logger.error("getCookies failed", err, { domain });
      return { ok: false, error: err };
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
    return this.withRetry(async () => {
      const target = tabId ?? this.tabs.getActive()?.tabId ?? 0;
      this.logger.debug("executeScript", { tabId: target, sourceLength: source.length });

      try {
        await this.activateTab(tabId);

        const result = await this.cdp.send("Runtime.evaluate", {
          expression: source,
          returnByValue: true,
          awaitPromise: true,
        });

        if (!result.ok) {
          const err = this.errorMapper(result.error);
          this.logger.error("executeScript failed", err, { tabId: target });
          return { ok: false, error: err };
        }

        const valueResult = result.value as {
          result?: {
            type?: string;
            value?: unknown;
            description?: string;
            exceptionDetails?: { exception?: { description?: string } };
          };
        };
        return {
          ok: true,
          value: {
            value: valueResult.result?.value,
            exception: valueResult.result?.exceptionDetails?.exception?.description ?? "",
          },
        };
      } catch (e) {
        const err = this.errorMapper(e);
        this.logger.error("executeScript failed", err, { tabId: target });
        return { ok: false, error: err };
      }
    }, "executeScript");
  }
}