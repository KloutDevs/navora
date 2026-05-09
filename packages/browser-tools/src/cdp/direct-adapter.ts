/**
 * DirectCDPAdapter — implements BrowserAdapter via direct CDP WebSocket connections.
 * Uses per-tab DevToolsProtocol + CommandExecutor pool.
 * Designed for plugin-to-daemon routing as the daemon's CDP backend.
 */

import http from 'node:http';
import type {
  BrowserAdapter,
  BrowserAdapterEventListener,
  TabInfo,
  ToolResult,
  DomResult,
  ScriptResult,
  ConsoleEntry,
  NetworkRequest,
  CookieInfo,
} from '../adapter';
import type { Result } from '@navora/shared';
import { ok, err } from '@navora/shared';
import { DevToolsProtocol } from './client';
import { TabManager } from './tab-manager';
import { CommandExecutor } from './executor';
import { createCDPErrorMapper } from './errors';

interface ChromeTarget {
  id: string;
  type: string;
  url: string;
  title?: string;
  webSocketDebuggerUrl?: string;
}

export interface DirectCDPAdapterOptions {
  cdpPort?: number;
  connectTimeout?: number;
}

export class DirectCDPAdapter implements BrowserAdapter {
  private readonly cdpPort: number;
  private readonly connectTimeout: number;
  private readonly tabs = new TabManager();
  private readonly pool = new Map<number, { cdp: DevToolsProtocol; executor: CommandExecutor }>();
  private readonly listeners: Set<BrowserAdapterEventListener> = new Set();

  constructor(options: DirectCDPAdapterOptions = {}) {
    this.cdpPort = options.cdpPort ?? 9222;
    this.connectTimeout = options.connectTimeout ?? 5000;
  }

  async initialize(): Promise<Result<void, Error>> {
    try {
      await this.syncTabs();
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private fetchTargets(): Promise<ChromeTarget[]> {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${this.cdpPort}/json/list`, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(body) as ChromeTarget[]); }
          catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('CDP HTTP timeout')); });
    });
  }

  private async syncTabs(): Promise<void> {
    const targets = await this.fetchTargets();
    const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);

    const currentTargetIds = new Set(pages.map(t => t.id));
    for (const tab of this.tabs.getAll()) {
      if (tab.targetId && !currentTargetIds.has(tab.targetId)) {
        const conn = this.pool.get(tab.tabId);
        if (conn) { void conn.cdp.dispose(); this.pool.delete(tab.tabId); }
      }
    }

    this.tabs.syncTabs(pages.map(t => ({
      targetId: t.id,
      url: t.url,
      title: t.title ?? '',
      ...(t.webSocketDebuggerUrl !== undefined ? { wsUrl: t.webSocketDebuggerUrl } : {}),
    })));
  }

  private async getOrCreateConnection(tabId: number): Promise<CommandExecutor> {
    const existing = this.pool.get(tabId);
    if (existing) return existing.executor;

    const tab = this.tabs.get(tabId);
    if (!tab?.wsUrl) {
      throw new Error(`No WebSocket URL for tabId ${tabId}. Call getTabs() first.`);
    }

    const cdp = new DevToolsProtocol({ url: tab.wsUrl, connectTimeout: this.connectTimeout });
    await cdp.connect();
    const executor = new CommandExecutor({ cdp, tabManager: this.tabs, errorMapper: createCDPErrorMapper() });
    this.pool.set(tabId, { cdp, executor });
    return executor;
  }

  private async resolveTabId(tabId?: number): Promise<number> {
    if (tabId !== undefined) return tabId;
    if (this.tabs.count === 0) await this.syncTabs();
    return this.tabs.getActive()?.tabId ?? 1;
  }

  private async withTab<T>(
    tabId: number | undefined,
    fn: (ex: CommandExecutor, resolved: number) => Promise<Result<T, Error>>
  ): Promise<Result<T, Error>> {
    try {
      const resolved = await this.resolveTabId(tabId);
      const executor = await this.getOrCreateConnection(resolved);
      return fn(executor, resolved);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async getTabs(): Promise<Result<TabInfo[], Error>> {
    try {
      await this.syncTabs();
      return ok(this.tabs.getAll());
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async getActiveTab(): Promise<Result<TabInfo, Error>> {
    try {
      if (this.tabs.count === 0) await this.syncTabs();
      const active = this.tabs.getActive();
      if (!active) return err(new Error('No active tab'));
      return ok(active);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async navigate(url: string, tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.withTab(tabId, (ex) => ex.navigate(url));
  }

  async goBack(tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.withTab(tabId, (ex) => ex.goBack());
  }

  async reload(tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.withTab(tabId, (ex) => ex.reload());
  }

  async extractDom(tabId?: number): Promise<Result<DomResult, Error>> {
    return this.withTab(tabId, (ex) => ex.extractDom());
  }

  async extractText(tabId?: number): Promise<Result<string, Error>> {
    return this.withTab(tabId, (ex) => ex.extractText());
  }

  async waitForSelector(selector: string, timeout?: number, tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.withTab(tabId, (ex) => ex.waitForSelector(selector, timeout));
  }

  async clickElement(selector: string, tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.withTab(tabId, (ex) => ex.clickElement(selector));
  }

  async typeText(text: string, selector?: string, tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.withTab(tabId, (ex) => ex.typeText(text, selector));
  }

  async scroll(selector?: string, deltaY?: number, tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.withTab(tabId, (ex) => ex.scroll(selector, deltaY ?? 0));
  }

  async takeScreenshot(tabId?: number): Promise<Result<string, Error>> {
    return this.withTab(tabId, (ex) => ex.takeScreenshot());
  }

  async getConsoleLogs(tabId?: number): Promise<Result<ConsoleEntry[], Error>> {
    return this.withTab(tabId, (ex) => ex.getConsoleLogs());
  }

  async getNetworkRequests(_filters?: {
    tabId?: number;
    urlPattern?: string;
    method?: string;
    statusCodeRange?: [number, number];
    sinceTimestamp?: number;
  }): Promise<Result<NetworkRequest[], Error>> {
    return ok([]);
  }

  async getCookies(_domain?: string): Promise<Result<CookieInfo[], Error>> {
    return ok([]);
  }

  async executeScript(source: string, tabId?: number): Promise<Result<ScriptResult, Error>> {
    return this.withTab(tabId, (ex) => ex.executeScript(source));
  }

  on(listener: BrowserAdapterEventListener): void {
    this.listeners.add(listener);
  }

  off(listener: BrowserAdapterEventListener): void {
    this.listeners.delete(listener);
  }

  async dispose(): Promise<Result<void, Error>> {
    try {
      for (const [, conn] of this.pool) {
        await conn.cdp.dispose();
      }
      this.pool.clear();
      this.tabs.clear();
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
