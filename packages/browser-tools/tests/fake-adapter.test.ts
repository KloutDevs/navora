import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeAdapter, type FakeAdapterOptions } from "../src/fake-adapter";
import type { BrowserAdapter } from "../src/adapter";

describe("FakeAdapter", () => {
  describe("initialization", () => {
    it("should initialize successfully with defaults", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.initialize();
      expect(result.ok).toBe(true);
    });

    it("should fail when shouldFail is set", async () => {
      const adapter = new FakeAdapter({ shouldFail: true });
      const result = await adapter.initialize();
      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain("simulated init failure");
    });
  });

  describe("getTabs", () => {
    it("should return configured tabs", async () => {
      const adapter = new FakeAdapter({ tabCount: 3 });
      const result = await adapter.getTabs();
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: Array<unknown> }).value).toHaveLength(3);
    });

    it("should return default 2 tabs", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.getTabs();
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: Array<unknown> }).value).toHaveLength(2);
    });

    it("should include tab info fields", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.getTabs();
      const tabs = (result as { ok: true; value: Array<{ tabId: number; url: string; title: string }> }).value;
      expect(tabs[0]).toHaveProperty("tabId");
      expect(tabs[0]).toHaveProperty("url");
      expect(tabs[0]).toHaveProperty("title");
      expect(tabs[0]).toHaveProperty("status");
    });

    it("should return error after dispose", async () => {
      const adapter = new FakeAdapter();
      await adapter.dispose();
      const result = await adapter.getTabs();
      expect(result.ok).toBe(false);
    });

    it("should fail when shouldFail is set", async () => {
      const adapter = new FakeAdapter({ shouldFail: true });
      const result = await adapter.getTabs();
      expect(result.ok).toBe(false);
    });
  });

  describe("getActiveTab", () => {
    it("should return first tab by default", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.getActiveTab();
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: { tabId: number } }).value.tabId).toBe(1);
    });

    it("should return configured active tab", async () => {
      const adapter = new FakeAdapter({ tabCount: 5 });
      adapter.setActiveTab(3);
      const result = await adapter.getActiveTab();
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: { tabId: number } }).value.tabId).toBe(3);
    });
  });

  describe("navigate", () => {
    it("should navigate and update URL", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.navigate("https://test.example");
      expect(result.ok).toBe(true);
      const tabs = await adapter.getTabs();
      expect((tabs as { ok: true; value: Array<{ url: string }> }).value[0].url).toBe("https://test.example");
    });

    it("should return success with duration and tabId", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.navigate("https://test.example");
      expect(result.ok).toBe(true);
      const toolResult = (result as { ok: true; value: { success: boolean; durationMs: number; tabId: number } }).value;
      expect(toolResult.success).toBe(true);
      expect(toolResult.durationMs).toBeGreaterThanOrEqual(0);
      expect(toolResult.tabId).toBe(1);
    });

    it("should navigate specific tab", async () => {
      const adapter = new FakeAdapter({ tabCount: 3 });
      const result = await adapter.navigate("https://tab2.example", 2);
      expect(result.ok).toBe(true);
    });

    it("should respect navigation delay", async () => {
      const adapter = new FakeAdapter({ navigationDelay: 100 });
      const start = Date.now();
      await adapter.navigate("https://test.example");
      const duration = Date.now() - start;
      expect(duration).toBeGreaterThanOrEqual(95);
    });

    it("should emit tab_navigated event", async () => {
      const adapter = new FakeAdapter();
      const event = await new Promise<{ type: string; tabId: number; url: string }>((resolve) => {
        adapter.on((e) => {
          if (e.type === "tab_navigated") {
            resolve(e as { type: "tab_navigated"; tabId: number; url: string });
          }
        });
        adapter.navigate("https://event.example");
      });
      expect(event.type).toBe("tab_navigated");
      expect(event.url).toBe("https://event.example");
    });
  });

  describe("goBack", () => {
    it("should return success", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.goBack();
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: { success: boolean } }).value.success).toBe(true);
    });
  });

  describe("reload", () => {
    it("should return success", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.reload();
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: { success: boolean } }).value.success).toBe(true);
    });
  });

  describe("extractDom", () => {
    it("should return HTML", async () => {
      const adapter = new FakeAdapter({ domSize: 100 });
      const result = await adapter.extractDom();
      expect(result.ok).toBe(true);
      const dom = (result as { ok: true; value: { html: string; truncated: boolean } }).value;
      expect(dom.html).toContain("<html>");
      expect(dom.truncated).toBe(false);
    });

    it("should mark as truncated when exceeding 2MB", async () => {
      const adapter = new FakeAdapter({ domSize: 3 * 1024 * 1024 });
      const result = await adapter.extractDom();
      expect(result.ok).toBe(true);
      const dom = (result as { ok: true; value: { truncated: boolean; truncatedAtBytes: number } }).value;
      expect(dom.truncated).toBe(true);
      expect(dom.truncatedAtBytes).toBe(2 * 1024 * 1024);
    });

    it("should fail when shouldFail is set", async () => {
      const adapter = new FakeAdapter({ shouldFail: true });
      const result = await adapter.extractDom();
      expect(result.ok).toBe(false);
    });
  });

  describe("extractText", () => {
    it("should return text", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.extractText();
      expect(result.ok).toBe(true);
      expect(typeof (result as { ok: true; value: string }).value).toBe("string");
    });
  });

  describe("waitForSelector", () => {
    it("should return success with selector info", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.waitForSelector(".test-selector");
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: { data: { selector: string } } }).value.data.selector).toBe(".test-selector");
    });
  });

  describe("clickElement", () => {
    it("should return success with selector info", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.clickElement("#my-button");
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: { success: boolean } }).value.success).toBe(true);
    });

    it("should fail when shouldFail is set", async () => {
      const adapter = new FakeAdapter({ shouldFail: true });
      const result = await adapter.clickElement("#button");
      expect(result.ok).toBe(false);
    });
  });

  describe("typeText", () => {
    it("should return success with text info", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.typeText("hello world", "#my-input");
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: { data: { text: string } } }).value.data.text).toBe("hello world");
    });

    it("should work without selector", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.typeText("hello");
      expect(result.ok).toBe(true);
    });
  });

  describe("scroll", () => {
    it("should return success", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.scroll();
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: { success: boolean } }).value.success).toBe(true);
    });

    it("should accept selector and deltaY", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.scroll(".container", 500);
      expect(result.ok).toBe(true);
    });
  });

  describe("takeScreenshot", () => {
    it("should return base64 PNG", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.takeScreenshot();
      expect(result.ok).toBe(true);
      const data = (result as { ok: true; value: string }).value;
      expect(data).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it("should fail when shouldFail is set", async () => {
      const adapter = new FakeAdapter({ shouldFail: true });
      const result = await adapter.takeScreenshot();
      expect(result.ok).toBe(false);
    });
  });

  describe("getConsoleLogs", () => {
    it("should return empty array by default", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.getConsoleLogs();
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: Array<unknown> }).value).toHaveLength(0);
    });

    it("should return injected entries", async () => {
      const adapter = new FakeAdapter();
      adapter.addConsoleEntry({
        type: "error",
        timestamp: Date.now(),
        args: ["Error: something went wrong"],
      });
      const result = await adapter.getConsoleLogs();
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: Array<{ type: string }> }).value).toHaveLength(1);
      expect((result as { ok: true; value: Array<{ type: string }> }).value[0].type).toBe("error");
    });
  });

  describe("getNetworkRequests", () => {
    it("should return empty array by default", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.getNetworkRequests();
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: Array<unknown> }).value).toHaveLength(0);
    });

    it("should return filtered requests", async () => {
      const adapter = new FakeAdapter();
      adapter.addNetworkRequest({ id: "1", url: "https://api.example.com/data", method: "GET", status: 200, statusText: "OK", headers: {}, timestamp: Date.now(), tabId: 1 });
      adapter.addNetworkRequest({ id: "2", url: "https://other.example.com", method: "POST", status: 201, statusText: "Created", headers: {}, timestamp: Date.now(), tabId: 1 });

      const result = await adapter.getNetworkRequests({ urlPattern: "api.example" });
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: Array<{ url: string }> }).value).toHaveLength(1);
      expect((result as { ok: true; value: Array<{ url: string }> }).value[0].url).toContain("api.example");
    });

    it("should filter by tabId", async () => {
      const adapter = new FakeAdapter({ tabCount: 3 });
      adapter.addNetworkRequest({ id: "1", url: "https://test.com", method: "GET", status: 200, statusText: "OK", headers: {}, timestamp: Date.now(), tabId: 1 });
      adapter.addNetworkRequest({ id: "2", url: "https://test.com", method: "GET", status: 200, statusText: "OK", headers: {}, timestamp: Date.now(), tabId: 2 });

      const result = await adapter.getNetworkRequests({ tabId: 2 });
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: Array<{ tabId: number }> }).value).toHaveLength(1);
      expect((result as { ok: true; value: Array<{ tabId: number }> }).value[0].tabId).toBe(2);
    });
  });

  describe("getCookies", () => {
    it("should return all cookies by default", async () => {
      const adapter = new FakeAdapter();
      adapter.addCookie({ name: "session_id", value: "abc123", domain: "example.com", path: "/", secure: true, httpOnly: false, sameSite: "Lax", expires: -1 });
      const result = await adapter.getCookies();
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: Array<unknown> }).value).toHaveLength(1);
    });

    it("should filter by domain", async () => {
      const adapter = new FakeAdapter();
      adapter.addCookie({ name: "a", value: "1", domain: "example.com", path: "/", secure: false, httpOnly: false, sameSite: "Lax", expires: -1 });
      adapter.addCookie({ name: "b", value: "2", domain: "other.com", path: "/", secure: false, httpOnly: false, sameSite: "Lax", expires: -1 });

      const result = await adapter.getCookies("example.com");
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: Array<{ name: string }> }).value).toHaveLength(1);
      expect((result as { ok: true; value: Array<{ name: string }> }).value[0].name).toBe("a");
    });
  });

  describe("executeScript", () => {
    it("should return script result", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.executeScript("return 42");
      expect(result.ok).toBe(true);
      const scriptResult = (result as { ok: true; value: { value: unknown } }).value;
      expect(scriptResult.value).toContain("Executed:");
    });

    it("should not throw on script error", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.executeScript("throw new Error('test')");
      expect(result.ok).toBe(true);
      expect((result as { ok: true; value: { exception?: string } }).value.exception).toBeDefined();
    });
  });

  describe("events", () => {
    it("should emit to registered listeners", async () => {
      const adapter = new FakeAdapter();
      const receivedEvents: unknown[] = [];
      adapter.on((event) => receivedEvents.push(event));

      await adapter.navigate("https://event.example");
      expect(receivedEvents.length).toBeGreaterThan(0);
    });

    it("should stop emitting after off()", async () => {
      const adapter = new FakeAdapter();
      const receivedEvents: unknown[] = [];
      const listener = (event: unknown) => receivedEvents.push(event);
      adapter.on(listener);
      adapter.off(listener);

      await adapter.navigate("https://event.example");
      expect(receivedEvents).toHaveLength(0);
    });
  });

  describe("dispose", () => {
    it("should dispose successfully", async () => {
      const adapter = new FakeAdapter();
      const result = await adapter.dispose();
      expect(result.ok).toBe(true);
    });

    it("should return error on double dispose", async () => {
      const adapter = new FakeAdapter();
      await adapter.dispose();
      const result = await adapter.dispose();
      expect(result.ok).toBe(false);
    });
  });

  describe("test helpers", () => {
    it("should add and set active tab", async () => {
      const adapter = new FakeAdapter({ tabCount: 1 });
      adapter.addTab({ tabId: 99, url: "https://new.tab", title: "New Tab", status: "complete", windowId: 1, active: false });
      adapter.setActiveTab(99);

      const tabs = await adapter.getTabs();
      expect((tabs as { ok: true; value: Array<unknown> }).value).toHaveLength(2);

      const active = await adapter.getActiveTab();
      expect((active as { ok: true; value: { tabId: number } }).value.tabId).toBe(99);
    });
  });
});