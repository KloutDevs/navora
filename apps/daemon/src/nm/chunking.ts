/**
 * Message chunking for large payloads
 * Handles messages > 700KB by splitting into chunks
 */

import { Buffer } from "buffer";

/**
 * Chunk header size: 4 bytes for chunk index + 4 bytes for total chunks
 */
export const chunkHeaderSize = 8;

/**
 * Default chunk size (700KB for safe transmission)
 */
export const chunkSize = 700 * 1024;

/**
 * Maximum allowed chunk size
 */
export const maxChunkSize = 1024 * 1024 - chunkHeaderSize;

/**
 * Chunk options
 */
export interface ChunkOptions {
  /** Maximum size per chunk (default: 700KB) */
  maxChunkSize?: number;
}

/**
 * MessageChunker handles large message splitting and reassembly
 */
export interface MessageChunker {
  /**
   * Split a large message into chunks
   * Returns array of chunked buffers, or single buffer if under limit
   */
  chunk(message: Buffer): Buffer[];
  
  /**
   * Check if a message needs chunking
   */
  needsChunking(message: Buffer): boolean;
  
  /**
   * Reassemble chunks into original message
   * Returns null if incomplete
   */
  assemble(chunks: Buffer[]): Buffer | null;
  
  /**
   * Check if a set of chunks is complete
   */
  isComplete(chunks: Buffer[]): boolean;
  
  /**
   * Get chunk metadata from first chunk
   */
  getChunkMeta(chunks: Buffer[]): { index: number; total: number; totalSize: number } | null;
  
  /**
   * Clear pending chunks for reassembly
   */
  clearPending(): void;
}

/**
 * Internal chunk metadata attached to reassembled messages
 */
interface ChunkMeta {
  index: number;
  total: number;
  originalSize: number;
}

/**
 * Create a MessageChunker
 */
export function createMessageChunker(options?: ChunkOptions): MessageChunker {
  const maxSize = options?.maxChunkSize ?? chunkSize;
  
  // Pending chunks for reassembly, keyed by message ID
  const pendingChunks: Map<string, { chunks: Buffer[]; meta: ChunkMeta }> = new Map();
  
  return {
    chunk(message: Buffer): Buffer[] {
      const payloadSize = message.length;
      
      // Don't chunk if under limit
      if (payloadSize <= maxSize) {
        return [message];
      }
      
      // Calculate how many chunks needed
      const chunks: Buffer[] = [];
      const totalChunks = Math.ceil(payloadSize / maxSize);
      
      let offset = 0;
      let chunkIndex = 0;
      
      while (offset < payloadSize) {
        const remaining = payloadSize - offset;
        const chunkLen = Math.min(remaining, maxSize);
        
        // Create chunk with header
        const chunk = Buffer.alloc(chunkHeaderSize + chunkLen);
        
        // Header: chunk index (4 bytes) + total chunks (4 bytes)
        chunk.writeUInt32LE(chunkIndex, 0);
        chunk.writeUInt32LE(totalChunks, 4);
        
        // Copy payload
        message.copy(chunk, chunkHeaderSize, offset, offset + chunkLen);
        
        chunks.push(chunk);
        
        offset += chunkLen;
        chunkIndex++;
      }
      
      return chunks;
    },
    
    needsChunking(message: Buffer): boolean {
      return message.length > maxSize;
    },
    
    assemble(chunks: Buffer[]): Buffer | null {
      if (chunks.length === 0) {
        return null;
      }
      
      // Get metadata from first chunk (guaranteed to exist)
      const firstChunk = chunks[0]!;
      const chunkIndex = firstChunk.readUInt32LE(0);
      const totalChunks = firstChunk.readUInt32LE(4);
      
      // Use both first index and total as key
      const key = `msg-${chunkIndex}-${totalChunks}`;
      
      if (chunkIndex === 0) {
        // First chunk - start new assembly
        pendingChunks.set(key, {
          chunks: [firstChunk.slice(chunkHeaderSize)],
          meta: {
            index: 0,
            total: totalChunks,
            originalSize: firstChunk.length - chunkHeaderSize,
          },
        });
      } else {
        // Subsequent chunk
        const pending = pendingChunks.get(key);
        if (!pending) {
          // Missing first chunk - start new assembly anyway
          pendingChunks.set(key, {
            chunks: [firstChunk.slice(chunkHeaderSize)],
            meta: {
              index: chunkIndex,
              total: totalChunks,
              originalSize: firstChunk.length - chunkHeaderSize,
            },
          });
        } else {
          pending.chunks.push(firstChunk.slice(chunkHeaderSize));
          pending.meta.originalSize += firstChunk.length - chunkHeaderSize;
        }
      }
      
      // Check if complete
      const pending = pendingChunks.get(key);
      if (!pending || pending.chunks.length < totalChunks) {
        return null;
      }
      
      // Assemble
      const assembled = Buffer.concat(pending.chunks);
      pendingChunks.delete(key);
      
      return assembled;
    },
    
    isComplete(chunks: Buffer[]): boolean {
      if (chunks.length === 0) {
        return false;
      }
      
      const firstChunk = chunks[0]!;
      const totalChunks = firstChunk.readUInt32LE(4);
      
      return chunks.length >= totalChunks;
    },
    
    getChunkMeta(chunks: Buffer[]): { index: number; total: number; totalSize: number } | null {
      if (chunks.length === 0) {
        return null;
      }
      
      const firstChunk = chunks[0]!;
      
      return {
        index: firstChunk.readUInt32LE(0),
        total: firstChunk.readUInt32LE(4),
        totalSize: firstChunk.length,
      };
    },
    
    clearPending(): void {
      pendingChunks.clear();
    },
  };
}

/**
 * Utility: chunk a message with automatic framing
 * Returns single buffer or array of chunked buffers
 */
export function chunkMessage(message: Buffer, options?: ChunkOptions): Buffer[] {
  const chunker = createMessageChunker(options);
  return chunker.chunk(message);
}

/**
 * Utility: calculate how many chunks a message would produce
 */
export function getChunkCount(messageSize: number, maxSize: number = chunkSize): number {
  if (messageSize <= maxSize) {
    return 1;
  }
  return Math.ceil(messageSize / maxSize);
}