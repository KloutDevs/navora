import type { NMEnvelope } from "@navora/protocol";
import { NMEnvelopeSchema } from "@navora/protocol";
import type { ConnectionStatus } from "../shared/types";
import { addEntry } from "./activity-log";
import { dispatchDaemonNmMessage } from "./index";

function newRequestId(): string {
  return crypto.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

const NM_HOST = "com.ai-browser-runtime.nm";
const REQUEST_TIMEOUT_MS = 8000;
const RECONNECT_DELAY_MS = 5000;

type StatusCallback = (status: ConnectionStatus) => void;

class NMClientImpl {
  private port: chrome.runtime.Port | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
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
      this.port.onMessage.addListener((msg: unknown) => this.onMessage(msg));
      this.port.onDisconnect.addListener(() => this.onDisconnect());
      this.connecting = false;
      this.updateStatus({ connected: true, daemonVersion: "0.1.0", lastConnected: Date.now() });
      addEntry({
        type: "connect",
        client: "Native Messaging",
        summary: "Canal con el daemon abierto (Chrome ↔ NM host / shim).",
        status: "ok",
      });
    } catch (err) {
      this.connecting = false;
      const msg = err instanceof Error ? err.message : "Connect failed";
      this.updateStatus({
        connected: false,
        error: msg,
      });
      addEntry({
        type: "error",
        client: "Native Messaging",
        summary: `No se pudo conectar al host NM: ${msg}`,
        status: "error",
      });
    }
  }

  private onMessage(msg: unknown): void {
    const parsed = NMEnvelopeSchema.safeParse(msg);
    if (!parsed.success) {
      addEntry({
        type: "error",
        summary: "Mensaje NM inválido o corrupto (no coincide con el esquema del protocolo).",
        status: "error",
      });
      return;
    }

    const env = parsed.data;

    if (env.kind === "response" || env.kind === "error") {
      const rid = env.kind === "response" ? env.request_id : env.request_id ?? "";
      const pending = this.pendingRequests.get(rid);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(rid);
        if (env.kind === "error") {
          pending.reject(new Error(env.message));
        } else if (env.success) {
          pending.resolve(env.result);
        } else {
          pending.reject(new Error(env.error?.message ?? "Request failed"));
        }
      }
      return;
    }

    if (env.kind === "request" && this.port) {
      void dispatchDaemonNmMessage(this.port, env);
    }
  }

  private onDisconnect(): void {
    const errorMsg = chrome.runtime.lastError?.message ?? "Disconnected";
    this.port = null;
    this.connecting = false;
    for (const [, p] of this.pendingRequests) {
      clearTimeout(p.timer);
      p.reject(new Error("NM disconnected"));
    }
    this.pendingRequests.clear();
    addEntry({
      type: "disconnect",
      client: "Native Messaging",
      summary: `Canal NM cerrado (${errorMsg}). Reintento automático en breve si el shim sigue activo.`,
      status: "ok",
    });
    this.updateStatus({ connected: false, error: errorMsg });
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
  }

  private updateStatus(status: ConnectionStatus): void {
    this._status = status;
    for (const cb of this.statusListeners) cb(status);
  }

  /**
   * Extension-initiated tool call (legacy content/EXECUTE_TOOL path).
   */
  async executeTool(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.port || !this._status.connected) {
      throw new Error("Not connected to daemon");
    }

    const requestId = newRequestId();
    const envelope: NMEnvelope = {
      kind: "request",
      request_id: requestId,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timer });
      this.port!.postMessage(envelope);
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.port) {
      try {
        this.port.disconnect();
      } catch {
        /* ignore */
      }
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
