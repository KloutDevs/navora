/**
 * FakeAdapter — test double for BrowserAdapter.
 * Returns deterministic responses for unit and integration testing.
 */

import type {
  BrowserAdapter,
  BrowserAdapterEvent,
  BrowserAdapterEventListener,
  TabInfo,
  ToolResult,
  DomResult,
  ScriptResult,
  ConsoleEntry,
  NetworkRequest,
  CookieInfo,
} from "./adapter";
import type { Result } from "@navora/shared";

export interface FakeAdapterOptions {
  /** Simulate tab count (default: 2) */
  tabCount?: number;
  /** Simulate connection failure */
  shouldFail?: boolean;
  /** Simulate navigation delay (ms) */
  navigationDelay?: number;
  /** Simulate DOM size (bytes) */
  domSize?: number;
}

/**
 * FakeAdapter implements BrowserAdapter with deterministic, controllable behavior.
 * Ideal for unit tests, integration tests, and offline development.
 *
 * Features:
 * - Configurable tab set
 * - Simulated navigation, clicks, typing
 * - Simulated console/network logs
 * - Error injection for failure mode testing
 * - Event emission support
 */
export class FakeAdapter implements BrowserAdapter {
  private tabs: TabInfo[];
  private activeTabId: number;
  private listeners = new Set<BrowserAdapterEventListener>();
  private disposed = false;
  private shouldFail: boolean;
  private navigationDelay: number;
  private domSize: number;
  private consoleLogs: ConsoleEntry[] = [];
  private networkRequests: NetworkRequest[] = [];
  private cookies: CookieInfo[] = [];

  constructor(options: FakeAdapterOptions = {}) {
    this.shouldFail = options.shouldFail ?? false;
    this.navigationDelay = options.navigationDelay ?? 50;
    this.domSize = options.domSize ?? 1024;

    const count = options.tabCount ?? 2;
    this.tabs = Array.from({ length: count }, (_, i) => ({
      tabId: i + 1,
      url: i === 0 ? "https://example.com" : "https://example.org",
      title: i === 0 ? "Example Domain" : "Example.org",
      favIconUrl: "",
      status: "complete" as const,
      windowId: 1,
      active: i === 0,
    }));
    this.activeTabId = this.tabs[0]?.tabId ?? 1;
  }

  async initialize(): Promise<Result<void, Error>> {
    if (this.disposed) {
      return { ok: false, error: new Error("Adapter already disposed") };
    }
    if (this.shouldFail) {
      return { ok: false, error: new Error("FakeAdapter: simulated init failure") };
    }
    return { ok: true, value: undefined };
  }

