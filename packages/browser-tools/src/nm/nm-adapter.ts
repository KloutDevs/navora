/**
 * NMAdapter — BrowserAdapter over Native Messaging (ChromeExtensionAdapter / bridge).
 */

import type { NMEnvelope, NMMessage } from "@navora/protocol";
import type { Result } from "@navora/shared";
import { ok, err, isOk } from "@navora/shared";
import { generate as generateUlid } from "@navora/shared";
import type {
  BrowserAdapter,
  BrowserAdapterEventListener,
  AdapterOptions,
  TabInfo,
  ToolResult,
  DomResult,
  ScriptResult,
  ConsoleEntry,
  NetworkRequest,
  CookieInfo,
} from "../adapter";
import type { NMMethod, NMParamMap } from "./nm-types";

/** Daemon/extension NM bridge — implemented by ChromeExtensionAdapter in apps/daemon */
export interface NativeMessagingBridge {
  sendRequest(
    profileId: string,
    request: Omit<NMMessage, "request_id">,
    options?: { requestId?: string; timeoutMs?: number }
  ): Promise<Result<NMEnvelope, Error>>;
  cancelAllRequests?(): number;
}

export interface NMAdapterOptions extends AdapterOptions {
  /** Override default timeouts */
  timeout?: number;
}

export class NMAdapter implements BrowserAdapter {
  private readonly bridge: NativeMessagingBridge;
  private readonly profileId: string;
  private readonly defaultTimeoutMs: number;
  private readonly listeners = new Set<BrowserAdapterEventListener>();
  private closed = false;

  constructor(bridge: NativeMessagingBridge, profileId: string, options?: NMAdapterOptions) {
    this.bridge = bridge;
    this.profileId = profileId;
    this.defaultTimeoutMs = options?.timeout ?? options?.defaultTimeout ?? 30_000;
  }

  async initialize(): Promise<Result<void, Error>> {
    const r = await this.sendNm("ping", {} as NMParamMap["ping"], 5000);
    if (!isOk(r)) return err(r.error);
    const env = r.value;
    if (env.kind !== "response" || !env.success) {
      return err(new Error(env.kind === "error" ? env.message : "Ping failed"));
    }
    return ok(undefined);
  }

  async getTabs(): Promise<Result<TabInfo[], Error>> {
    return this.unwrapNm("tabs/list", {} as NMParamMap["tabs/list"]);
  }

  async getActiveTab(): Promise<Result<TabInfo, Error>> {
    return this.unwrapNm("tabs/active", {} as NMParamMap["tabs/active"]);
  }

  async navigate(url: string, tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.unwrapNm("navigate", { url, tabId } as NMParamMap["navigate"]);
  }

  async goBack(tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.unwrapNm("go_back", { tabId } as NMParamMap["go_back"]);
  }

  async reload(tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.unwrapNm("reload", { tabId } as NMParamMap["reload"]);
  }

  async extractDom(tabId?: number): Promise<Result<DomResult, Error>> {
    return this.unwrapNm("get_dom", { tabId } as NMParamMap["get_dom"]);
  }

  async extractText(tabId?: number): Promise<Result<string, Error>> {
    return this.unwrapNm("get_text", { tabId } as NMParamMap["get_text"]);
  }

  async waitForSelector(
    selector: string,
    timeout?: number,
    tabId?: number
  ): Promise<Result<ToolResult, Error>> {
    return this.unwrapNm("wait_for", { selector, timeout, tabId } as NMParamMap["wait_for"]);
  }

  async waitForText(
    text: string,
    options?: { timeout?: number; caseSensitive?: boolean },
    tabId?: number
  ): Promise<Result<ToolResult, Error>> {
    return this.unwrapNm("wait_for", {
      text,
      timeout: options?.timeout,
      caseSensitive: options?.caseSensitive,
      tabId,
    } as NMParamMap["wait_for"]);
  }

  async clickElement(selector: string, tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.unwrapNm("click", { selector, tabId } as NMParamMap["click"]);
  }

  async typeText(text: string, selector?: string, tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.unwrapNm("type", { text, selector, tabId } as NMParamMap["type"]);
  }

  async scroll(selector?: string, deltaY?: number, tabId?: number): Promise<Result<ToolResult, Error>> {
    return this.unwrapNm("scroll", { selector, deltaY, tabId } as NMParamMap["scroll"]);
  }

  async takeScreenshot(tabId?: number): Promise<Result<string, Error>> {
    return this.unwrapNm("screenshot", { tabId } as NMParamMap["screenshot"]);
  }

  async getConsoleLogs(tabId?: number): Promise<Result<ConsoleEntry[], Error>> {
    return this.unwrapNm("get_console", { tabId } as NMParamMap["get_console"]);
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
    return this.unwrapNm("execute_script", { source, tabId } as NMParamMap["execute_script"]);
  }

  on(listener: BrowserAdapterEventListener): void {
    this.listeners.add(listener);
  }

  off(listener: BrowserAdapterEventListener): void {
    this.listeners.delete(listener);
  }

  async dispose(): Promise<Result<void, Error>> {
    this.closed = true;
    this.bridge.cancelAllRequests?.();
    this.listeners.clear();
    return ok(undefined);
  }

  private async unwrapNm<T>(method: NMMethod, params: Record<string, unknown>): Promise<Result<T, Error>> {
    const r = await this.sendNm(method, params as NMParamMap[typeof method], this.defaultTimeoutMs);
    if (!isOk(r)) return err(r.error);
    const env = r.value;
    if (env.kind !== "response") {
      return err(new Error(`Unexpected envelope kind: ${(env as NMEnvelope).kind}`));
    }
    if (!env.success) {
      const msg = env.error?.message ?? "NM error";
      return err(new Error(msg));
    }
    return ok(env.result as T);
  }

  /** Public for tests — sends NM request with correlation */
  async sendNm<M extends NMMethod>(
    method: M,
    params: NMParamMap[M],
    timeoutMs: number
  ): Promise<Result<NMEnvelope, Error>> {
    if (this.closed) return err(new Error("NMAdapter closed"));

    const requestId = generateUlid();
    const req: Omit<NMMessage, "request_id"> = {
      method,
      params: params as Record<string, unknown>,
    };

    const result = await this.bridge.sendRequest(this.profileId, req, {
      requestId,
      timeoutMs,
    });
    return result;
  }
}
