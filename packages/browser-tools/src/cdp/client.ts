/**
 * DevToolsProtocol — Chrome DevTools Protocol client for Node.js.
 * Handles CDP command dispatch and event subscription over WebSocket.
 */

import { WebSocket } from "ws";
import type { Result } from "@navora/shared";

export interface CDPCommand {
  id: number;
  method: string;
  params: Record<string, unknown> | undefined;
}

export interface CDPResponse {
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface CDPEvent {
  method: string;
  params?: Record<string, unknown>;
}

export type CDPEventListener = (event: CDPEvent) => void;

export interface CDPClientOptions {
  /** CDP WebSocket URL (auto-detected from chrome debugging port) */
  url?: string;
  /** Chrome debugging port (default: 9222) */
  port?: number;
  /** Host (default: 127.0.0.1) */
  host?: string;
  /** Connection timeout in ms */
  connectTimeout?: number;
  /** Command timeout in ms */
  commandTimeout?: number;
}

/**
 * CDP command IDs are monotonic per session.
 * CDP responses carry the matching ID for correlation.
 */
let commandIdCounter = 1;

function nextId(): number {
  return commandIdCounter++;
}

export class DevToolsProtocolError extends Error {
  public readonly code: number;
  public readonly method: string;

  constructor(method: string, code: number, message: string) {
    super(message);
    this.name = "DevToolsProtocolError";
    this.method = method;
    this.code = code;
  }
}

/**
 * CDP client — sends commands and receives responses/events over WebSocket.
 *
 * Design notes:
 * - WebSocket connection is lazy: opened on first command, closed on dispose.
 * - CDP commands are fire-and-forget by default unless you await send().
 * - Events are forwarded to registered listeners.
 * - All async operations return Result<T, E> for typed error handling.
 */
export class DevToolsProtocol {
  private readonly baseUrl: string;
  private readonly connectTimeout: number;
  private readonly commandTimeout: number;
  private socket: WebSocket | null = null;
  private pendingCommands = new Map<
    number,
    {
      resolve: (value: CDPResponse) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private eventListeners = new Set<CDPEventListener>();
  private connected = false;

  constructor(options: CDPClientOptions = {}) {
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 9222;
    this.baseUrl = options.url ?? `ws://${host}:${port}`;
    this.connectTimeout = options.connectTimeout ?? 5000;
    this.commandTimeout = options.commandTimeout ?? 30000;
  }

  /**
   * Connect to the CDP WebSocket endpoint.
   */
  async connect(): Promise<Result<void, Error>> {
    if (this.socket && this.connected) {
      return { ok: true, value: undefined };
    }

    try {
      await this.doConnect();
      return { ok: true, value: undefined };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`CDP connect timeout (${this.baseUrl})`));
      }, this.connectTimeout);

      try {
        this.socket = new WebSocket(this.baseUrl);
      } catch (e) {
        clearTimeout(timeout);
        reject(new Error(`Failed to create WebSocket: ${e}`));
        return;
      }

      this.socket.on("open", () => {
        clearTimeout(timeout);
        this.connected = true;
        this.socket!.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => this.handleMessage(data));
        this.socket!.on("error", (err: Error) => this.handleError(err));
        this.socket!.on("close", () => this.handleClose());
        resolve();
      });

      this.socket.on("error", () => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error connecting to ${this.baseUrl}`));
      });
    });
  }

  private handleMessage(data: Buffer | ArrayBuffer | Buffer[]): void {
    let parsed: unknown;
    try {
      const str = data instanceof Buffer ? data.toString() : data.toString();
      parsed = JSON.parse(str);
    } catch {
      return; // Ignore non-JSON messages
    }

    if (typeof parsed !== "object" || parsed === null) return;
    const obj = parsed as Record<string, unknown>;

    if ("id" in obj && typeof obj["id"] === "number") {
      // Response
      const response = parsed as CDPResponse;
      const pending = this.pendingCommands.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingCommands.delete(response.id);
        pending.resolve(response);
      }
    } else if ("method" in obj && typeof obj["method"] === "string") {
      // Event
      const cdpEvent = parsed as CDPEvent;
      for (const listener of this.eventListeners) {
        try {
          listener(cdpEvent);
        } catch {
          // Swallow listener errors
        }
      }
    }
  }

  private handleError(err: Error): void {
    // Propagate to pending commands
    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`WebSocket error: ${err.message}`));
    }
    this.pendingCommands.clear();
  }

  private handleClose(): void {
    this.connected = false;
    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("WebSocket closed"));
    }
    this.pendingCommands.clear();
  }

  /**
   * Send a CDP command and wait for the response.
   * Uses Result<T, E> for typed error handling.
   */
  async send(
    method: string,
    params?: Record<string, unknown>
  ): Promise<Result<unknown, DevToolsProtocolError>> {
    if (!this.socket || !this.connected) {
      return {
        ok: false,
        error: new DevToolsProtocolError(method, -1, "Not connected"),
      };
    }

    const id = nextId();
    const command: CDPCommand = { id, method, params };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id);
        resolve({
          ok: false,
          error: new DevToolsProtocolError(
            method,
            -2,
            `CDP command timeout: ${method}`
          ),
        });
      }, this.commandTimeout);

      this.pendingCommands.set(id, {
        resolve: (response) => {
          clearTimeout(timeout);
          if (response.error) {
            resolve({
              ok: false,
              error: new DevToolsProtocolError(
                method,
                response.error.code,
                response.error.message
              ),
            });
          } else {
            resolve({ ok: true, value: response.result });
          }
        },
        reject: (e) => {
          clearTimeout(timeout);
          resolve({
            ok: false,
            error: new DevToolsProtocolError(method, -3, String(e)),
          });
        },
        timeout,
      });

      this.socket!.send(JSON.stringify(command));
    });
  }

  /**
   * Subscribe to CDP events.
   */
  on(listener: CDPEventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * Unsubscribe from CDP events.
   */
  off(listener: CDPEventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * Close the CDP connection.
   */
  async dispose(): Promise<Result<void, Error>> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ ok: true, value: undefined });
        return;
      }

      this.socket.on("close", () => {
        this.socket = null;
        this.connected = false;
        resolve({ ok: true, value: undefined });
      });

      this.socket.close();
    });
  }

  /** Check if connected */
  isConnected(): boolean {
    return this.connected;
  }
}