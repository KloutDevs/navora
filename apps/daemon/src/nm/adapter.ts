/**
 * Chrome Extension Adapter
 * Wraps NM communication for Chrome extension protocol
 */

import { EventEmitter } from "events";
import { Buffer } from "buffer";
import { z } from "zod";
import type { Result } from "@navora/shared";
import { ok, err } from "@navora/shared";
import { NMMessageSchema, NMEnvelopeSchema, NMAcknowledgmentSchema, type NMEnvelope, type NMMessage } from "@navora/protocol";
import { createNMConnection, type NMConnection, type NMConnectionConfig } from "./connection";
import { createNMMultiplexer, type NMMultiplexer, type MultiplexerConfig } from "./multiplexer";
import { createMessageChunker, type MessageChunker } from "./chunking";

/**
 * Chrome Extension Adapter events
 */
export interface ChromeExtensionAdapterEvents {
  request: (envelope: NMEnvelope, context: { profileId: string }) => void;
  response: (envelope: NMEnvelope, context: { profileId: string }) => void;
  error: (error: Error, context: { profileId: string }) => void;
  connect: (profileId: string) => void;
  disconnect: (profileId: string) => void;
}

/**
 * Chrome Extension Adapter configuration
 */
export interface ChromeExtensionAdapterConfig {
  /** Default connection config (without connectionId/profileId) */
  defaultConnectionConfig: Omit<NMConnectionConfig, "connectionId" | "profileId">;
  /** Multiplexer config */
  multiplexerConfig: Omit<MultiplexerConfig, "defaultConnectionConfig">;
  /** Chunking config */
  chunkingConfig?: {
    maxChunkSize?: number;
  };
  /** Request timeout (ms) */
  requestTimeoutMs?: number;
  /** Logger */
  logger?: {
    debug?: (msg: string) => void;
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

/**
 * ChromeExtensionAdapter wraps NM for Chrome extension communication
 * Provides request/response semantics over the raw NM connection
 */
export class ChromeExtensionAdapter extends EventEmitter {
  private multiplexer: NMMultiplexer;
  private chunker: MessageChunker;
  private requestTimeoutMs: number;
  private logger?: ChromeExtensionAdapterConfig["logger"];
  private pendingRequests: Map<string, { resolve: (envelope: NMEnvelope) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }> = new Map();
  private closed = false;
  
  constructor(config: ChromeExtensionAdapterConfig) {
    super();
    
    // Create multiplexer (only pass logger if defined)
    const muxConfig: MultiplexerConfig = {
      defaultConnectionConfig: config.defaultConnectionConfig,
    };
    if (config.logger) {
      muxConfig.logger = config.logger;
    }
    this.multiplexer = createNMMultiplexer(muxConfig);
    
    // Create chunker
    this.chunker = createMessageChunker(config.chunkingConfig);
    
    // Set timeout
    this.requestTimeoutMs = config.requestTimeoutMs ?? 30000;
    this.logger = config.logger;
    
    // Forward multiplex events
    this.setupEventForwarding();
  }
  
  /**
   * Set up event forwarding from multiplexer
   */
  private setupEventForwarding(): void {
    this.multiplexer.on("message", (message: Buffer, context: { profileId: string }) => {
      this.handleMessage(message, context.profileId);
    });
    
    this.multiplexer.on("connect", ({ profileId }: { profileId: string }) => {
      this.emit("connect", profileId);
    });
    
    this.multiplexer.on("disconnect", ({ profileId, error }: { profileId: string; error?: Error }) => {
      // Cancel pending requests for this profile
      for (const [requestId, pending] of this.pendingRequests) {
        // We can't know which profile, but we can cancel all on disconnect
        this.clearRequest(requestId);
      }
      this.emit("disconnect", profileId);
    });
    
    this.multiplexer.on("error", ({ profileId, error }: { profileId: string; error: Error }) => {
      this.logger?.error?.(`Adapter: profile ${profileId} error - ${error.message}`);
      this.emit("error", error, { profileId });
    });
  }
  
  /**
   * Handle incoming message
   */
  private handleMessage(message: Buffer, profileId: string): void {
    try {
      // Try to parse as envelope
      const parsed = JSON.parse(message.toString("utf8"));
      const envelopeResult = NMEnvelopeSchema.safeParse(parsed);
      
      if (!envelopeResult.success) {
        this.logger?.warn?.(`Adapter: received invalid envelope from ${profileId}`);
        return;
      }
      
      const envelope = envelopeResult.data;
      
      // Handle based on kind
      if (envelope.kind === "request") {
        // Incoming request - emit for handler
        this.emit("request", envelope, { profileId });
        
        // Send acknowledgment
        this.sendAcknowledgment(profileId, envelope.request_id);
        
      } else if (envelope.kind === "response") {
        // Response to our request - resolve pending
        const pending = this.pendingRequests.get(envelope.request_id);
        
        if (pending) {
          clearTimeout(pending.timeout);
          pending.resolve(envelope);
          this.pendingRequests.delete(envelope.request_id);
        }
        
        this.emit("response", envelope, { profileId });
        
      } else if (envelope.kind === "error") {
        // Error response - reject pending
        const pending = this.pendingRequests.get(envelope.request_id ?? "");
        
        if (pending) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(envelope.message));
          this.pendingRequests.delete(envelope.request_id ?? "");
        }
        
        this.emit("error", new Error(envelope.message), { profileId });
      }
    } catch (error) {
      this.logger?.error?.(`Adapter: failed to handle message - ${error}`);
    }
  }
  
