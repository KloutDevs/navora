/**
 * NM Connection state machine
 * Manages connection lifecycle: connected, disconnected, reconnecting
 */

import { EventEmitter } from "events";
import type { Result } from "@ai-browser-runtime/shared";
import { ok, err } from "@ai-browser-runtime/shared";
import { Buffer } from "buffer";
import { createFrameReader, createFrameWriter, type FrameReader, type FrameWriter } from "./framing";

/**
 * Connection state
 */
export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

/**
 * Connection events
 */
export interface NMConnectionEvents {
  connect: () => void;
  disconnect: (error?: Error) => void;
  message: (message: Buffer) => void;
  error: (error: Error) => void;
  stateChange: (state: ConnectionState) => void;
}

/**
 * Connection configuration
 */
export interface NMConnectionConfig {
  /** Connection ID for logging */
  connectionId: string;
  /** Profile ID this connection serves */
  profileId: string;
  /** Timeout for connect operations (ms) */
  connectTimeoutMs?: number;
  /** Maximum reconnect attempts */
  maxReconnectAttempts?: number;
  /** Base delay for exponential backoff (ms) */
  reconnectBaseDelayMs?: number;
  /** Maximum reconnect delay (ms) */
  reconnectMaxDelayMs?: number;
  /** Logger */
  logger?: {
    debug?: (msg: string) => void;
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

/**
 * NMConnection manages a single native messaging connection
 */
export class NMConnection extends EventEmitter {
  private state: ConnectionState = "disconnected";
  private connectionId: string;
  private profileId: string;
  private connectTimeoutMs: number;
  private maxReconnectAttempts: number;
  private reconnectBaseDelayMs: number;
  private reconnectMaxDelayMs: number;
  private logger?: NMConnectionConfig["logger"];
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private frameReader: FrameReader | null = null;
  private frameWriter: FrameWriter | null = null;
  private underlyingStream: any = null;
  private closed = false;
  
  constructor(config: NMConnectionConfig) {
    super();
    this.connectionId = config.connectionId;
    this.profileId = config.profileId;
    this.connectTimeoutMs = config.connectTimeoutMs ?? 5000;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 5;
    this.reconnectBaseDelayMs = config.reconnectBaseDelayMs ?? 1000;
    this.reconnectMaxDelayMs = config.reconnectMaxDelayMs ?? 30000;
    this.logger = config.logger;
  }
  
  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }
  
  /**
   * Get connection ID
   */
  getConnectionId(): string {
    return this.connectionId;
  }
  
  /**
   * Get profile ID
   */
  getProfileId(): string {
    return this.profileId;
  }
  
  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === "connected";
  }
  
  /**
   * Connect to native messaging endpoint
   * @param stream Readable/Writable stream for native messaging
   */
  connect(stream: { read: any; write: any }): void {
    if (this.closed) {
      this.emitError(new Error("Connection closed"));
      return;
    }
    
    if (this.state === "connected" || this.state === "connecting") {
      this.logger?.debug?.(`NMConnection ${this.connectionId}: already connecting or connected`);
      return;
    }
    
    this.setState("connecting");
    this.underlyingStream = stream;
    
    // Create framing layer
    this.frameReader = createFrameReader(stream as any);
    this.frameWriter = createFrameWriter(stream as any);
    
    // Set up message handler
    this.frameReader.onMessage((message) => {
      this.emit("message", message);
    });
    
    // Connected!
    this.reconnectAttempts = 0;
    this.setState("connected");
    this.emit("connect");
    this.logger?.info?.(`NMConnection ${this.connectionId}: connected for profile ${this.profileId}`);
  }
  
  /**
   * Send a message over the connection
   */
  async send(message: Buffer): Promise<Result<void, Error>> {
    if (this.state !== "connected") {
      return err(new Error(`Not connected: ${this.state}`));
    }
    
    if (!this.frameWriter) {
      return err(new Error("No writer"));
    }
    
    const result = await this.frameWriter.write(message);
    if (!result.ok) {
      this.logger?.error?.(`NMConnection ${this.connectionId}: write failed - ${result.error}`);
      this.handleDisconnect(result.error);
      return result;
    }
    
    return ok(undefined);
  }
  
  /**
   * Handle disconnection
   */
  private handleDisconnect(error?: Error): void {
    if (this.state === "disconnected") {
      return;
    }
    
    this.logger?.warn?.(`NMConnection ${this.connectionId}: disconnected${error ? ` - ${error.message}` : ""}`);
    
    this.setState("disconnected");
    this.cleanup();
    this.emit("disconnect", error);
    
    // Attempt reconnection if we haven't exceeded max attempts
    if (!this.closed && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }
  
  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      this.reconnectMaxDelayMs
    );
    
    this.logger?.info?.(
      `NMConnection ${this.connectionId}: scheduling reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
    );
    
    this.setState("reconnecting");
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      
      if (this.underlyingStream) {
        this.setState("connecting");
        this.connect(this.underlyingStream);
      } else {
        this.handleDisconnect(new Error("No underlying stream for reconnect"));
      }
    }, delay);
  }
  
  /**
   * Manually disconnect
   */
  disconnect(error?: Error): void {
    if (this.closed) {
      return;
    }
    
    this.closed = true;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.handleDisconnect(error ?? new Error("Manual disconnect"));
  }
  
  /**
   * Force reconnect
   */
  reconnect(stream: { read: any; write: any }): void {
    this.cleanup();
    this.underlyingStream = stream;
    this.reconnectAttempts = 0;
    this.closed = false;
    this.connect(stream);
  }
  
  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.frameReader) {
      this.frameReader.close();
      this.frameReader = null;
    }
    
    if (this.frameWriter) {
      this.frameWriter.close();
      this.frameWriter = null;
    }
    
    this.underlyingStream = null;
  }
  
  /**
   * Set state and emit change event
   */
  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.emit("stateChange", state);
    }
  }
  
  /**
   * Emit error helper
   */
  private emitError(error: Error): void {
    this.logger?.error?.(`NMConnection ${this.connectionId}: error - ${error.message}`);
    this.emit("error", error);
  }
  
  /**
   * Destroy the connection
   */
  destroy(): void {
    this.closed = true;
    this.cleanup();
    this.removeAllListeners();
  }
}

/**
 * Create a new NMConnection
 */
export function createNMConnection(config: NMConnectionConfig): NMConnection {
  return new NMConnection(config);
}