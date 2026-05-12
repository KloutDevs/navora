/**
 * @navora/daemon - WebSocket Hub
 * Implements WebSocket server on 127.0.0.1:51520 with JSON-RPC 2.0 dispatch
 */

import { createHmac } from "node:crypto";
import { EventEmitter } from "events";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { parseJSONRPCRequest, parseJSONRPCBatchRequest, serializeJSONRPCResponse, type JSONRPCRequest, JSONRPCErrorCode } from "@navora/mcp";
import { generate } from "@navora/shared";

export interface ShimConnectedPayload {
  profileId: string;
  socket: WebSocket;
  clientId: string;
  client: WsClient;
}

function extractBearer(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v?.startsWith("Bearer ")) return undefined;
  return v.slice(7).trim();
}

// =============================================================================
// Types
// =============================================================================

/** Authenticated client session */
export interface WsClient {
  clientId: string;
  token: string;
  socket: WebSocket;
  profileId?: string;
  connectedAt: number;
  authenticated: boolean;
  /** Present after auth — Bearer upgrade from NM shim, or JSON-RPC auth/login */
  authMethod?: "header" | "login";
}

/** Token validation result */
export interface TokenValidationResult {
  valid: boolean;
  profileId: string;
  error?: string;
}

/** WebSocket hub options */
export interface WebSocketHubOptions {
  /** Port to listen on */
  port: number;
  /** Host to bind to (default: 127.0.0.1) */
  host?: string;
  /** Token validation function */
  validateToken?: (token: string) => Promise<TokenValidationResult>;
  /** Auth token secret for default validation */
  authSecret?: string;
  /** Maximum message size in bytes */
  maxMessageSize?: number;
  /** Enable debug logging */
  debug?: boolean;
}

// =============================================================================
// WebSocket Hub Implementation
// =============================================================================

/**
 * WebSocketHub - Manages WebSocket client connections with token auth and JSON-RPC dispatch
 */
