import { describe, it, expect } from "vitest";
import { DevToolsProtocolError } from "../src/cdp/client";
import { CDPError, createCDPErrorMapper, isCDPError, isTransientCDPError } from "../src/cdp/errors";

describe("CDPErrorMapper", () => {
  const mapper = createCDPErrorMapper();

  describe("DevToolsProtocolError handling", () => {
    it("maps real DevToolsProtocolError to CDPError", () => {
      const src = new DevToolsProtocolError("Page.navigate", -32000, "target crashed");
      const err = mapper(src);
      expect(err).toBeInstanceOf(CDPError);
      expect((err as CDPError).code).toBe(-32000);
      expect((err as CDPError).method).toBe("Page.navigate");
      expect(err.message).toContain("Context closed");
    });

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

  describe("isCDPError / isTransientCDPError", () => {
    it("isCDPError is true for CDPError", () => {
      const e = new CDPError("x", -1, "m");
      expect(isCDPError(e)).toBe(true);
    });

    it("isCDPError is false for plain Error", () => {
      expect(isCDPError(new Error("x"))).toBe(false);
    });

    it("isTransientCDPError for transient codes", () => {
      expect(isTransientCDPError(new CDPError("a", -1, "m"))).toBe(true);
      expect(isTransientCDPError(new CDPError("b", -2, "m"))).toBe(true);
      expect(isTransientCDPError(new CDPError("c", -3, "m"))).toBe(true);
      expect(isTransientCDPError(new CDPError("d", -32000, "m"))).toBe(true);
    });

    it("isTransientCDPError false for non-transient CDPError", () => {
      expect(isTransientCDPError(new CDPError("e", -999, "m"))).toBe(false);
    });

    it("isTransientCDPError false for non-CDPError", () => {
      expect(isTransientCDPError(new Error("x"))).toBe(false);
    });
  });
});