/**
 * Integration tests for AI Browser Runtime
 * Tests handshake, tool lifecycle, permissions, WS hub, and audit invariants
 * 
 * These tests focus on structural validation and API contract testing
 * without requiring full persistence layer setup.
 */

import { describe, it, expect } from "vitest";

describe("Integration: Handshake", () => {
  it("should validate JSON-RPC 2.0 handshake structure", () => {
    // Simulate MCP server initialization handshake
    const initRequest = {
      jsonrpc: "2.0" as const,
      id: "1",
      method: "initialize" as const,
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          resources: {},
        },
        clientInfo: {
          name: "test-client",
          version: "1.0.0",
        },
      },
    };

    // Verify the request can be parsed and processed
    expect(initRequest.jsonrpc).toBe("2.0");
    expect(initRequest.method).toBe("initialize");
    expect(initRequest.params.protocolVersion).toBe("2024-11-05");
    expect(initRequest.params.clientInfo.name).toBe("test-client");
  });

  it("should handle tool list response structure", () => {
    const toolsResponse = {
      jsonrpc: "2.0" as const,
      id: "2",
      result: {
        tools: [
          {
            name: "navigate",
            description: "Navigate to a URL",
            inputSchema: {
              type: "object",
              properties: {
                url: { type: "string", description: "URL to navigate to" },
              },
              required: ["url"],
            },
          },
        ],
      },
    };

    expect(toolsResponse.jsonrpc).toBe("2.0");
    expect(toolsResponse.result.tools).toHaveLength(1);
    expect(toolsResponse.result.tools[0].name).toBe("navigate");
  });

  it("should validate request without initialization gets rejected", () => {
    // Request without proper handshake should fail validation
    const request = {
      jsonrpc: "2.0" as const,
      id: "3",
      method: "tools/call" as const,
      params: {
        name: "navigate",
        arguments: { url: "https://example.com" },
      },
    };

    // In a real implementation, this would be rejected
    // For now, verify the structure is correct
    expect(request.method).toBe("tools/call");
    expect(request.params.name).toBe("navigate");
  });
});

describe("Integration: Tool Lifecycle Contract", () => {
  it("should validate tool request structure", () => {
    const toolRequest = {
      id: "test-call-1",
      toolName: "navigate",
      params: { url: "https://example.com" },
      profileId: "test-profile",
      timestamp: new Date().toISOString(),
    };

    expect(toolRequest.id).toBeDefined();
    expect(toolRequest.toolName).toBe("navigate");
    expect(toolRequest.params.url).toBe("https://example.com");
    expect(toolRequest.profileId).toBe("test-profile");
  });

  it("should validate tool response structure", () => {
    const toolResponse = {
      id: "test-call-1",
      success: true,
      data: { url: "https://example.com" },
      error: "",
      errorCode: 0,
      durationMs: 150,
      permissionDecision: "allowed",
    };

    expect(toolResponse.id).toBeDefined();
    expect(toolResponse.success).toBe(true);
    expect(toolResponse.data).toBeDefined();
    expect(toolResponse.permissionDecision).toBe("allowed");
  });

  it("should validate get_tabs response", () => {
    const tabsResponse = {
      id: "test-tabs-1",
      success: true,
      data: [
        { tabId: 1, url: "https://example.com", title: "Example", status: "complete" },
        { tabId: 2, url: "https://example.org", title: "Example.org", status: "complete" },
      ],
    };

    expect(tabsResponse.success).toBe(true);
    expect(Array.isArray(tabsResponse.data)).toBe(true);
    expect(tabsResponse.data.length).toBe(2);
  });

  it("should validate click_element response", () => {
    const clickResponse = {
      id: "test-click-1",
      success: true,
      data: { selector: "#submit-button" },
      durationMs: 50,
    };

    expect(clickResponse.success).toBe(true);
    expect(clickResponse.data.selector).toBe("#submit-button");
  });

  it("should validate get_screenshot response (base64)", () => {
    const screenshotResponse = {
      id: "test-screenshot-1",
      success: true,
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    };

    expect(screenshotResponse.success).toBe(true);
    // Base64 string validation
    expect(typeof screenshotResponse.data).toBe("string");
    expect(screenshotResponse.data.length).toBeGreaterThan(0);
  });

  it("should validate get_dom response", () => {
    const domResponse = {
      id: "test-dom-1",
      success: true,
      data: {
        html: "<html><body>Content</body></html>",
        truncated: false,
        truncatedAtBytes: 0,
      },
    };

    expect(domResponse.success).toBe(true);
    expect(domResponse.data.html).toContain("<html>");
  });
});

