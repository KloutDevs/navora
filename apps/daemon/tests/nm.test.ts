/**
 * Unit tests for NM bridge components
 * Focus on utility functions and core logic
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Buffer } from "buffer";
import { frameMessage, readLengthPrefix, isCompleteMessage, extractMessage, headerSize, maxMessageSize } from "../src/nm/framing";
import { createNMConnection, type NMConnection } from "../src/nm/connection";
import { createNMMultiplexer, type NMMultiplexer } from "../src/nm/multiplexer";
import { createMessageChunker, chunkMessage, getChunkCount, chunkSize } from "../src/nm/chunking";

describe("Framing Utilities", () => {
  describe("frameMessage", () => {
    it("should create framed message with 4-byte header", () => {
      const message = Buffer.from("Hello", "utf8");
      const framed = frameMessage(message);
      
      expect(framed.length).toBe(2); // header + payload
      expect(framed[0].length).toBe(headerSize);
      expect(framed[0].readUInt32LE(0)).toBe(5); // length of "Hello"
      expect(framed[1].toString("utf8")).toBe("Hello");
    });
    
    it("should reject oversized messages", () => {
      const largeMessage = Buffer.alloc(maxMessageSize + 1);
      
      expect(() => frameMessage(largeMessage)).toThrow();
    });
  });
  
  describe("readLengthPrefix", () => {
    it("should read length and remaining buffer", () => {
      const message = Buffer.from("test data", "utf8");
      const framed = frameMessage(message);
      const combined = Buffer.concat(framed);
      
      const result = readLengthPrefix(combined);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.length).toBe(9);
        expect(result.remaining.toString("utf8")).toBe("test data");
      }
    });
    
    it("should return null for incomplete header", () => {
      const partial = Buffer.from("ab");
      const result = readLengthPrefix(partial);
      
      expect(result).toBeNull();
    });
  });
  
  describe("isCompleteMessage", () => {
    it("should return true for complete message", () => {
      const message = Buffer.from("complete", "utf8");
      const framed = frameMessage(message);
      const combined = Buffer.concat(framed);
      
      expect(isCompleteMessage(combined)).toBe(true);
    });
    
    it("should return false for incomplete message", () => {
      const partial = Buffer.from("abc");
      expect(isCompleteMessage(partial)).toBe(false);
    });
  });
  
  describe("extractMessage", () => {
    it("should extract complete message", () => {
      const message = Buffer.from("extract me", "utf8");
      const framed = frameMessage(message);
      const combined = Buffer.concat(framed);
      
      const result = extractMessage(combined);
      
      expect(result).not.toBeNull();
      if (result) {
        expect(result.message.toString("utf8")).toBe("extract me");
      }
    });
    
    it("should return null for incomplete", () => {
      const partial = Buffer.from("abc");
      const result = extractMessage(partial);
      
      expect(result).toBeNull();
    });
  });
});

describe("NMConnection", () => {
  it("should have correct initial state", () => {
    const conn = createNMConnection({
      connectionId: "test-id",
      profileId: "profile-1",
    });
    
    expect(conn.getState()).toBe("disconnected");
    expect(conn.getConnectionId()).toBe("test-id");
    expect(conn.getProfileId()).toBe("profile-1");
    expect(conn.isConnected()).toBe(false);
    
    conn.destroy();
  });
  
  it("should support event emission", () => {
    const conn = createNMConnection({
      connectionId: "test-id",
      profileId: "profile-1",
    });
    
    let eventEmitted = false;
    conn.on("stateChange", (state) => {
      if (state === "connecting") eventEmitted = true;
    });
    
    // The connection doesn't emit events until connected
    expect(eventEmitted).toBe(false);
    
    conn.destroy();
  });
});

describe("NMMultiplexer", () => {
  let mux: NMMultiplexer;
  
  beforeEach(() => {
    mux = createNMMultiplexer({
      defaultConnectionConfig: {
        connectTimeoutMs: 5000,
        maxReconnectAttempts: 3,
      },
    });
  });
  
  it("should start empty", () => {
    expect(mux.getConnectionCount()).toBe(0);
    expect(mux.getProfileIds()).toEqual([]);
    expect(mux.hasConnection("any")).toBe(false);
  });
  
  it("should return unknown profile as not connected", () => {
    expect(mux.hasConnection("unknown")).toBe(false);
  });
  
  it("should return error for send to unknown profile", async () => {
    const result = await mux.sendToProfile("unknown", Buffer.from("test"));
    
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
  
  it("should return empty for broadcast", async () => {
    const results = await mux.broadcast(Buffer.from("test"));
    
    expect(results.size).toBe(0);
  });
  
  it("should return empty connection states", () => {
    const states = mux.getConnectionStates();
    
    expect(states.size).toBe(0);
  });
  
  it("should remove non-existent gracefully", () => {
    const result = mux.removeConnection("unknown");
    
    expect(result).toBe(false);
  });
  
  it("should get undefined for unknown profile connection", () => {
    const conn = mux.getConnection("unknown");
    
    expect(conn).toBeUndefined();
  });
  
  it("should clean up on destroy", () => {
    mux.disconnectAll();
    mux.destroy();
    
    expect(mux.getConnectionCount()).toBe(0);
  });
});

describe("MessageChunker", () => {
  let chunker: ReturnType<typeof createMessageChunker>;
  
  beforeEach(() => {
    chunker = createMessageChunker({ maxChunkSize: 10 });
  });
  
  it("should not chunk small messages", () => {
    const message = Buffer.from("small");
    const chunks = chunker.chunk(message);
    
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual(message);
  });
  
  it("should chunk large messages", () => {
    const message = Buffer.from("ABCDEFGHIJ12345"); // 15 bytes
    const chunks = chunker.chunk(message);
    
    expect(chunks.length).toBe(2);
  });
  
  it("should correctly identify chunking need", () => {
    const small = Buffer.from("test");
    const large = Buffer.alloc(11);
    
    expect(chunker.needsChunking(small)).toBe(false);
    expect(chunker.needsChunking(large)).toBe(true);
  });
  
  it("should get chunk metadata", () => {
    const message = Buffer.from("ABCDEFGHIJ12345");
    const chunks = chunker.chunk(message);
    
    const meta = chunker.getChunkMeta(chunks);
    
    expect(meta).not.toBeNull();
    if (meta) {
      expect(meta.index).toBe(0);
      expect(meta.total).toBe(2);
    }
  });
  
  it("should check completion", () => {
    const message = Buffer.from("ABCDEFGHIJ12345");
    const chunks = chunker.chunk(message);
    
    expect(chunker.isComplete([chunks[0]!])).toBe(false);
    expect(chunker.isComplete(chunks)).toBe(true);
  });
  
  it("should clear pending", () => {
    chunker.clearPending();
    
    // Should not throw
  });
});

describe("chunkMessage utility", () => {
  it("should chunk with options", () => {
    const msg = Buffer.from("12345678901"); // 11 bytes
    const chunks = chunkMessage(msg, { maxChunkSize: 5 });
    
    expect(chunks.length).toBe(3);
  });
});

describe("getChunkCount", () => {
  it("should calculate chunk count", () => {
    expect(getChunkCount(100)).toBe(1);
    expect(getChunkCount(chunkSize + 1)).toBe(2);
    expect(getChunkCount(chunkSize * 2 + 1)).toBe(3);
  });
});