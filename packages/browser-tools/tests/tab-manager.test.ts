import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TabManager } from "../src/cdp/tab-manager";
import type { TabInfo } from "../src/adapter";

describe("TabManager", () => {
  let manager: TabManager;

  beforeEach(() => {
    manager = new TabManager();
  });

  describe("syncTabs", () => {
    it("should sync tabs from CDP targets", () => {
      const cdpTabs = [
        { targetId: "1", url: "https://a.com", title: "A" },
        { targetId: "2", url: "https://b.com", title: "B" },
      ];
      manager.syncTabs(cdpTabs);
      const all = manager.getAll();
      expect(all).toHaveLength(2);
      expect(all[0].url).toBe("https://a.com");
      expect(all[1].url).toBe("https://b.com");
    });

    it("should replace existing tabs", () => {
      manager.syncTabs([{ targetId: "1", url: "https://old.com" }]);
      manager.syncTabs([{ targetId: "2", url: "https://new.com" }]);
      const all = manager.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].url).toBe("https://new.com");
    });

    it("should handle empty targets", () => {
      manager.syncTabs([]);
      expect(manager.getAll()).toHaveLength(0);
    });
  });

  describe("updateTab", () => {
    it("should update existing tab", () => {
      manager.syncTabs([{ targetId: "1", url: "https://old.com" }]);
      manager.updateTab(1, { url: "https://new.com", title: "Updated" });
      const tab = manager.get(1);
      expect(tab?.url).toBe("https://new.com");
      expect(tab?.title).toBe("Updated");
    });

    it("should not create tab if not exists", () => {
      manager.updateTab(999, { url: "https://ghost.com" });
      expect(manager.get(999)).toBeUndefined();
    });

    it("should emit tabs_changed on update", () => {
      manager.syncTabs([{ targetId: "1", url: "https://a.com" }]);
      let emittedTabs: TabInfo[] = [];
      manager.onChanged((tabs) => { emittedTabs = tabs; });

      manager.updateTab(1, { url: "https://b.com" });
      expect(emittedTabs).toHaveLength(1);
      expect(emittedTabs[0].url).toBe("https://b.com");
    });
  });

  describe("removeTab", () => {
    it("should remove existing tab", () => {
      manager.syncTabs([{ targetId: "1", url: "https://a.com" }]);
      manager.removeTab(1);
      expect(manager.getAll()).toHaveLength(0);
    });

    it("should not throw for non-existent tab", () => {
      expect(() => manager.removeTab(999)).not.toThrow();
    });
  });

  describe("getAll", () => {
    it("should return all tabs", () => {
      manager.syncTabs([
        { targetId: "1", url: "https://a.com" },
        { targetId: "2", url: "https://b.com" },
        { targetId: "3", url: "https://c.com" },
      ]);
      expect(manager.getAll()).toHaveLength(3);
    });

    it("should return empty array initially", () => {
      expect(manager.getAll()).toHaveLength(0);
    });
  });

  describe("get", () => {
    it("should return tab by ID", () => {
      manager.syncTabs([{ targetId: "42", url: "https://test.com" }]);
      const tab = manager.get(42);
      expect(tab?.url).toBe("https://test.com");
    });

    it("should return undefined for missing tab", () => {
      expect(manager.get(999)).toBeUndefined();
    });
  });

  describe("getActive", () => {
    it("should return first active tab", () => {
      manager.syncTabs([
        { targetId: "1", url: "https://a.com" },
        { targetId: "2", url: "https://b.com" },
      ]);
      manager.updateTab(2, { active: true });
      const active = manager.getActive();
      expect(active?.tabId).toBe(2);
    });

    it("should fallback to first tab if none marked active", () => {
      manager.syncTabs([{ targetId: "1", url: "https://a.com" }]);
      const active = manager.getActive();
      expect(active?.tabId).toBe(1);
    });

    it("should return undefined when empty", () => {
      expect(manager.getActive()).toBeUndefined();
    });
  });

  describe("events", () => {
    it("should emit on syncTabs", () => {
      let emitted = false;
      manager.onChanged(() => { emitted = true; });
      manager.syncTabs([{ targetId: "1" }]);
      expect(emitted).toBe(true);
    });

    it("should emit on removeTab", () => {
      manager.syncTabs([{ targetId: "1" }]);
      let emitted = false;
      manager.onChanged(() => { emitted = true; });
      manager.removeTab(1);
      expect(emitted).toBe(true);
    });

    it("should unsubscribe via offChanged", () => {
      let count = 0;
      const listener = () => { count++; };
      manager.onChanged(listener);
      manager.offChanged(listener);
      manager.syncTabs([{ targetId: "1" }]);
      expect(count).toBe(0);
    });
  });

  describe("clear", () => {
    it("should remove all tabs", () => {
      manager.syncTabs([{ targetId: "1" }, { targetId: "2" }]);
      manager.clear();
      expect(manager.getAll()).toHaveLength(0);
    });

    it("should emit after clear", () => {
      manager.syncTabs([{ targetId: "1" }]);
      let emitted = false;
      manager.onChanged(() => { emitted = true; });
      manager.clear();
      expect(emitted).toBe(true);
    });
  });

  describe("markStale", () => {
    it("should set all tabs to pending status", () => {
      manager.syncTabs([
        { targetId: "1", url: "https://a.com" },
        { targetId: "2", url: "https://b.com" },
      ]);
      manager.markStale();
      const tabs = manager.getAll();
      expect(tabs[0].status).toBe("pending");
      expect(tabs[1].status).toBe("pending");
    });

    it("should emit tabs_changed", () => {
      manager.syncTabs([{ targetId: "1" }]);
      let emitted = false;
      manager.onChanged(() => { emitted = true; });
      manager.markStale();
      expect(emitted).toBe(true);
    });
  });

  describe("count", () => {
    it("should return tab count", () => {
      expect(manager.count).toBe(0);
      manager.syncTabs([{ targetId: "1" }, { targetId: "2" }]);
      expect(manager.count).toBe(2);
    });
  });

  describe("onTabsChanged constructor option", () => {
    it("should call constructor callback", () => {
      let emittedTabs: TabInfo[] = [];
      const manager2 = new TabManager({
        onTabsChanged: (tabs) => { emittedTabs = tabs; },
      });
      manager2.syncTabs([{ targetId: "1", url: "https://test.com" }]);
      expect(emittedTabs).toHaveLength(1);
    });
  });
});