  async getTabs(): Promise<Result<TabInfo[], Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    if (this.shouldFail) return { ok: false, error: new Error("FakeAdapter: simulated getTabs failure") };
    return { ok: true, value: [...this.tabs] };
  }

  async getActiveTab(): Promise<Result<TabInfo, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    const active = this.tabs.find((t) => t.tabId === this.activeTabId) ?? this.tabs[0];
    if (!active) return { ok: false, error: new Error("No tabs available") };
    return { ok: true, value: active };
  }

  async navigate(url: string, tabId?: number): Promise<Result<ToolResult, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    if (this.shouldFail) return { ok: false, error: new Error("FakeAdapter: simulated navigate failure") };

    const target = tabId ?? this.activeTabId;
    const start = Date.now();

    if (this.navigationDelay > 0) {
      await new Promise((r) => setTimeout(r, this.navigationDelay));
    }

    // Update tab URL
    const tab = this.tabs.find((t) => t.tabId === target);
    if (tab) {
      tab.url = url;
      tab.status = "complete";
    }

    // Emit tab_navigated event
    this.emit({ type: "tab_navigated", tabId: target, url });

    return {
      ok: true,
      value: {
        success: true,
        durationMs: Date.now() - start,
        tabId: target,
        data: { url },
      },
    };
  }

  async goBack(tabId?: number): Promise<Result<ToolResult, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    const target = tabId ?? this.activeTabId;
    return {
      ok: true,
      value: { success: true, durationMs: 5, tabId: target },
    };
  }

  async reload(tabId?: number): Promise<Result<ToolResult, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    const target = tabId ?? this.activeTabId;
    return {
      ok: true,
      value: { success: true, durationMs: 10, tabId: target },
    };
  }

  async extractDom(tabId?: number): Promise<Result<DomResult, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    if (this.shouldFail) return { ok: false, error: new Error("FakeAdapter: simulated extractDom failure") };

    const html = "<html><body>" + "x".repeat(Math.min(this.domSize, 2 * 1024 * 1024)) + "</body></html>";
    const truncated = this.domSize > 2 * 1024 * 1024;

    return {
      ok: true,
      value: {
        html,
        truncated,
        truncatedAtBytes: truncated ? 2 * 1024 * 1024 : 0,
      },
    };
  }

  async extractText(tabId?: number): Promise<Result<string, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    return { ok: true, value: "Sample extracted text from page" };
  }

  async waitForSelector(selector: string, timeout?: number, tabId?: number): Promise<Result<ToolResult, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    const target = tabId ?? this.activeTabId;
    return {
      ok: true,
      value: { success: true, durationMs: 20, tabId: target, data: { selector } },
    };
  }

  async waitForText(
    _text: string,
    _options?: { timeout?: number; caseSensitive?: boolean },
    tabId?: number
  ): Promise<Result<ToolResult, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    const target = tabId ?? this.activeTabId;
    return { ok: true, value: { success: true, durationMs: 0, tabId: target } };
  }

  async clickElement(selector: string, tabId?: number): Promise<Result<ToolResult, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    if (this.shouldFail) return { ok: false, error: new Error("FakeAdapter: simulated click failure") };

    const target = tabId ?? this.activeTabId;
    const start = Date.now();

    if (this.navigationDelay > 0) {
      await new Promise((r) => setTimeout(r, this.navigationDelay));
    }

    return {
      ok: true,
      value: {
        success: true,
        data: { selector },
        durationMs: Date.now() - start,
        tabId: target,
      },
    };
  }

  async typeText(text: string, selector?: string, tabId?: number): Promise<Result<ToolResult, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    const target = tabId ?? this.activeTabId;
    return {
      ok: true,
      value: {
        success: true,
        data: { text, selector },
        durationMs: 50,
        tabId: target,
      },
    };
  }

  async scroll(selector?: string, deltaY?: number, tabId?: number): Promise<Result<ToolResult, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    const target = tabId ?? this.activeTabId;
    return {
      ok: true,
      value: { success: true, durationMs: 5, tabId: target },
    };
  }

  async takeScreenshot(tabId?: number): Promise<Result<string, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    if (this.shouldFail) return { ok: false, error: new Error("FakeAdapter: simulated screenshot failure") };
    // Return a base64-encoded 1x1 transparent PNG
    return { ok: true, value: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" };
  }

  async getConsoleLogs(tabId?: number): Promise<Result<ConsoleEntry[], Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    return { ok: true, value: this.consoleLogs };
  }

  async getNetworkRequests(filters?: { tabId?: number; urlPattern?: string; method?: string; statusCodeRange?: [number, number]; sinceTimestamp?: number; }): Promise<Result<NetworkRequest[], Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    let filtered = [...this.networkRequests];
    if (filters?.urlPattern) {
      filtered = filtered.filter((r) => r.url.includes(filters.urlPattern!));
    }
    if (filters?.tabId !== undefined) {
      filtered = filtered.filter((r) => r.tabId === filters.tabId);
    }
    return { ok: true, value: filtered };
  }

  async getCookies(domain?: string): Promise<Result<CookieInfo[], Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    if (domain) {
      return { ok: true, value: this.cookies.filter((c) => c.domain.includes(domain)) };
    }
    return { ok: true, value: [...this.cookies] };
  }

  async executeScript(source: string, tabId?: number): Promise<Result<ScriptResult, Error>> {
    if (this.disposed) return { ok: false, error: new Error("Adapter disposed") };
    const target = tabId ?? this.activeTabId;

    // Simulate script execution
    try {
      // In real execution this would run JS; here we return a mock
      return {
        ok: true,
        value: {
          value: `Executed: ${source.substring(0, 50)}...`,
          exception: "",
        },
      };
    } catch (e) {
      return {
        ok: true,
        value: {
          value: undefined,
          exception: String(e),
        },
      };
    }
  }

  on(listener: BrowserAdapterEventListener): void {
    this.listeners.add(listener);
  }

  off(listener: BrowserAdapterEventListener): void {
    this.listeners.delete(listener);
  }

  async dispose(): Promise<Result<void, Error>> {
    if (this.disposed) {
      return { ok: false, error: new Error("Adapter already disposed") };
    }
    this.disposed = true;
    this.listeners.clear();
    this.tabs = [];
    return { ok: true, value: undefined };
  }

  // --- Test helpers (not part of interface) ---

  /** Inject console entries for testing */
  addConsoleEntry(entry: ConsoleEntry): void {
    this.consoleLogs.push(entry);
  }

  /** Inject network requests for testing */
  addNetworkRequest(request: NetworkRequest): void {
    this.networkRequests.push(request);
  }

  /** Inject cookies for testing */
  addCookie(cookie: CookieInfo): void {
    this.cookies.push(cookie);
  }

  /** Add a new tab */
  addTab(tab: TabInfo): void {
    this.tabs.push(tab);
  }

  /** Set active tab */
  setActiveTab(tabId: number): void {
    this.activeTabId = tabId;
  }

  private emit(event: BrowserAdapterEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Swallow listener errors
      }
    }
  }
}