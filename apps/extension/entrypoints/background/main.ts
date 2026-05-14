/**
 * Background Service Worker Entry Point
 */

import { initActivityLog, addEntry, summarizeToolParams, extractProfile, clearLog } from '../../src/background/activity-log';
import { getNMClient } from '../../src/background/nm-client';
import { createExtensionStore } from '../../src/background/store';
import type { ConnectionStatus, DomainAllowlist } from '../../src/shared/types';

export default defineBackground(() => {
  const nmClient = getNMClient();
  const store = createExtensionStore();

  void initActivityLog().then(() => {
    nmClient.connect();
  });

  // Connection status listener
  nmClient.onStatusChange((status: ConnectionStatus) => {
    store.setConnectionStatus(status);
    broadcastToAll({ type: 'CONNECTION_STATUS', payload: status });
  });

  // Keepalive
  chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepalive') {
      chrome.runtime.getPlatformInfo().catch(() => {});
    }
  });

  // Message listener
  chrome.runtime.onMessage.addListener((message: { type: string; payload?: unknown }, sender, sendResponse) => {
    handleMessage(message as { type: string; payload?: Record<string, unknown> }, sender, sendResponse);
    return true;
  });

  // Port listener for sidepanel
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidepanel') {
      port.postMessage({ type: 'STATE_UPDATE', payload: store.getState() });
      const unsubscribe = store.subscribe((state) => {
        port.postMessage({ type: 'STATE_UPDATE', payload: state });
      });
      port.onDisconnect.addListener(() => unsubscribe());
    }
  });

  function handleMessage(
    message: { type: string; payload?: Record<string, unknown> },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): void {
    switch (message.type) {
      case 'GET_STATE':
        sendResponse(store.getState());
        break;
      case 'CLEAR_ACTIVITY_LOG':
        clearLog();
        sendResponse({ success: true });
        break;
      case 'UPDATE_ALLOWLIST':
        store.setAllowlist(message.payload as DomainAllowlist);
        sendResponse({ success: true });
        break;
      case 'CONFIRM_ACTION': {
        const payload = message.payload as { id: string; approved: boolean };
        const state = store.getState();
        if (state.pendingConfirmation?.id === payload.id) {
          const pc = state.pendingConfirmation;
          addEntry({
            type: 'tool_call',
            tool: 'permission',
            summary: payload.approved
              ? `Permiso aprobado: ${pc.action} · ${pc.domain}`
              : `Permiso denegado: ${pc.action} · ${pc.domain}`,
            status: payload.approved ? 'ok' : 'error',
          });
          store.setPendingConfirmation(null);
        }
        sendResponse({ success: true });
        break;
      }
      case 'EXECUTE_TOOL':
        executeTool(message.payload as { method: string; params?: Record<string, unknown> }, sender)
          .then(sendResponse)
          .catch((error) => sendResponse({ success: false, error: { message: error.message } }));
        break;
    }
  }

  async function executeTool(
    request: { method: string; params?: Record<string, unknown> },
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    const { method, params } = request;
    const tab = sender.tab;
    const t0 = Date.now();

    if (tab?.url) {
      const url = new URL(tab.url);
      const allowlist = store.getState().allowlist;
      if (allowlist.enabled && !allowlist.domains.includes(url.hostname)) {
        addEntry({
          type: 'error',
          tool: method,
          client: 'Pestaña',
          profile: extractProfile(params),
          summary: `Dominio no permitido por la lista: ${url.hostname}`,
          status: 'error',
          durationMs: Date.now() - t0,
        });
        return { success: false, error: { code: 'DOMAIN_NOT_ALLOWED', message: `Domain ${url.hostname} not allowed` } };
      }
    }

    try {
      const result = await nmClient.executeTool(method, params);
      addEntry({
        type: 'tool_call',
        tool: method,
        client: 'Pestaña (content)',
        profile: extractProfile(params),
        summary: summarizeToolParams(method, params ?? {}),
        status: 'ok',
        durationMs: Date.now() - t0,
      });
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      addEntry({
        type: 'tool_call',
        tool: method,
        client: 'Pestaña (content)',
        profile: extractProfile(params),
        summary: `${summarizeToolParams(method, params ?? {})} → ${msg}`,
        status: 'error',
        durationMs: Date.now() - t0,
      });
      throw error;
    }
  }

  function broadcastToAll(message: unknown): void {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      }
    });
  }
});
