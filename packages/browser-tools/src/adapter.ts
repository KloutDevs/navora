/**
 * BrowserAdapter — the core interface for browser automation.
 * All tool handlers receive only the adapter, never Chrome APIs directly.
 * This interface is the single integration point between the daemon and the browser.
 */

import type { Result } from "@navora/shared";

/** Tab information as tracked by the Browser Context Engine */
export interface TabInfo {
  tabId: number;
  /** CDP target UUID — present only in direct-CDP connections (not extension-based) */
  targetId?: string;
  /** CDP WebSocket URL for direct connections — used for per-tab routing */
  wsUrl?: string;
  url: string;
  title: string;
  favIconUrl?: string;
  status: "loading" | "complete" | "pending";
  windowId: number;
  active: boolean;
}

/** Cookie information */
export interface CookieInfo {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None";
  expires: number; // Unix timestamp, -1 for session
}

/** Console log entry */
export interface ConsoleEntry {
  type: "log" | "warn" | "error" | "info" | "debug";
  timestamp: number;
  args: string[];
}

/** Network request entry */
export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  timestamp: number;
  tabId: number;
}

/** DOM extraction result */
export interface DomResult {
  html: string;
  truncated: boolean;
  truncatedAtBytes?: number;
}

/** Script execution result */
export interface ScriptResult {
  value: unknown;
  exception?: string;
}

/** Common tool result shape */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: number;
  durationMs: number;
  tabId: number;
}

/** Browser adapter options */
export interface AdapterOptions {
  /** Default timeout for all operations (ms) */
  defaultTimeout?: number;
  /** CDP WebSocket debug port (default: 9222) */
  cdpPort?: number;
  /** Profile ID for multi-profile routing */
  profileId?: string;
}

/** Event types emitted by the adapter */
export type BrowserAdapterEvent =
  | { type: "tabs_changed"; tabs: TabInfo[] }
  | { type: "tab_navigated"; tabId: number; url: string }
  | { type: "console_entry"; tabId: number; entry: ConsoleEntry }
  | { type: "network_request"; tabId: number; request: NetworkRequest };

/** Event listener signature */
export type BrowserAdapterEventListener = (event: BrowserAdapterEvent) => void;

export interface BrowserAdapter {
  /** Initialize the adapter (connect to CDP, start event listeners) */
  initialize(): Promise<Result<void, Error>>;

  /** Get all open tabs */
  getTabs(): Promise<Result<TabInfo[], Error>>;

  /** Get the currently active tab */
  getActiveTab(): Promise<Result<TabInfo, Error>>;

  /** Navigate to a URL */
  navigate(url: string, tabId?: number): Promise<Result<ToolResult, Error>>;

  /** Go back in history */
  goBack(tabId?: number): Promise<Result<ToolResult, Error>>;

  /** Reload current page */
  reload(tabId?: number): Promise<Result<ToolResult, Error>>;

  /** Extract DOM with data-abr-id attributes on interactive elements */
  extractDom(tabId?: number): Promise<Result<DomResult, Error>>;

  /** Extract visible text from the page */
  extractText(tabId?: number): Promise<Result<string, Error>>;

  /** Wait for a CSS selector to appear */
  waitForSelector(
    selector: string,
    timeout?: number,
    tabId?: number
  ): Promise<Result<ToolResult, Error>>;

  /** Click an element by CSS selector or data-abr-id */
  clickElement(
    selector: string,
    tabId?: number
  ): Promise<Result<ToolResult, Error>>;

  /** Type text into an element */
  typeText(
    text: string,
    selector?: string,
    tabId?: number
  ): Promise<Result<ToolResult, Error>>;

  /** Scroll the page or an element */
  scroll(
    selector?: string,
    deltaY?: number,
    tabId?: number
  ): Promise<Result<ToolResult, Error>>;

  /** Take a screenshot of the viewport */
  takeScreenshot(tabId?: number): Promise<Result<string, Error>>;

  /** Get console log entries for a tab */
  getConsoleLogs(tabId?: number): Promise<Result<ConsoleEntry[], Error>>;

  /** Get network requests with optional filters */
  getNetworkRequests(filters?: {
    tabId?: number;
    urlPattern?: string;
    method?: string;
    statusCodeRange?: [number, number];
    sinceTimestamp?: number;
  }): Promise<Result<NetworkRequest[], Error>>;

  /** Get cookies for a domain */
  getCookies(domain?: string): Promise<Result<CookieInfo[], Error>>;

  /** Execute arbitrary JavaScript */
  executeScript(
    source: string,
    tabId?: number
  ): Promise<Result<ScriptResult, Error>>;

  /** Subscribe to browser events */
  on(listener: BrowserAdapterEventListener): void;

  /** Unsubscribe from browser events */
  off(listener: BrowserAdapterEventListener): void;

  /** Dispose all resources */
  dispose(): Promise<Result<void, Error>>;
}