/**
 * Native Messaging method contracts — mirrors extension NM handlers.
 */

import type {
  BrowserAdapterEventListener,
  TabInfo,
  ToolResult,
  DomResult,
  ScriptResult,
  ConsoleEntry,
} from "../adapter";

/** NM RPC methods (extension + daemon must agree). Includes internal ping. */
export type NMMethod =
  | "ping"
  | "tabs/list"
  | "tabs/active"
  | "navigate"
  | "go_back"
  | "reload"
  | "get_dom"
  | "get_text"
  | "wait_for"
  | "click"
  | "type"
  | "scroll"
  | "screenshot"
  | "execute_script"
  | "get_console";

type BaseParams = { tabId?: number };

export type NMParamMap = {
  ping: BaseParams & Record<string, never>;
  "tabs/list": BaseParams & Record<string, never>;
  "tabs/active": BaseParams & Record<string, never>;
  navigate: BaseParams & { url: string };
  go_back: BaseParams & Record<string, never>;
  reload: BaseParams & Record<string, never>;
  get_dom: BaseParams & Record<string, never>;
  get_text: BaseParams & Record<string, never>;
  wait_for: BaseParams & {
    selector?: string;
    text?: string;
    timeout?: number;
    caseSensitive?: boolean;
  };
  click: BaseParams & { selector: string };
  type: BaseParams & { text: string; selector?: string };
  scroll: BaseParams & { selector?: string; deltaY?: number };
  screenshot: BaseParams & Record<string, never>;
  execute_script: BaseParams & { source: string };
  get_console: BaseParams & Record<string, never>;
};

export type NMResultMap = {
  ping: { ok: true };
  "tabs/list": TabInfo[];
  "tabs/active": TabInfo;
  navigate: ToolResult;
  go_back: ToolResult;
  reload: ToolResult;
  get_dom: DomResult;
  get_text: string;
  wait_for: ToolResult;
  click: ToolResult;
  type: ToolResult;
  scroll: ToolResult;
  screenshot: string;
  execute_script: ScriptResult;
  get_console: ConsoleEntry[];
};

export type NMHandlerMap = {
  [K in NMMethod]: (
    params: NMParamMap[K]
  ) => Promise<NMResultMap[K]> | NMResultMap[K];
};

/** BrowserAdapter events are not NM RPC — separate subscription channel if needed. */
export type BrowserAdapterEventHandler = BrowserAdapterEventListener;
