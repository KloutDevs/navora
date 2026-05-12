import { defineBackground } from 'wxt/sandbox';
import { getNMClient } from '../background/nm-client';
import { createExtensionStore } from '../background/store';
import type { ConnectionStatus, DomainAllowlist, ExtensionState } from '../shared/types';

const CONTENT_TOOLS = new Set([
  'extractDom', 'extractText', 'clickElement', 'typeText', 'scroll',
  'waitForSelector', 'getConsoleLogs', 'executeScript',
]);

const MUTATING_TOOLS = new Set([
  'navigate', 'goBack', 'reload', 'clickElement', 'typeText', 'scroll', 'executeScript',
]);

type NetworkEntry = {
  id: string; url: string; method: string; status: number; statusText: string;
  headers: Record<string, string>; timestamp: number; tabId: number;
};
const networkBuffer = new Map<number, NetworkEntry[]>();
const MAX_NETWORK_ENTRIES = 500;

export default defineBackground(() => {
  const nmClient = getNMClient();
  const store = createExtensionStore();

  nmClient.connect();

  // Open sidepanel on toolbar icon click (Chrome 116+)
  if (typeof chrome.sidePanel?.setPanelBehavior === 'function') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }

  nmClient.onStatusChange((status: ConnectionStatus) => {
    store.setConnectionStatus(status);
    broadcast({ type: 'CONNECTION_STATUS', payload: status });
    if (status.connected) {
      chrome.alarms.create('nm-keepalive', { periodInMinutes: 1 / 3 }); // fires ~every 20s
    } else {
      chrome.alarms.clear('nm-keepalive');
    }
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'nm-keepalive') {
      chrome.runtime.getPlatformInfo().catch(() => {});
    }
  });

  // Network request buffer (FR-NI)
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (!details.tabId || details.tabId < 0) return;
      const hostname = tryHostname(details.url);
      if (!hostname || hostname === '127.0.0.1' || hostname === 'localhost') return;
      const entries = networkBuffer.get(details.tabId) ?? [];
      entries.push({
        id: `nr_${details.requestId}`,
        url: details.url,
        method: details.method,
        status: details.statusCode,
        statusText: details.statusLine ?? '',
        headers: Object.fromEntries(
          (details.responseHeaders ?? []).map((h) => [h.name.toLowerCase(), h.value ?? ''])
        ),
        timestamp: details.timeStamp,
        tabId: details.tabId,
      });
      if (entries.length > MAX_NETWORK_ENTRIES) entries.splice(0, entries.length - MAX_NETWORK_ENTRIES);
      networkBuffer.set(details.tabId, entries);
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    return true;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidepanel') {
      port.postMessage({ type: 'STATE_UPDATE', payload: store.getState() });
      const unsub = store.subscribe((s: ExtensionState) => {
        port.postMessage({ type: 'STATE_UPDATE', payload: s });
      });
      port.onDisconnect.addListener(() => unsub());
    }
  });

  async function handleMessage(
    message: { type: string; payload?: unknown },
    sender: chrome.runtime.MessageSender,
    sendResponse: (r?: unknown) => void
  ): Promise<void> {
    switch (message.type) {
      case 'GET_STATE':
        sendResponse(store.getState());
        return;

      case 'UPDATE_ALLOWLIST':
        store.setAllowlist(message.payload as DomainAllowlist);
        sendResponse({ success: true });
        return;

      case 'CONFIRM_ACTION': {
        const { id, approved } = message.payload as { id: string; approved: boolean };
        const s = store.getState();
        if (s.pendingConfirmation?.id === id) {
          store.addActivityLog({
            type: 'permission',
            action: approved
              ? `approved_${s.pendingConfirmation.action}`
              : `denied_${s.pendingConfirmation.action}`,
            domain: s.pendingConfirmation.domain,
          });
          store.setPendingConfirmation(null);
        }
        sendResponse({ success: true });
        return;
      }

      case 'EXECUTE_TOOL': {
        const req = message.payload as { method: string; params?: Record<string, unknown> };
        const params = req.params ?? {};
        const senderTabId = sender.tab?.id;
        const senderTabUrl = sender.tab?.url;
        try {
          const result = await dispatchTool(req.method, params, senderTabId, senderTabUrl);
          const actionDomain = senderTabUrl ? tryHostname(senderTabUrl) : undefined;
          store.addActivityLog({
            type: 'action',
            action: req.method,
            ...(actionDomain !== undefined ? { domain: actionDomain } : {}),
          });
          sendResponse({ success: true, result });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const errorDomain = senderTabUrl ? tryHostname(senderTabUrl) : undefined;
          store.addActivityLog({
            type: 'error',
            action: req.method,
            details: errMsg,
            ...(errorDomain !== undefined ? { domain: errorDomain } : {}),
          });
          sendResponse({ success: false, error: { message: errMsg } });
        }
        return;
      }
    }
  }

  async function dispatchTool(
    method: string,
    params: Record<string, unknown>,
    senderTabId?: number,
    senderTabUrl?: string
  ): Promise<unknown> {
    const resolvedTabId = (params['tabId'] as number | undefined) ?? senderTabId;

    // Domain allowlist enforcement (FR-AE-02, FR-PS-02)
    if (MUTATING_TOOLS.has(method)) {
      const targetUrl = (method === 'navigate' ? (params['url'] as string) : undefined) ?? senderTabUrl;
      if (targetUrl) {
        const hostname = tryHostname(targetUrl);
        const { allowlist } = store.getState();
        if (allowlist.enabled && hostname && !allowlist.domains.includes(hostname)) {
          throw new Error(`DOMAIN_NOT_ALLOWED: ${hostname}`);
        }
      }
    }

    switch (method) {
      case 'getTabs':
        return chrome.tabs.query({});

      case 'getActiveTab': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab ?? null;
      }

      case 'navigate': {
        const url = params['url'] as string;
        const tid = resolvedTabId ?? (await activeTabId());
        await chrome.tabs.update(tid, { url });
        return { success: true };
      }

      case 'goBack': {
        const tid = resolvedTabId ?? (await activeTabId());
        await chrome.tabs.goBack(tid);
        return { success: true };
      }

      case 'reload': {
        const tid = resolvedTabId ?? (await activeTabId());
        await chrome.tabs.reload(tid);
        return { success: true };
      }

      case 'takeScreenshot': {
        const tid = resolvedTabId ?? (await activeTabId());
        const tab = await chrome.tabs.get(tid);
        return chrome.tabs.captureVisibleTab(tab.windowId ?? undefined, { format: 'png' });
      }

      case 'getCookies': {
        const domain = params['domain'] as string | undefined;
        return chrome.cookies.getAll(domain ? { domain } : {});
      }

      case 'getNetworkRequests': {
        const filterTabId = (params['tabId'] as number | undefined) ?? resolvedTabId;
        const urlPattern = params['urlPattern'] as string | undefined;
        const reqMethod = params['method'] as string | undefined;
        const since = params['sinceTimestamp'] as number | undefined;
        let entries: NetworkEntry[] = filterTabId
          ? (networkBuffer.get(filterTabId) ?? [])
          : Array.from(networkBuffer.values()).flat();
        if (urlPattern) entries = entries.filter((e) => e.url.includes(urlPattern));
        if (reqMethod) entries = entries.filter((e) => e.method === reqMethod);
        if (since) entries = entries.filter((e) => e.timestamp >= since);
        return entries;
      }
    }

    if (CONTENT_TOOLS.has(method)) {
      const tid = resolvedTabId ?? (await activeTabId());
      return sendToContent(tid, method, params);
    }

    throw new Error(`Unknown tool: ${method}`);
  }

  async function activeTabId(): Promise<number> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    return tab.id;
  }

  function sendToContent(tabId: number, method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'TOOL_REQUEST', method, params }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message ?? 'Content script error'));
          return;
        }
        if (response?.success) {
          resolve(response.result);
        } else {
          reject(new Error(response?.error ?? 'Content script failure'));
        }
      });
    });
  }

  function broadcast(message: unknown): void {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    });
  }

  function tryHostname(url: string): string | undefined {
    try { return new URL(url).hostname; } catch { return undefined; }
  }
});