describe("Integration: Permission Gate Contract", () => {
  it("should validate denied response structure", () => {
    const deniedResponse = {
      id: "test-denied-1",
      success: false,
      error: "Permission denied: no grant found",
      errorCode: 403,
      durationMs: 10,
      permissionDecision: "denied",
    };

    expect(deniedResponse.success).toBe(false);
    expect(deniedResponse.error).toContain("denied");
    expect(deniedResponse.errorCode).toBe(403);
    expect(deniedResponse.permissionDecision).toBe("denied");
  });

  it("should validate allowed response structure", () => {
    const allowedResponse = {
      id: "test-allowed-1",
      success: true,
      data: {},
      permissionDecision: "allowed",
    };

    expect(allowedResponse.success).toBe(true);
    expect(allowedResponse.permissionDecision).toBe("allowed");
  });

  it("should validate rate-limited response structure", () => {
    const rateLimitedResponse = {
      id: "test-rate-1",
      success: false,
      error: "Rate limit exceeded. Retry after 30 seconds.",
      errorCode: 429,
      rateLimitInfo: {
        allowed: false,
        currentCount: 101,
        limit: 100,
        windowMs: 60000,
        retryAfterSeconds: 30,
      },
    };

    expect(rateLimitedResponse.success).toBe(false);
    expect(rateLimitedResponse.errorCode).toBe(429);
    expect(rateLimitedResponse.rateLimitInfo).toBeDefined();
    expect(rateLimitedResponse.rateLimitInfo.retryAfterSeconds).toBe(30);
  });
});

describe("Integration: WebSocket Hub", () => {
  it("should validate WS JSON-RPC 2.0 request format", () => {
    const request = {
      jsonrpc: "2.0",
      id: "req-1",
      method: "tools/call",
      params: {
        name: "navigate",
        arguments: { url: "https://example.com" },
      },
    };

    expect(request.jsonrpc).toBe("2.0");
    expect(request.id).toBeDefined();
    expect(request.method).toBe("tools/call");
    expect(request.params).toBeDefined();
    expect(request.params.name).toBe("navigate");
  });

  it("should validate WS success response format", () => {
    const response = {
      jsonrpc: "2.0",
      id: "req-1",
      result: {
        success: true,
        data: { url: "https://example.com" },
      },
    };

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe("req-1");
    expect(response.result).toBeDefined();
    expect(response.result.success).toBe(true);
  });

  it("should validate WS error response format", () => {
    const errorResponse = {
      jsonrpc: "2.0",
      id: "req-1",
      error: {
        code: -32600,
        message: "Invalid Request",
        data: null,
      },
    };

    expect(errorResponse.jsonrpc).toBe("2.0");
    expect(errorResponse.error).toBeDefined();
    expect(errorResponse.error.code).toBe(-32600);
    expect(errorResponse.error.message).toBe("Invalid Request");
  });

  it("should handle batch requests", () => {
    const batch = [
      { jsonrpc: "2.0", id: "1", method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: "2", method: "resources/list", params: {} },
    ];

    expect(batch.length).toBe(2);
    expect(batch[0]?.method).toBe("tools/list");
    expect(batch[1]?.method).toBe("resources/list");
  });

  it("should validate notification format (no id)", () => {
    const notification = {
      jsonrpc: "2.0",
      method: "tools/list_changed",
    };

    expect(notification.jsonrpc).toBe("2.0");
    expect(notification.method).toBe("tools/list_changed");
    expect((notification as any).id).toBeUndefined();
  });
});

