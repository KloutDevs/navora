/**
 * Chrome Extension Adapter
 * Wraps NM communication for Chrome extension protocol
 */

import { EventEmitter } from "events";
import { Buffer } from "buffer";
import WebSocket from "ws";
import type { Result } from "@navora/shared";
import { ok, err } from "@navora/shared";
import { NMEnvelopeSchema, type NMEnvelope, type NMMessage } from "@navora/protocol";
import type { NMConnectionConfig } from "./connection";
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
  /** Outbound chunk split (large payloads). */
  private outboundChunker: MessageChunker;
  /** Per-profile inbound reassembly (chunked NM payloads). */
  private inboundChunkers = new Map<string, MessageChunker>();
  private inboundAccumulators = new Map<string, Buffer[]>();
  /** Shim path: raw WS payloads (inner NM bytes), one socket per profile. */
  private shimSockets = new Map<string, WebSocket>();

  private requestTimeoutMs: number;
  private chunkingConfig?: ChromeExtensionAdapterConfig["chunkingConfig"];
  private logger?: ChromeExtensionAdapterConfig["logger"];
  private pendingRequests: Map<
    string,
    {
      resolve: (r: Result<NMEnvelope, Error>) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  > = new Map();
  private closed = false;

  constructor(config: ChromeExtensionAdapterConfig) {
    super();

    const muxConfig: MultiplexerConfig = {
      defaultConnectionConfig: config.defaultConnectionConfig,
    };
    if (config.logger) {
      muxConfig.logger = config.logger;
    }
    this.multiplexer = createNMMultiplexer(muxConfig);

    this.outboundChunker = createMessageChunker(config.chunkingConfig);
    this.chunkingConfig = config.chunkingConfig;

    this.requestTimeoutMs = config.requestTimeoutMs ?? 30000;
    this.logger = config.logger;

    this.setupEventForwarding();
  }

  private setupEventForwarding(): void {
    this.multiplexer.on("message", (message: Buffer, context: { profileId: string }) => {
      this.feedInbound(context.profileId, message);
    });

    this.multiplexer.on("connect", ({ profileId }: { profileId: string }) => {
      this.emit("connect", profileId);
    });

    this.multiplexer.on("disconnect", ({ profileId }: { profileId: string }) => {
      for (const requestId of [...this.pendingRequests.keys()]) {
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
   * Attach daemon WebSocket from NM shim (inner NM payloads, no extra length-prefix layer).
   */
  attachWebSocketBridge(profileId: string, ws: WebSocket): void {
    if (this.closed) {
      this.logger?.warn?.("Adapter: cannot attach shim — adapter closed");
      return;
    }

    const existing = this.shimSockets.get(profileId);
    if (existing && existing !== ws) {
      try {
        existing.close();
      } catch {
        /* ignore */
      }
    }

    this.shimSockets.set(profileId, ws);

    ws.on("message", (data: WebSocket.RawData) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      this.feedInbound(profileId, buf);
    });

    ws.on("close", () => {
      if (this.shimSockets.get(profileId) === ws) {
        this.shimSockets.delete(profileId);
      }
      this.inboundChunkers.delete(profileId);
      this.inboundAccumulators.delete(profileId);
      for (const requestId of [...this.pendingRequests.keys()]) {
        this.clearRequest(requestId);
      }
      this.emit("disconnect", profileId);
    });

    ws.on("error", (e) => {
      this.logger?.warn?.(`Adapter: shim socket error ${profileId}: ${e.message}`);
    });

    this.emit("connect", profileId);
  }

  /**
   * Reassemble chunked payloads then parse NM envelope JSON.
   */
  private feedInbound(profileId: string, fragment: Buffer): void {
    try {
      // Fast path: JSON object / envelope (starts with '{')
      if (fragment.length > 0 && fragment[0] === 0x7b) {
        this.processEnvelopeBuffer(profileId, fragment);
        return;
      }

      let chunker = this.inboundChunkers.get(profileId);
      if (!chunker) {
        chunker = createMessageChunker(this.chunkingConfig);
        this.inboundChunkers.set(profileId, chunker);
      }

      const acc = this.inboundAccumulators.get(profileId) ?? [];
      acc.push(fragment);

      const first = acc[0];
      if (!first || first.length < 8) {
        this.inboundAccumulators.set(profileId, acc);
        return;
      }

      const totalChunks = first.readUInt32LE(4);
      if (acc.length < totalChunks) {
        this.inboundAccumulators.set(profileId, acc);
        return;
      }

      const assembled = chunker.assemble(acc);
      this.inboundAccumulators.delete(profileId);

      if (!assembled) {
        this.logger?.warn?.(`Adapter: chunk assemble failed for ${profileId}`);
        return;
      }

      this.processEnvelopeBuffer(profileId, assembled);
    } catch (error) {
      this.logger?.error?.(`Adapter: feedInbound failed - ${error}`);
    }
  }

  private processEnvelopeBuffer(profileId: string, message: Buffer): void {
    try {
      const parsed = JSON.parse(message.toString("utf8"));
      const envelopeResult = NMEnvelopeSchema.safeParse(parsed);

      if (!envelopeResult.success) {
        this.logger?.warn?.(`Adapter: received invalid envelope from ${profileId}`);
        return;
      }

      const envelope = envelopeResult.data;

      if (envelope.kind === "request") {
        this.emit("request", envelope, { profileId });
        void this.sendAcknowledgment(profileId, envelope.request_id);
      } else if (envelope.kind === "response") {
        const pending = this.pendingRequests.get(envelope.request_id);

        if (pending) {
          clearTimeout(pending.timeout);
          pending.resolve(ok(envelope));
          this.pendingRequests.delete(envelope.request_id);
        }

        this.emit("response", envelope, { profileId });
      } else if (envelope.kind === "error") {
        const pending = this.pendingRequests.get(envelope.request_id ?? "");

        if (pending) {
          clearTimeout(pending.timeout);
          pending.resolve(err(new Error(envelope.message)));
          this.pendingRequests.delete(envelope.request_id ?? "");
        }

        this.emit("error", new Error(envelope.message), { profileId });
      }
    } catch (error) {
      this.logger?.error?.(`Adapter: failed to process envelope - ${error}`);
    }
  }

  private async sendAcknowledgment(profileId: string, requestId: string): Promise<void> {
    const ack = {
      request_id: requestId,
      received_at: Date.now(),
    };

    await this.sendRaw(profileId, Buffer.from(JSON.stringify(ack), "utf8"));
  }

  private async sendRaw(profileId: string, message: Buffer): Promise<Result<void, Error>> {
    const chunks = this.outboundChunker.chunk(message);

    const ws = this.shimSockets.get(profileId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      for (const chunk of chunks) {
        ws.send(chunk);
      }
      return ok(undefined);
    }

    for (const chunk of chunks) {
      const result = await this.multiplexer.sendToProfile(profileId, chunk);

      if (!result.success) {
        return err(result.error ?? new Error("Send failed"));
      }
    }

    return ok(undefined);
  }

  /**
   * Connect a profile's stream (stdio / framed NM host path)
   */
  connect(profileId: string, stream: { read: unknown; write: unknown }): void {
    if (this.closed) {
      this.logger?.warn?.("Adapter: cannot connect - adapter closed");
      return;
    }

    this.multiplexer.createConnection(profileId, stream);
  }

  async sendRequest(
    profileId: string,
    request: Omit<NMMessage, "request_id">,
    options?: { requestId?: string; timeoutMs?: number }
  ): Promise<Result<NMEnvelope, Error>> {
    if (this.closed) {
      return err(new Error("Adapter closed"));
    }

    const requestId =
      options?.requestId ?? `req-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const envelope: NMEnvelope = {
      kind: "request",
      request_id: requestId,
      ...request,
    };

    const message = Buffer.from(JSON.stringify(envelope), "utf8");
    const sendResult = await this.sendRaw(profileId, message);

    if (!sendResult.ok) {
      return err(sendResult.error);
    }

    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve(err(new Error(`Request ${requestId} timed out`)));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        timeout,
      });
    });
  }

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

  private clearRequest(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(err(new Error("Request cancelled")));
      this.pendingRequests.delete(requestId);
    }
  }

  cancelAllRequests(): number {
    let count = 0;
    for (const requestId of this.pendingRequests.keys()) {
      this.clearRequest(requestId);
      count++;
    }
    return count;
  }

  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  isProfileConnected(profileId: string): boolean {
    return this.shimSockets.has(profileId) || this.multiplexer.hasConnection(profileId);
  }

  getConnectedProfiles(): string[] {
    const fromMux = this.multiplexer.getProfileIds().filter((id) => this.multiplexer.hasConnection(id));
    const fromShim = [...this.shimSockets.keys()];
    return [...new Set([...fromMux, ...fromShim])];
  }

  getMultiplexer(): NMMultiplexer {
    return this.multiplexer;
  }

  destroy(): void {
    this.closed = true;
    this.cancelAllRequests();
    for (const ws of this.shimSockets.values()) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.shimSockets.clear();
    this.inboundChunkers.clear();
    this.inboundAccumulators.clear();
    this.multiplexer.destroy();
    this.removeAllListeners();
  }
}

export function createChromeExtensionAdapter(config: ChromeExtensionAdapterConfig): ChromeExtensionAdapter {
  return new ChromeExtensionAdapter(config);
}
