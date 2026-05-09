/**
 * TabManager — tracks open tabs and maintains in-memory cache for low-latency reads.
 * Part of the Browser Context Engine (FR-BCE).
 */

import type { TabInfo } from "../adapter";
import type { Result } from "@navora/shared";

export interface TabManagerOptions {
  /** Emit tabs_changed events */
  onTabsChanged?: (tabs: TabInfo[]) => void;
}

/**
 * TabManager maintains an in-memory cache of all open tabs.
 * Tracks by tabId for O(1) lookups. Emits tabs_changed when tabs open/close/update.
 *
 * Thread-safety note: all operations are synchronous and should be called from
 * a single event loop (CDP runs on the main thread in Node.js).
 */
export class TabManager {
  private tabs = new Map<number, TabInfo>();
  private listeners: Array<(tabs: TabInfo[]) => void> = [];
  private nextId = 1;

  constructor(options: TabManagerOptions = {}) {
    if (options.onTabsChanged) {
      this.listeners.push(options.onTabsChanged);
    }
  }

  /**
   * Sync tabs from CDP Tab.targetCreated/Tab.targetDestroyed events.
   */
  syncTabs(cdpTabs: Array<{
    targetId: string;
    url?: string;
    title?: string;
    favIconUrl?: string;
    wsUrl?: string;
  }>): void {
    this.tabs.clear();
    this.nextId = 1;
    for (const tab of cdpTabs) {
      const tabId = this.nextId++;
      const tabInfo: TabInfo = {
        tabId,
        targetId: tab.targetId,
        ...(tab.wsUrl !== undefined ? { wsUrl: tab.wsUrl } : {}),
        url: tab.url ?? "",
        title: tab.title ?? "",
        favIconUrl: tab.favIconUrl !== undefined ? tab.favIconUrl : "",
        status: "complete",
        windowId: 1,
        active: false,
      };
      this.tabs.set(tabId, tabInfo);
    }
    this.emitChanged();
  }

  /**
   * Update a specific tab from CDP Page.navigated events.
   */
  updateTab(tabId: number, updates: Partial<TabInfo>): void {
    const existing = this.tabs.get(tabId);
    if (existing) {
      this.tabs.set(tabId, { ...existing, ...updates });
      this.emitChanged();
    }
  }

  /**
   * Remove a tab.
   */
  removeTab(tabId: number): void {
    if (this.tabs.delete(tabId)) {
      this.emitChanged();
    }
  }

  /**
   * Get all tabs.
   */
  getAll(): TabInfo[] {
    return Array.from(this.tabs.values());
  }

  /**
   * Get a specific tab by ID.
   */
  get(tabId: number): TabInfo | undefined {
    return this.tabs.get(tabId);
  }

  /**
   * Get the active tab (first tab that is marked active).
   */
  getActive(): TabInfo | undefined {
    for (const tab of this.tabs.values()) {
      if (tab.active) return tab;
    }
    // Fallback: return the first tab
    const all = this.getAll();
    return all.length > 0 ? all[0] : undefined;
  }

  /**
   * Subscribe to tab changes.
   */
  onChanged(listener: (tabs: TabInfo[]) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Unsubscribe from tab changes.
   */
  offChanged(listener: (tabs: TabInfo[]) => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  private emitChanged(): void {
    const tabs = this.getAll();
    for (const listener of this.listeners) {
      try {
        listener(tabs);
      } catch {
        // Swallow listener errors
      }
    }
  }

  /**
   * Clear all tabs (on disconnect/stale).
   */
  clear(): void {
    this.tabs.clear();
    this.emitChanged();
  }

  /**
   * Mark all tabs as stale (on NM loss, per FR-BCE-05).
   * Sets status to "pending" for all tabs.
   */
  markStale(): void {
    for (const [tabId, tab] of this.tabs) {
      this.tabs.set(tabId, { ...tab, status: "pending" });
    }
    this.emitChanged();
  }

  get count(): number {
    return this.tabs.size;
  }
}