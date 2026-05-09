import type { ConnectionStatus, NMRequest, NMResponse } from '../shared/types';

const NM_HOST = 'com.ai-browser-runtime.nm';
const REQUEST_TIMEOUT_MS = 8000;
const RECONNECT_DELAY_MS = 5000;

type StatusCallback = (status: ConnectionStatus) => void;

class NMClientImpl {
  private port: chrome.runtime.Port | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private statusListeners: StatusCallback[] = [];
  private _status: ConnectionStatus = { connected: false };
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting = false;

  get status(): ConnectionStatus {
    return this._status;
  }

  onStatusChange(callback: StatusCallback): () => void {
    this.statusListeners.push(callback);
    return () => {
      this.statusListeners = this.statusListeners.filter((cb) => cb !== callback);
    };
  }

  connect(): void {
    if (this.port || this.connecting) return;
    this.connecting = true;
    try {
      this.port = chrome.runtime.connectNative(NM_HOST);
      this.port.onMessage.addListener((msg: NMResponse) => this.onMessage(msg));
      this.port.onDisconnect.addListener(() => this.onDisconnect());
      this.connecting = false;
      this.updateStatus({ connected: true, daemonVersion: '0.1.0', lastConnected: Date.now() });
    } catch (err) {
      this.connecting = false;
      this.updateStatus({
        connected: false,
        error: err instanceof Error ? err.message : 'Connect failed',
      });
    }
  }

  private onMessage(msg: NMResponse): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRequests.delete(msg.id);
    if (msg.success) {
      pending.resolve(msg.result);
    } else {
      pending.reject(new Error(msg.error?.message ?? 'Request failed'));
    }
  }

  private onDisconnect(): void {
    const errorMsg = chrome.runtime.lastError?.message ?? 'Disconnected';
    this.port = null;
    this.connecting = false;
    for (const [, p] of this.pendingRequests) {
      clearTimeout(p.timer);
      p.reject(new Error('NM disconnected'));
    }
    this.pendingRequests.clear();
    this.updateStatus({ connected: false, error: errorMsg });
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
  }

  private updateStatus(status: ConnectionStatus): void {
    this._status = status;
    for (const cb of this.statusListeners) cb(status);
  }

  async executeTool(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.port || !this._status.connected) {
      throw new Error('Not connected to daemon');
    }
    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const request: NMRequest = { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.port!.postMessage(request);
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.port) {
      try { this.port.disconnect(); } catch { /* ignore */ }
      this.port = null;
    }
    this.updateStatus({ connected: false });
  }
}

let instance: NMClientImpl | null = null;

export function getNMClient(): NMClientImpl {
  if (!instance) {
    instance = new NMClientImpl();
  }
  return instance;
}

export type { NMClientImpl as NMClient };
