/**
 * NM Multiplexer for multi-profile routing
 * Manages multiple NMConnections and routes messages by profile ID
 */

import { EventEmitter } from "events";
import { Buffer } from "buffer";
import type { NMConnection, NMConnectionConfig } from "./connection";
import { createNMConnection } from "./connection";

/**
 * Route context for message routing
 */
export interface RouteContext {
  profileId: string;
  connectionId: string;
  timestamp: number;
}

/**
 * Multiplexer configuration
 */
export interface MultiplexerConfig {
  /** Base configuration for connections */
  defaultConnectionConfig: Omit<NMConnectionConfig, "connectionId" | "profileId">;
  /** Called when new connection is created */
  onConnectionCreated?: (connection: NMConnection, profileId: string) => void;
  /** Called when connection is closed */
  onConnectionClosed?: (connection: NMConnection, profileId: string) => void;
  /** Logger (optional) */
  logger?: {
    debug?: (msg: string) => void;
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

/**
 * NMMultiplexer manages multiple profile connections
 */
export class NMMultiplexer extends EventEmitter {
  private connections: Map<string, NMConnection> = new Map();
  private config: MultiplexerConfig;
  private logger?: MultiplexerConfig["logger"];
  
  constructor(config: MultiplexerConfig) {
    super();
    this.config = config;
    this.logger = config.logger;
  }
  
  /**
   * Get or create a connection for a profile
   */
  getConnection(profileId: string): NMConnection | undefined {
    return this.connections.get(profileId);
  }
  
  /**
   * Get all active profile IDs
   */
  getProfileIds(): string[] {
    return Array.from(this.connections.keys());
  }
  
  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }
  
  /**
   * Check if profile has an active connection
   */
  hasConnection(profileId: string): boolean {
    const conn = this.connections.get(profileId);
    return conn?.isConnected() ?? false;
  }
  
  /**
   * Register a new connection for a profile
   */
  registerConnection(profileId: string, connection: NMConnection): void {
    // Clean up existing connection for this profile if any
    const existing = this.connections.get(profileId);
    if (existing) {
      existing.destroy();
    }
    
    this.connections.set(profileId, connection);
    
    // Forward events from connection
    connection.on("message", (message: Buffer) => {
      const context: RouteContext = {
        profileId,
        connectionId: connection.getConnectionId(),
        timestamp: Date.now(),
      };
      this.emit("message", message, context);
    });
    
    connection.on("disconnect", (error?: Error) => {
      this.logger?.info?.(`Multiplexer: profile ${profileId} disconnected${error ? ` - ${error.message}` : ""}`);
      this.connections.delete(profileId);
      this.config.onConnectionClosed?.(connection, profileId);
      this.emit("disconnect", { profileId, error });
    });
    
    connection.on("error", (error: Error) => {
      this.logger?.error?.(`Multiplexer: profile ${profileId} error - ${error.message}`);
      this.emit("error", { profileId, error });
    });
    
    this.logger?.info?.(`Multiplexer: registered connection for profile ${profileId}`);
    this.config.onConnectionCreated?.(connection, profileId);
    this.emit("connect", { profileId });
  }
  
  /**
   * Create and register a new connection for a profile
   */
  createConnection(profileId: string, stream: { read: any; write: any }): NMConnection {
    const connectionConfig: NMConnectionConfig = {
      connectionId: `${profileId}-${Date.now()}`,
      profileId,
      ...this.config.defaultConnectionConfig,
    };
    
    const connection = createNMConnection(connectionConfig);
    connection.connect(stream);
    this.registerConnection(profileId, connection);
    
    return connection;
  }
  
  /**
   * Send a message to a specific profile
   */
  async sendToProfile(profileId: string, message: Buffer): Promise<{ success: boolean; error?: Error }> {
    const connection = this.connections.get(profileId);
    
    if (!connection || !connection.isConnected()) {
      return { success: false, error: new Error(`No active connection for profile ${profileId}`) };
    }
    
    const result = await connection.send(message);
    return {
      success: result.ok,
      error: result.ok ? undefined! : result.error,
    };
  }
  
  /**
   * Broadcast a message to all connected profiles
   */
  async broadcast(message: Buffer): Promise<Map<string, { success: boolean; error?: Error }>> {
    const results = new Map<string, { success: boolean; error?: Error }>();
    
    for (const [profileId, connection] of this.connections) {
      if (connection.isConnected()) {
        const result = await connection.send(message);
        results.set(profileId, {
          success: result.ok,
          error: result.ok ? undefined! : result.error,
        });
      } else {
        results.set(profileId, {
          success: false,
          error: new Error("Not connected"),
        });
      }
    }
    
    return results;
  }
  
  /**
   * Remove a connection for a profile
   */
  removeConnection(profileId: string): boolean {
    const connection = this.connections.get(profileId);
    
    if (connection) {
      connection.destroy();
      this.connections.delete(profileId);
      this.logger?.info?.(`Multiplexer: removed connection for profile ${profileId}`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Disconnect all connections
   */
  disconnectAll(): void {
    for (const [profileId, connection] of this.connections) {
      connection.disconnect();
      this.logger?.info?.(`Multiplexer: disconnected profile ${profileId}`);
    }
    
    this.connections.clear();
  }
  
  /**
   * Get connection states
   */
  getConnectionStates(): Map<string, string> {
    const states = new Map<string, string>();
    
    for (const [profileId, connection] of this.connections) {
      states.set(profileId, connection.getState());
    }
    
    return states;
  }
  
  /**
   * Destroy the multiplexer
   */
  destroy(): void {
    this.disconnectAll();
    this.removeAllListeners();
  }
}

/**
 * Create a new NMMultiplexer
 */
export function createNMMultiplexer(config: MultiplexerConfig): NMMultiplexer {
  return new NMMultiplexer(config);
}