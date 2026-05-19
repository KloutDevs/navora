/**
 * @navora/browser-tools
 * Browser automation tools — BrowserAdapter interface, CDP client, FakeAdapter.
 *
 * Dependency rules (HARD):
 * - browser-tools → protocol, shared (never reverse)
 * - daemon → browser-tools via adapter interface (never import CDP directly)
 * - extension → browser-tools via adapter interface (never import CDP directly)
 */

export type {
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
  AdapterOptions,
} from "./adapter";

// CDP client
export {
  DevToolsProtocol,
  type CDPClientOptions,
  type CDPCommand,
  type CDPResponse,
  type CDPEvent,
  type CDPEventListener,
  DevToolsProtocolError,
} from "./cdp/client";

export {
  TabManager,
  type TabManagerOptions,
} from "./cdp/tab-manager";

export {
  CommandExecutor,
  type CommandExecutorOptions,
} from "./cdp/executor";

export {
  ConnectionManager,
  type ConnectionManagerOptions,
  type TargetInfo,
} from "./cdp/connection";

export {
  CDPError,
  createCDPErrorMapper,
  isCDPError,
  isTransientCDPError,
  mapCDPError,
  type CDPErrorMapper,
} from "./cdp/errors";

// FakeAdapter test double
export { FakeAdapter, type FakeAdapterOptions } from "./fake-adapter";

// DirectCDPAdapter — BrowserAdapter backed by direct CDP connections
export { DirectCDPAdapter, type DirectCDPAdapterOptions } from "./cdp/direct-adapter";

// Native Messaging adapter + NM contracts
export type {
  NMMethod,
  NMParamMap,
  NMResultMap,
  NMHandlerMap,
} from "./nm/nm-types";
export {
  NMAdapter,
  type NativeMessagingBridge,
  type NMAdapterOptions,
} from "./nm/nm-adapter";