export class WebSocketHub extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private port: number;
  private host: string;
  private validateToken: (token: string) => Promise<TokenValidationResult>;
  private maxMessageSize: number;
  private debug: boolean;
  private clients: Map<string, WsClient> = new Map();
  private authSecret: string | null = null;

  // JSON-RPC request handlers
  private handlers: Map<string, (request: JSONRPCRequest, client: WsClient) => Promise<string>> = new Map();

  constructor(options: WebSocketHubOptions) {
    super();
    this.port = options.port;
    this.host = options.host ?? "127.0.0.1";
    this.maxMessageSize = options.maxMessageSize ?? 1024 * 1024; // 1MB default
    this.debug = options.debug ?? false;

    // Set up token validation
    if (options.authSecret) {
      this.authSecret = options.authSecret;
      this.validateToken = options.validateToken ?? this.createDefaultValidator();
    } else if (options.validateToken) {
      this.validateToken = options.validateToken;
    } else {
      throw new Error("WebSocketHub requires either authSecret or validateToken");
    }
  }

  /**
   * Create a default token validator using authSecret
   */
  private createDefaultValidator(): (token: string) => Promise<TokenValidationResult> {
    return async (token: string): Promise<TokenValidationResult> => {
      if (!this.authSecret) {
        return { valid: false, profileId: "", error: "No auth secret configured" };
      }
      
      // Simple token format: base64(profileId:timestamp:signature)
      try {
        const decoded = Buffer.from(token, "base64").toString("utf8");
        const parts = decoded.split(":");
        
        if (parts.length < 2) {
          return { valid: false, profileId: "", error: "Invalid token format" };
        }

        const profileId = parts[0] ?? "";
        const timestampStr = parts[1] ?? "0";
        const timestamp = parseInt(timestampStr, 10);
        const signature = parts.slice(2).join(":");

        // Check timestamp is recent (within 24 hours)
        const age = Date.now() - timestamp;
        if (age > 24 * 60 * 60 * 1000) {
          return { valid: false, profileId: "", error: "Token expired" };
        }

        // Verify signature (simplified - in production use proper HMAC)
        const expectedSignature = this.hashToken(profileId, timestamp);
        if (signature !== expectedSignature) {
          return { valid: false, profileId: "", error: "Invalid signature" };
        }

        return { valid: true, profileId: profileId || "" };
      } catch {
        return { valid: false, profileId: "", error: "Failed to parse token" };
      }
    };
  }

  private hashToken(profileId: string, timestamp: number): string {
    return createHmac("sha256", this.authSecret!)
      .update(`${profileId}:${timestamp}`)
      .digest("hex");
  }

  /**
   * Start the WebSocket server
   */
  start(): void {
    if (this.wss) {
      this.log("WebSocketHub already running");
      return;
    }

    this.wss = new WebSocketServer({
      host: this.host,
      port: this.port,
    });

    this.wss.on("listening", () => {
      const la = this.wss?.address();
      const p =
        typeof la === "object" && la !== null ? la.port : this.port;
      this.log(`WebSocketHub listening on ${this.host}:${p}`);
    });

    this.wss.on("connection", (socket, req) => {
      this.handleConnection(socket, req);
    });

    this.wss.on("error", (error) => {
      // Always log server errors — these are fatal (e.g. EADDRINUSE)
      console.error(`[WebSocketHub] Server error: ${error.message}`);
      this.emit("error", error);
    });
  }

  /**
   * Handle a new WebSocket connection
   */
  private handleConnection(socket: WebSocket, req?: IncomingMessage): void {
    const bearer = extractBearer(req?.headers?.authorization ?? req?.headers?.["authorization"]);

    if (bearer) {
      let closedEarly = false;
      socket.once("close", () => {
        closedEarly = true;
      });

      void this.validateToken(bearer).then((validation) => {
        if (closedEarly) return;
        if (!validation.valid) {
          socket.close(1008, (validation.error ?? "invalid token").slice(0, 120));
          return;
        }

        const clientId = generate();
        const client: WsClient = {
          clientId,
          token: bearer,
          socket,
          profileId: validation.profileId,
          connectedAt: Date.now(),
          authenticated: true,
          authMethod: "header",
        };

        this.clients.set(clientId, client);
        this.log(`Client ${clientId} authenticated via Bearer for profile ${validation.profileId}`);
        this.wireSocket(socket, clientId, client);
        const shimPayload: ShimConnectedPayload = {
          profileId: validation.profileId,
          socket,
          clientId,
          client,
        };
        this.emit("shim-connected", shimPayload);
      });
      return;
    }

    const clientId = generate();
    const client: WsClient = {
      clientId,
      token: "",
      socket,
      connectedAt: Date.now(),
      authenticated: false,
    };

    this.clients.set(clientId, client);
    this.wireSocket(socket, clientId, client);
  }

  private wireSocket(socket: WebSocket, clientId: string, client: WsClient): void {
    this.log(`Client connected: ${clientId}`);

    socket.on("message", async (data) => {
      try {
        const message = Buffer.isBuffer(data) ? data.toString("utf8") : data.toString();
        await this.handleClientMessage(client, message);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.log(`Error handling message from ${clientId}: ${errorMessage}`);
        this.sendError(client, null, -32603, `Internal error: ${errorMessage}`);
      }
    });

    socket.on("close", () => {
      this.clients.delete(clientId);
      this.log(`Client disconnected: ${clientId}`);
    });

    socket.on("error", (error) => {
      this.log(`Client ${clientId} socket error: ${error.message}`);
      this.clients.delete(clientId);
    });
  }

  /**
   * Handle a message from a client
   */
  private async handleClientMessage(client: WsClient, message: string): Promise<void> {
    // Check message size
    if (message.length > this.maxMessageSize) {
      this.sendError(client, null, -32603, "Message too large");
      return;
    }

    // If not authenticated, the first message must be an auth request
    if (!client.authenticated) {
      const authResult = await this.handleAuthMessage(client, message);
      if (!authResult) {
        return;
      }
    }

    // Check if it's a batch request
    const trimmed = message.trim();
    if (trimmed.startsWith("[")) {
      await this.handleBatchRequest(client, trimmed);
    } else {
      await this.handleSingleRequest(client, trimmed);
    }
  }

  /**
   * Handle authentication message
   */
  private async handleAuthMessage(client: WsClient, message: string): Promise<boolean> {
    const parseResult = parseJSONRPCRequest(message);
    if (!parseResult.ok) {
      this.sendError(client, null, -32600, "Invalid JSON-RPC request");
      return false;
    }

    const request = parseResult.value;

    // Auth method must be "auth/login"
    if (request.method !== "auth/login") {
      this.sendError(client, request.id, -32601, "Authentication required: call auth/login first");
      return false;
    }

    const params = request.params ?? {};
    const token = params["token"] as string;

    if (!token) {
      this.sendError(client, request.id, -32602, "Missing token parameter");
      return false;
    }

    // Validate token
    const validation = await this.validateToken(token);
    if (!validation.valid) {
      this.sendError(client, request.id, -32600, validation.error ?? "Invalid token");
      return false;
    }

    // Update client with auth info
    client.token = token;
    client.profileId = validation.profileId;
    client.authenticated = true;
    client.authMethod = "login";

    this.log(`Client ${client.clientId} authenticated for profile ${client.profileId}`);

    // Send success response
    const response = {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        success: true,
        profileId: client.profileId,
        clientId: client.clientId,
      },
    };
    this.sendResponse(client, response);

    return true;
  }

  /**
   * Handle a batch JSON-RPC request
   */
  private async handleBatchRequest(client: WsClient, message: string): Promise<void> {
    const parseResult = parseJSONRPCBatchRequest(message);
    if (!parseResult.ok) {
      this.sendError(client, null, -32700, parseResult.error.message);
      return;
    }

    const requests = parseResult.value;
    const responses: string[] = [];

    for (const request of requests) {
      const response = await this.dispatchRequest(request, client);
      responses.push(response);
    }

    // Send batch response
    const batchResponse = `[${responses.join(",")}]`;
    client.socket.send(batchResponse);
  }

  /**
   * Handle a single JSON-RPC request
   */
  private async handleSingleRequest(client: WsClient, message: string): Promise<void> {
    const parseResult = parseJSONRPCRequest(message);
    if (!parseResult.ok) {
      this.sendError(client, null, -32600, parseResult.error.message);
      return;
    }

    const response = await this.dispatchRequest(parseResult.value, client);
    client.socket.send(response);
  }

  /**
   * Dispatch a JSON-RPC request to the appropriate handler
   */
  private async dispatchRequest(request: JSONRPCRequest, client: WsClient): Promise<string> {
    const { method, id } = request;

    // Get handler for method
    const handler = this.handlers.get(method);
    if (!handler) {
      const response = {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
      return serializeJSONRPCResponse(response as any);
    }

    try {
      return await handler(request, client);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const response = {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: `Internal error: ${errorMessage}`,
        },
      };
      return serializeJSONRPCResponse(response as any);
    }
  }

  /**
   * Register a handler for a JSON-RPC method
   */
  registerHandler(method: string, handler: (request: JSONRPCRequest, client: WsClient) => Promise<string>): void {
    this.handlers.set(method, handler);
    this.log(`Registered handler for method: ${method}`);
  }

  /**
   * Unregister a handler
   */
  unregisterHandler(method: string): boolean {
    return this.handlers.delete(method);
  }

  /**
   * Send a notification to a client
   */
  sendNotification(client: WsClient, method: string, params?: Record<string, unknown>): void {
    if (client.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const notification = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });

    client.socket.send(notification);
  }

  /**
   * Broadcast a message to all authenticated clients
   */
  broadcast(method: string, params?: Record<string, unknown>): void {
    const notification = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });

    for (const client of this.clients.values()) {
      if (client.authenticated && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(notification);
      }
    }
  }

  /**
   * Send to a specific client by ID
   */
  sendToClient(clientId: string, method: string, params?: Record<string, unknown>): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.sendNotification(client, method, params);
    return true;
  }

  /**
   * Get all connected clients
   */
  getClients(): WsClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get authenticated clients
   */
  getAuthenticatedClients(): WsClient[] {
    return Array.from(this.clients.values()).filter((c) => c.authenticated);
  }

  /**
   * Get client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Send error response to client
   */
  private sendError(client: WsClient, id: string | number | null, code: number, message: string): void {
    if (client.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    client.socket.send(JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    }));
  }

  /**
   * Send response to client
   */
  private sendResponse(client: WsClient, response: object): void {
    if (client.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    client.socket.send(JSON.stringify(response));
  }

  /**
   * Stop the WebSocket server
   */
  stop(): void {
    if (!this.wss) {
      return;
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      client.socket.close(1000, "Server shutting down");
    }
    this.clients.clear();

    // Close the server
    this.wss.close(() => {
      this.log("WebSocketHub stopped");
    });

    this.wss = null;
    this.removeAllListeners();
  }

  /**
   * Get the server address
   */
  /**
   * Resolves after the underlying HTTP server is listening (needed when `port: 0`).
   */
  whenListening(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.wss) {
        reject(new Error("WebSocketHub not started"));
        return;
      }
      if (this.wss.address() !== null) {
        resolve();
        return;
      }
      this.wss.once("listening", () => resolve());
      this.wss.once("error", reject);
    });
  }

  getAddress(): { host: string; port: number } | null {
    if (!this.wss) {
      return null;
    }
    const la = this.wss.address();
    if (la !== null && typeof la === "object") {
      /** Loopback to connect from tests/clients when the server binds all interfaces */
      const connectHost =
        la.family === "IPv6" && la.address === "::"
          ? "::1"
          : la.address === "0.0.0.0"
            ? "127.0.0.1"
            : la.address;
      return { host: connectHost, port: la.port };
    }
    if (typeof la === "string") {
      return { host: this.host, port: this.port };
    }
    /* Listening callback not fired yet */
    return { host: this.host, port: this.port };
  }

  /**
   * Log a debug message
   */
  private log(message: string): void {
    if (this.debug) {
      console.error(`[WebSocketHub] ${message}`);
    }
  }
}

/**
 * Create a new WebSocketHub instance
 */
export function createWebSocketHub(options: WebSocketHubOptions): WebSocketHub {
  return new WebSocketHub(options);
}

/**
 * Generate a signed token for NM shim → daemon authentication.
 * Format: base64(profileId:timestamp:hmac-sha256)
 */
export function generateToken(profileId: string, authSecret: string): string {
  const timestamp = Date.now();
  const signature = createHmac("sha256", authSecret)
    .update(`${profileId}:${timestamp}`)
    .digest("hex");
  return Buffer.from(`${profileId}:${timestamp}:${signature}`).toString("base64");
}