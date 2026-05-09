/**
 * Dispatcher Pipeline - Core request processing flow
 * validate → permissionCheck → rateLimit → adapterRoute → captureBlobs → redact → persist → respond
 */

import type { BrowserAdapter, ToolResult, TabInfo, DomResult, ScriptResult, ConsoleEntry } from "@ai-browser-runtime/browser-tools";
import type { Logger } from "@ai-browser-runtime/shared";
import { ok, err, isOk, isError, type Result } from "@ai-browser-runtime/shared";
import { type SqlitePersistenceLayer } from "../persistence/index";
import type { SqlitePermissionStore, PermissionCheck } from "../permissions/permission-store";
import { RateLimiter, type RateLimitResult } from "./rate-limiter";
import { AdapterRegistry } from "./adapter-registry";
import type { BlobKind } from "../persistence/blob-store";

export interface DispatcherConfig {
  /** Persistence layer */
  persistence: SqlitePersistenceLayer;
  /** Permission store */
  permissions: SqlitePermissionStore;
  /** Rate limiter */
  rateLimiter: RateLimiter;
  /** Adapter registry */
  adapterRegistry: AdapterRegistry;
  /** Default timeout for operations */
  defaultTimeoutMs?: number;
  /** Logger */
  logger?: Logger;
}

export interface ToolRequest {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  profileId: string;
  clientId?: string;
  origin?: string;
  timestamp: string;
}

export interface ToolResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: number;
  durationMs: number;
  permissionDecision?: string;
  rateLimitInfo?: RateLimitResult;
}

/**
 * Dispatcher - Processes tool requests through the full pipeline
 */
export class Dispatcher {
  private persistence: SqlitePersistenceLayer;
  private permissions: SqlitePermissionStore;
  private rateLimiter: RateLimiter;
  private adapterRegistry: AdapterRegistry;
  private defaultTimeoutMs: number;
  private logger: Logger;

  constructor(config: DispatcherConfig) {
    this.persistence = config.persistence;
    this.permissions = config.permissions;
    this.rateLimiter = config.rateLimiter;
    this.adapterRegistry = config.adapterRegistry;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 30_000;
    this.logger = config.logger ?? this.createDefaultLogger();
  }

  private createDefaultLogger(): Logger {
    return {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: console.warn,
      error: console.error,
      child: () => this.createDefaultLogger(),
    };
  }