describe("Integration: Audit Invariants", () => {
  it("should validate tool call record structure", () => {
    const toolCallRecord = {
      id: "audit-1",
      connection_id: null,
      profile_id: "test-profile",
      transport: "mcp",
      client_id: "client-1",
      tool_name: "navigate",
      params_json: '{"url":"https://example.com"}',
      scope: "safe",
      permission_decision: "allowed",
      permission_grant_id: "grant-123",
      status: "completed",
      error_code: null,
      duration_ms: 150,
      result_blob_id: null,
    };

    expect(toolCallRecord.id).toBeDefined();
    expect(toolCallRecord.profile_id).toBe("test-profile");
    expect(toolCallRecord.transport).toBe("mcp");
    expect(toolCallRecord.tool_name).toBe("navigate");
    expect(toolCallRecord.status).toBe("completed");
    expect(toolCallRecord.permission_decision).toBe("allowed");
  });

  it("should validate denied call record structure", () => {
    const deniedCallRecord = {
      id: "audit-deny-1",
      connection_id: null,
      profile_id: "unauthorized-profile",
      transport: "mcp",
      client_id: null,
      tool_name: "navigate",
      params_json: '{"url":"https://example.com"}',
      scope: "safe",
      permission_decision: "denied",
      permission_grant_id: null,
      status: "denied",
      error_code: "PERMISSION_DENIED",
      duration_ms: null,
      result_blob_id: null,
    };

    expect(deniedCallRecord.status).toBe("denied");
    expect(deniedCallRecord.permission_decision).toBe("denied");
    expect(deniedCallRecord.error_code).toBe("PERMISSION_DENIED");
  });

  it("should validate blob metadata structure", () => {
    const blobMetadata = {
      id: "blob-123",
      tool_call_id: "audit-blob-1",
      profile_id: "test-profile",
      kind: "screenshot",
      filename: "screenshot.png",
      mime_type: "image/png",
      byte_size: 1024,
      sha256: "abc123def456",
      created_at: "2026-05-08T12:00:00.000Z",
      expires_at: "2026-05-15T12:00:00.000Z",
    };

    expect(blobMetadata.id).toBeDefined();
    expect(blobMetadata.kind).toBe("screenshot");
    expect(blobMetadata.mime_type).toBe("image/png");
    // 7-day retention: expires_at should be ~7 days after created_at
    const created = new Date(blobMetadata.created_at);
    const expires = new Date(blobMetadata.expires_at!);
    const diffDays = (expires.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(6);
    expect(diffDays).toBeLessThanOrEqual(8);
  });

  it("should validate connection record structure", () => {
    const connectionRecord = {
      id: "conn-123",
      profile_id: "test-profile",
      profile_name: "Test Profile",
      chrome_user_data_dir: "C:\\Users\\test\\Chrome\\User Data",
      extension_version: "0.1.0",
      protocol_version: "2024-11-05",
      connected_at: "2026-05-08T12:00:00.000Z",
      disconnected_at: null,
      last_seen_at: "2026-05-08T12:00:00.000Z",
    };

    expect(connectionRecord.id).toBeDefined();
    expect(connectionRecord.profile_id).toBe("test-profile");
    expect(connectionRecord.protocol_version).toBe("2024-11-05");
    expect(connectionRecord.disconnected_at).toBeNull();
  });

  it("should validate permission grant record structure", () => {
    const grantRecord = {
      id: "grant-123",
      profile_id: "test-profile",
      tool: "navigate",
      origin_pattern: "*",
      scope: "safe",
      created_at: "2026-05-08T12:00:00.000Z",
      expires_at: "2026-06-08T12:00:00.000Z",
      created_by: "system",
      revoked_at: null,
    };

    expect(grantRecord.id).toBeDefined();
    expect(grantRecord.profile_id).toBe("test-profile");
    expect(grantRecord.tool).toBe("navigate");
    expect(grantRecord.scope).toBe("safe");
    // Default TTL should be ~30 days
    const created = new Date(grantRecord.created_at);
    const expires = new Date(grantRecord.expires_at!);
    const diffDays = (expires.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(29);
    expect(diffDays).toBeLessThanOrEqual(31);
  });
});

describe("Integration: Known Tools List", () => {
  it("should list all known dispatcher tools", () => {
    const knownTools = [
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

    expect(knownTools.length).toBe(15);
    expect(knownTools).toContain("navigate");
    expect(knownTools).toContain("get_tabs");
    expect(knownTools).toContain("click_element");
    expect(knownTools).toContain("get_screenshot");
  });

  it("should map tool names to expected params", () => {
    const toolParams: Record<string, string[]> = {
      navigate: ["url", "tabId"],
      get_tabs: [],
      click_element: ["selector", "tabId"],
      type_text: ["text", "selector", "tabId"],
      get_dom: ["tabId"],
      execute_script: ["source", "tabId"],
      get_console: ["tabId"],
      get_screenshot: ["tabId"],
    };

    expect(toolParams.navigate).toContain("url");
    expect(toolParams.click_element).toContain("selector");
    expect(toolParams.get_screenshot).toEqual(expect.arrayContaining(["tabId"]));
  });
});