/**
 * browser.ts — routes tool calls through the ai-browser daemon WebSocket hub.
 */

import { daemonClient } from "./daemon-client.js";
import type {
  ToolResult,
  DomResult,
  ScriptResult,
  ConsoleEntry,
  TabInfo,
} from "@navora/browser-tools";

async function call<T>(tool: string, params: Record<string, unknown> = {}): Promise<T> {
  return daemonClient.call(tool, params) as Promise<T>;
}

export async function getTabs(): Promise<TabInfo[]> {
  return call<TabInfo[]>("browser_get_tabs", {});
}

export async function navigate(url: string, tabId?: number): Promise<ToolResult> {
  return call<ToolResult>("browser_navigate", { url, ...(tabId !== undefined && { tabId }) });
}

export async function goBack(tabId?: number): Promise<ToolResult> {
  return call<ToolResult>("browser_go_back", { ...(tabId !== undefined && { tabId }) });
}

export async function reload(tabId?: number): Promise<ToolResult> {
  return call<ToolResult>("browser_reload", { ...(tabId !== undefined && { tabId }) });
}

export async function takeScreenshot(tabId?: number): Promise<string> {
  return call<string>("browser_screenshot", { ...(tabId !== undefined && { tabId }) });
}

export async function extractDom(tabId?: number): Promise<DomResult> {
  return call<DomResult>("browser_get_dom", { ...(tabId !== undefined && { tabId }) });
}

export async function extractText(tabId?: number): Promise<string> {
  return call<string>("browser_get_text", { ...(tabId !== undefined && { tabId }) });
}

export async function clickElement(selector: string, tabId?: number): Promise<ToolResult> {
  return call<ToolResult>("browser_click", { selector, ...(tabId !== undefined && { tabId }) });
}

export async function typeText(text: string, selector?: string, tabId?: number): Promise<ToolResult> {
  return call<ToolResult>("browser_type", {
    text,
    ...(selector !== undefined && { selector }),
    ...(tabId !== undefined && { tabId }),
  });
}

export async function scroll(selector: string | undefined, deltaY: number, tabId?: number): Promise<ToolResult> {
  return call<ToolResult>("browser_scroll", {
    deltaY,
    ...(selector !== undefined && { selector }),
    ...(tabId !== undefined && { tabId }),
  });
}

export async function waitForSelector(selector: string, timeout?: number, tabId?: number): Promise<ToolResult> {
  return call<ToolResult>("browser_wait_for", {
    selector,
    ...(timeout !== undefined && { timeout }),
    ...(tabId !== undefined && { tabId }),
  });
}

export async function waitForText(text: string, timeout?: number, caseSensitive?: boolean, tabId?: number): Promise<ToolResult> {
  return call<ToolResult>("browser_wait_for", {
    text,
    ...(timeout !== undefined && { timeout }),
    ...(caseSensitive !== undefined && { caseSensitive }),
    ...(tabId !== undefined && { tabId }),
  });
}

export async function executeScript(source: string, tabId?: number): Promise<ScriptResult> {
  return call<ScriptResult>("browser_execute_script", { source, ...(tabId !== undefined && { tabId }) });
}

export async function getConsoleLogs(tabId?: number): Promise<ConsoleEntry[]> {
  return call<ConsoleEntry[]>("browser_get_console", { ...(tabId !== undefined && { tabId }) });
}

export async function cdpEvaluate(expression: string, tabId?: number): Promise<unknown> {
  return call("cdp_evaluate", { expression, ...(tabId !== undefined && { tabId }) });
}

export async function cdpSendCommand(method: string, cdpParams?: Record<string, unknown>, tabId?: number): Promise<unknown> {
  return call("cdp_send_command", {
    method,
    ...(cdpParams !== undefined && { params: cdpParams }),
    ...(tabId !== undefined && { tabId }),
  });
}

export async function cdpNetworkHar(tabId?: number): Promise<unknown> {
  return call("cdp_network_har", { ...(tabId !== undefined && { tabId }) });
}