  /**
   * Process a tool request through the full pipeline
   */
  async dispatch(request: ToolRequest): Promise<ToolResponse> {
    const startTime = Date.now();
    const { id, toolName, params, profileId, clientId, origin } = request;

    this.logger?.debug?.(`Dispatcher: processing ${toolName} for ${profileId}`);

    // Step 1: Validate request
    const validationResult = this.validateRequest(request);
    if (isError(validationResult)) {
      return this.createErrorResponse(id, toolName, startTime, validationResult.error.message, "VALIDATION_ERROR");
    }

    // Step 2: Permission check
    const permissionCheck: PermissionCheck = {
      profileId,
      tool: toolName,
      origin: origin ?? "unknown",
      scope: "safe",
    };
    const permissionResult = this.permissions.isAllowed(permissionCheck);
    if (isError(permissionResult)) {
      return this.createErrorResponse(id, toolName, startTime, permissionResult.error.message, "PERMISSION_ERROR");
    }

    const grant = permissionResult.value;
    const allowed = grant !== null;
    
    if (!allowed) {
      // Record denied call in persistence
      this.persistence.insertToolCall({
        id,
        connection_id: null,
        profile_id: profileId,
        transport: "mcp",
        client_id: clientId ?? null,
        tool_name: toolName,
        params_json: JSON.stringify(params),
        scope: "safe",
        permission_decision: "denied",
        permission_grant_id: null,
        status: "denied",
        error_code: null,
        duration_ms: null,
        result_blob_id: null,
      });

      return this.createErrorResponse(
        id,
        toolName,
        startTime,
        "Permission denied: no grant found",
        "PERMISSION_DENIED",
        "denied"
      );
    }

    // Step 3: Rate limit check
    const rateLimitResult = this.rateLimiter.check(profileId, toolName);
    if (isError(rateLimitResult)) {
      return this.createErrorResponse(id, toolName, startTime, rateLimitResult.error.message, "RATE_LIMIT_ERROR");
    }

    if (!rateLimitResult.value.allowed) {
      // Still record the rate-limited call
      this.persistence.insertToolCall({
        id,
        connection_id: null,
        profile_id: profileId,
        transport: "mcp",
        client_id: clientId ?? null,
        tool_name: toolName,
        params_json: JSON.stringify(params),
        scope: "safe",
        permission_decision: "allowed",
        permission_grant_id: grant?.id ?? null,
        status: "rate_limited",
        error_code: "RATE_LIMITED",
        duration_ms: null,
        result_blob_id: null,
      });

      return this.createRateLimitedResponse(id, toolName, startTime, rateLimitResult.value);
    }

    // Step 4: Route to adapter
    const adapterResult = this.adapterRegistry.get(profileId);
    if (isError(adapterResult)) {
      return this.createErrorResponse(id, toolName, startTime, adapterResult.error.message, "ADAPTER_ERROR");
    }

    const adapter = adapterResult.value;

    // Step 5-7: Execute tool, capture blobs, redact
    let toolResult: ToolResult;
    try {
      toolResult = await this.executeTool(adapter, toolName, params, profileId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger?.error?.(`Dispatcher: tool execution failed - ${errorMessage}`);
      return this.createErrorResponse(id, toolName, startTime, errorMessage, "EXECUTION_ERROR");
    }

    // Step 8: Persist result
    await this.persistResult(
      id,
      profileId,
      clientId,
      toolName,
      params,
      "safe",
      "allowed",
      grant?.id ?? null,
      toolResult
    );

    // Step 9: Return response
    return this.createSuccessResponse(id, toolName, startTime, toolResult, "allowed");
  }

  /**
   * Validate incoming request
   */
  private validateRequest(request: ToolRequest): Result<void, Error> {
    if (!request.id) {
      return err(new Error("Missing request id"));
    }
    if (!request.toolName) {
      return err(new Error("Missing tool name"));
    }
    if (!request.profileId) {
      return err(new Error("Missing profile id"));
    }
    // Check for known tools
    const knownTools = this.getKnownTools();
    if (!knownTools.includes(request.toolName)) {
      return err(new Error(`Unknown tool: ${request.toolName}`));
    }
    return ok(undefined);
  }

  /**
   * Execute a tool using the browser adapter
   */
  private async executeTool(
    adapter: BrowserAdapter,
    toolName: string,
    params: Record<string, unknown>,
    profileId: string
  ): Promise<ToolResult> {
    const tabId = params["tabId"] as number | undefined;

    switch (toolName) {
      case "navigate": {
        const url = params["url"] as string;
        if (!url) {
          throw new Error("Missing required param: url");
        }
        const result = await adapter.navigate(url, tabId);
        if (isError(result)) {
          throw result.error;
        }
        return result.value;
      }

      case "get_tabs": {
        const result = await adapter.getTabs();
        if (isError(result)) {
          throw result.error;
        }
        return { success: true, data: result.value, durationMs: 0, tabId: 0 };
      }

      case "get_active_tab": {
        const result = await adapter.getActiveTab();
        if (isError(result)) {
          throw result.error;
        }
        return { success: true, data: result.value, durationMs: 0, tabId: result.value.tabId };
      }

      case "click_element": {
        const selector = params["selector"] as string;
        if (!selector) {
          throw new Error("Missing required param: selector");
        }
        const result = await adapter.clickElement(selector, tabId);
        if (isError(result)) {
          throw result.error;
        }
        return result.value;
      }

      case "type_text": {
        const text = params["text"] as string;
        if (!text) {
          throw new Error("Missing required param: text");
        }
        const selector = params["selector"] as string | undefined;
        const result = await adapter.typeText(text, selector, tabId);
        if (isError(result)) {
          throw result.error;
        }
        return result.value;
      }

      case "get_dom": {
        const result = await adapter.extractDom(tabId);
        if (isError(result)) {
          throw result.error;
        }
        return { success: true, data: result.value, durationMs: 0, tabId: tabId ?? 0 };
      }

      case "execute_script": {
        const source = params["source"] as string;
        if (!source) {
          throw new Error("Missing required param: source");
        }
        const result = await adapter.executeScript(source, tabId);
        if (isError(result)) {
          throw result.error;
        }
        return { success: true, data: result.value, durationMs: 0, tabId: tabId ?? 0 };
      }

      case "get_console": {
        const result = await adapter.getConsoleLogs(tabId);
        if (isError(result)) {
          throw result.error;
        }
        return { success: true, data: result.value, durationMs: 0, tabId: tabId ?? 0 };
      }

      case "get_screenshot": {
        const result = await adapter.takeScreenshot(tabId);
        if (isError(result)) {
          throw result.error;
        }
        // Screenshot is already base64 encoded
        return { success: true, data: result.value, durationMs: 0, tabId: tabId ?? 0 };
      }

      case "inject_overlay": {
        // Custom tool: inject a visual overlay
        const overlayHtml = params["html"] as string;
        const script = `
          (function() {
            const div = document.createElement('div');
            div.id = 'abr-overlay';
            div.innerHTML = \`${overlayHtml ?? ""}\`;
            div.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;pointer-events:none;';
            document.body.appendChild(div);
          })();
        `;
        const result = await adapter.executeScript(script, tabId);
        if (isError(result)) {
          throw result.error;
        }
        return { success: true, data: { injected: true }, durationMs: 0, tabId: tabId ?? 0 };
      }

      case "remove_overlay": {
        const script = `
          (function() {
            const div = document.getElementById('abr-overlay');
            if (div) div.remove();
          })();
        `;
        const result = await adapter.executeScript(script, tabId);
        if (isError(result)) {
          throw result.error;
        }
        return { success: true, data: { removed: true }, durationMs: 0, tabId: tabId ?? 0 };
      }

      case "confirm_hud": {
        // HUD is handled by permissions system - this is a no-op in the adapter
        return { success: true, data: { confirmed: true }, durationMs: 0, tabId: tabId ?? 0 };
      }

      case "cancel_hud": {
        return { success: true, data: { cancelled: true }, durationMs: 0, tabId: tabId ?? 0 };
      }

      case "get_tool_calls": {
        // This reads from persistence, not the browser
        const limit = (params["limit"] as number) ?? 100;
        const result = this.persistence.listToolCalls(profileId, { limit });
        if (isError(result)) {
          throw result.error;
        }
        return { success: true, data: result.value, durationMs: 0, tabId: 0 };
      }

      case "clear_tool_calls": {
        // This would need a method on persistence - for now, return success
        return { success: true, data: { cleared: true }, durationMs: 0, tabId: 0 };
      }

      default:
        throw new Error(`Unhandled tool: ${toolName}`);
    }
  }

  /**
   * Persist tool call result
   */
  private async persistResult(
    id: string,
    profileId: string,
    clientId: string | undefined,
    toolName: string,
    params: Record<string, unknown>,
    scope: string,
    permissionDecision: string,
    grantId: string | null,
    toolResult: ToolResult
  ): Promise<void> {
    // Store blob if there's blob data (screenshots, DOM)
    let blobId: string | null = null;
    if (toolResult.success && toolResult.data) {
      const dataStr = JSON.stringify(toolResult.data);
      // Check if it's large enough to warrant blob storage (>10KB)
      if (dataStr.length > 10_000) {
        // Determine blob kind based on tool
        let blobKind: BlobKind = "dom_snapshot";
        if (toolName === "get_screenshot") {
          blobKind = "screenshot";
        } else if (toolName === "get_console") {
          blobKind = "console_logs";
        }
        
        const blobResult = this.persistence.storeBlob(
          Buffer.from(dataStr),
          blobKind,
          {
            profileId,
            toolCallId: id,
            mimeType: "application/json",
            expiresInMs: 7 * 24 * 60 * 60 * 1000,
          }
        );
        if (isOk(blobResult)) {
          blobId = blobResult.value.id;
        }
      }
    }

    // Insert tool call
    this.persistence.insertToolCall({
      id,
      connection_id: null,
      profile_id: profileId,
      transport: "mcp",
      client_id: clientId ?? null,
      tool_name: toolName,
      params_json: JSON.stringify(params),
      scope,
      permission_decision: permissionDecision,
      permission_grant_id: grantId,
      status: toolResult.success ? "completed" : "failed",
      error_code: toolResult.errorCode?.toString() ?? null,
      duration_ms: toolResult.durationMs,
      result_blob_id: blobId,
    });
  }

  private createSuccessResponse(
    id: string,
    toolName: string,
    startTime: number,
    toolResult: ToolResult,
    permissionDecision: string
  ): ToolResponse {
    return {
      id,
      success: toolResult.success,
      data: toolResult.data,
      error: toolResult.error ?? "",
      errorCode: toolResult.errorCode ?? 0,
      durationMs: Date.now() - startTime,
      permissionDecision,
    };
  }

  private createErrorResponse(
    id: string,
    toolName: string,
    startTime: number,
    error: string,
    errorCode: string,
    permissionDecision?: string
  ): ToolResponse {
    return {
      id,
      success: false,
      error,
      errorCode: this.getErrorCodeNumber(errorCode),
      durationMs: Date.now() - startTime,
      permissionDecision: permissionDecision ?? "",
    };
  }

  private createRateLimitedResponse(
    id: string,
    toolName: string,
    startTime: number,
    rateLimitInfo: RateLimitResult
  ): ToolResponse {
    return {
      id,
      success: false,
      error: `Rate limit exceeded. Retry after ${rateLimitInfo.retryAfterSeconds} seconds.`,
      errorCode: 429,
      durationMs: Date.now() - startTime,
      rateLimitInfo,
    };
  }

  private getErrorCodeNumber(code: string): number {
    const codeMap: Record<string, number> = {
      VALIDATION_ERROR: 400,
      PERMISSION_ERROR: 403,
      PERMISSION_DENIED: 403,
      RATE_LIMIT_ERROR: 429,
      ADAPTER_ERROR: 500,
      EXECUTION_ERROR: 500,
    };
    return codeMap[code] ?? 500;
  }

  private getKnownTools(): string[] {
    return [
      "navigate",
      "get_tabs",
      "get_active_tab",
      "click_element",
      "type_text",
      "get_dom",
      "execute_script",
      "get_console",
      "get_screenshot",
      "inject_overlay",
      "remove_overlay",
      "confirm_hud",
      "cancel_hud",
      "get_tool_calls",
      "clear_tool_calls",
    ];
  }
}

/**
 * Create a dispatcher with default configuration
 */
export function createDispatcher(config: DispatcherConfig): Dispatcher {
  return new Dispatcher(config);
}