  /**
   * Send acknowledgment for a request
   */
  private sendAcknowledgment(profileId: string, requestId: string): void {
    const ack = {
      request_id: requestId,
      received_at: Date.now(),
    };
    
    this.sendRaw(profileId, Buffer.from(JSON.stringify(ack), "utf8"));
  }
  
  /**
   * Send raw message to profile
   */
  private async sendRaw(profileId: string, message: Buffer): Promise<Result<void, Error>> {
    const chunks = this.chunker.chunk(message);
    
    for (const chunk of chunks) {
      const profileIds = this.multiplexer.getProfileIds();
      const result = await this.multiplexer.sendToProfile(profileId, chunk);
      
      if (!result.success) {
        return err(result.error ?? new Error("Send failed"));
      }
    }
    
    return ok(undefined);
  }
  
  /**
   * Connect a profile's stream
   */
  connect(profileId: string, stream: { read: any; write: any }): void {
    if (this.closed) {
      this.logger?.warn?.("Adapter: cannot connect - adapter closed");
      return;
    }
    
    this.multiplexer.createConnection(profileId, stream);
  }
  
  /**
   * Send a request to a profile
   */
  async sendRequest(
    profileId: string,
    request: Omit<NMMessage, "request_id">
  ): Promise<Result<NMEnvelope, Error>> {
    if (this.closed) {
      return err(new Error("Adapter closed"));
    }
    
    // Generate request ID
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const envelope: NMEnvelope = {
      kind: "request",
      request_id: requestId,
      ...request,
    };
    
    // Serialize and send
    const message = Buffer.from(JSON.stringify(envelope), "utf8");
    const sendResult = await this.sendRaw(profileId, message);
    
    if (!sendResult.ok) {
      return err(sendResult.error);
    }
    
    // Wait for response
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve(err(new Error(`Request ${requestId} timed out`)));
      }, this.requestTimeoutMs);
      
      const resolveFn = (envelope: NMEnvelope) => resolve(ok(envelope) as unknown as Result<NMEnvelope, Error>);
      
      this.pendingRequests.set(requestId, {
        resolve: resolveFn,
        reject: (error: Error) => resolve(err(error)),
        timeout,
      });
    });
  }
  
  /**
   * Send a response to a profile
   */
  async sendResponse(
    profileId: string,
    requestId: string,
    result?: unknown,
    error?: { code: string; message: string }
  ): Promise<Result<void, Error>> {
    const envelope: NMEnvelope = {
      kind: "response",
      request_id: requestId,
      success: error === undefined,
      result,
      error,
    };
    
    const message = Buffer.from(JSON.stringify(envelope), "utf8");
    return this.sendRaw(profileId, message);
  }
  
  /**
   * Send error to a profile
   */
  async sendError(
    profileId: string,
    requestId: string | undefined,
    code: string,
    errorMessage: string
  ): Promise<Result<void, Error>> {
    const envelope: NMEnvelope = {
      kind: "error",
      request_id: requestId,
      code,
      message: errorMessage,
    };
    
    const message = Buffer.from(JSON.stringify(envelope), "utf8");
    return this.sendRaw(profileId, message);
  }
  
  /**
   * Clear a pending request
   */
  private clearRequest(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Request cancelled"));
      this.pendingRequests.delete(requestId);
    }
  }
  
  /**
   * Cancel all pending requests
   */
  cancelAllRequests(): number {
    let count = 0;
    for (const requestId of this.pendingRequests.keys()) {
      this.clearRequest(requestId);
      count++;
    }
    return count;
  }
  
  /**
   * Get pending request count
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }
  
  /**
   * Check if profile is connected
   */
  isProfileConnected(profileId: string): boolean {
    return this.multiplexer.hasConnection(profileId);
  }
  
  /**
   * Get all connected profile IDs
   */
  getConnectedProfiles(): string[] {
    return this.multiplexer.getProfileIds().filter((id) => 
      this.multiplexer.hasConnection(id)
    );
  }
  
  /**
   * Get the underlying multiplexer (for advanced operations)
   */
  getMultiplexer(): NMMultiplexer {
    return this.multiplexer;
  }
  
  /**
   * Destroy the adapter
   */
  destroy(): void {
    this.closed = true;
    this.cancelAllRequests();
    this.multiplexer.destroy();
    this.removeAllListeners();
  }
}

/**
 * Create a ChromeExtensionAdapter
 */
export function createChromeExtensionAdapter(config: ChromeExtensionAdapterConfig): ChromeExtensionAdapter {
  return new ChromeExtensionAdapter(config);
}