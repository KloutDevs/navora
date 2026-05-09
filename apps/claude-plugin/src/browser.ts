/**
 * browser.ts — routes all browser tool calls through the daemon WebSocket hub.
 * The daemon holds the DirectCDPAdapter and manages per-tab CDP connections.
 */

import { daemonClient } from './daemon-client.js';
import type {
  ToolResult,
  DomResult,
  ScriptResult,
  ConsoleEntry,
  TabInfo,
} from '@navora/browser-tools';

async function call<T>(tool: string, params: Record<string, unknown> = {}): Promise<T> {
  return daemonClient.call(tool, params) as Promise<T>;
}

export async function getTabs(): Promise<TabInfo[]> {
  return call<TabInfo[]>('get_tabs', {});
}

export async function navigate(url: string, tabId?: number): Promise<ToolResult> {
  return call<ToolResult>('navigate', { url, ...(tabId !== undefined && { tabId }) });
}

export async function goBack(tabId?: number): Promise<ToolResult> {
  return call<ToolResult>('go_back', { ...(tabId !== undefined && { tabId }) });
}

export async function reload(tabId?: number): Promise<ToolResult> {
  return call<ToolResult>('reload', { ...(tabId !== undefined && { tabId }) });
}

export async function takeScreenshot(tabId?: number): Promise<string> {
  return call<string>('screenshot', { ...(tabId !== undefined && { tabId }) });
}

export async function extractDom(tabId?: number): Promise<DomResult> {
  return call<DomResult>('get_dom', { ...(tabId !== undefined && { tabId }) });
}

export async function extractText(tabId?: number): Promise<string> {
  return call<string>('get_text', { ...(tabId !== undefined && { tabId }) });
}

export async function clickElement(selector: string, tabId?: number): Promise<ToolResult> {
  return call<ToolResult>('click', { selector, ...(tabId !== undefined && { tabId }) });
}

export async function typeText(text: string, selector?: string, tabId?: number): Promise<ToolResult> {
  return call<ToolResult>('type', {
    text,
    ...(selector !== undefined && { selector }),
    ...(tabId !== undefined && { tabId }),
  });
}

export async function scroll(selector: string | undefined, deltaY: number, tabId?: number): Promise<ToolResult> {
  return call<ToolResult>('scroll', {
    deltaY,
    ...(selector !== undefined && { selector }),
    ...(tabId !== undefined && { tabId }),
  });
}

export async function waitForSelector(selector: string, timeout?: number, tabId?: number): Promise<ToolResult> {
  return call<ToolResult>('wait_for', {
    selector,
    ...(timeout !== undefined && { timeout }),
    ...(tabId !== undefined && { tabId }),
  });
}

export async function executeScript(source: string, tabId?: number): Promise<ScriptResult> {
  return call<ScriptResult>('execute_script', { source, ...(tabId !== undefined && { tabId }) });
}

export async function getConsoleLogs(tabId?: number): Promise<ConsoleEntry[]> {
  return call<ConsoleEntry[]>('get_console', { ...(tabId !== undefined && { tabId }) });
}
