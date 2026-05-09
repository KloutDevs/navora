import { describe, it, expect } from "vitest";
import { createCDPErrorMapper } from "../src/cdp/errors";

describe("CDPErrorMapper", () => {
  const mapper = createCDPErrorMapper();

  describe("DevToolsProtocolError handling", () => {
    it("should map not connected error (code -1)", () => {
      const err = mapper({ code: -1, method: "Page.navigate", message: "not connected" });
      expect(err.message).toContain("not connected");
      expect(err.message).toContain("Page.navigate");
    });

    it("should map timeout error (code -2)", () => {
      const err = mapper({ code: -2, method: "Network.getCookies", message: "timed out" });
      expect(err.message).toContain("timeout");
      expect(err.message).toContain("Network.getCookies");
    });

    it("should map context closed error (code -32000)", () => {
      const err = mapper({ code: -32000, method: "Page.reload", message: "target crashed" });
      expect(err.message).toContain("Context closed");
      expect(err.message).toContain("Page.reload");
    });

    it("should handle generic CDP error", () => {
      const err = mapper({ code: -999, method: "Unknown.method", message: "something went wrong" });
      expect(err.message).toContain("CDP error");
      expect(err.message).toContain("-999");
    });

    it("should handle error without message", () => {
      const err = mapper({ code: -1, method: "Test.method" });
      expect(err.message).toContain("Test.method");
      expect(err.message).toContain("not connected");
    });
  });

  describe("WebSocket errors", () => {
    it("should map timeout WebSocket error", () => {
      const wsError = new Error("WebSocket timeout after 5000ms");
      const err = mapper(wsError);
      expect(err.message).toContain("CDP timeout");
      expect(err.message).toContain("timeout");
    });

    it("should map disconnected WebSocket error", () => {
      const wsError = new Error("WebSocket disconnected");
      const err = mapper(wsError);
      expect(err.message).toContain("Context closed");
    });

    it("should pass through generic Error", () => {
      const err = mapper(new Error("some other error"));
      expect(err.message).toBe("some other error");
    });
  });

  describe("unknown errors", () => {
    it("should stringify unknown type", () => {
      const err = mapper("just a string");
      expect(err.message).toContain("CDP error");
    });

    it("should handle null", () => {
      const err = mapper(null);
      expect(err.message).toContain("CDP error");
    });

    it("should handle undefined", () => {
      const err = mapper(undefined);
      expect(err.message).toContain("CDP error");
    });
  });
});