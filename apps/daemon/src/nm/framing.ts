/**
 * Framing layer for Native Messaging protocol
 * Uses 4-byte little-endian length prefix framing
 */

import { Buffer } from "buffer";
import type { Readable, Writable } from "stream";
import type { Result } from "@navora/shared";
import { ok, err } from "@navora/shared";

/**
 * Maximum message size (1MB as per Chrome native messaging spec)
 */
export const maxMessageSize = 1024 * 1024;

/**
 * Header size in bytes (4 bytes for length prefix)
 */
export const headerSize = 4;

/**
 * FrameReader reads length-prefixed messages from a stream
 */
export interface FrameReader {
  /**
   * Read the next complete message
   */
  read(): Promise<Result<Buffer, Error>>;
  
  /**
   * Register a callback for incoming messages
   */
  onMessage(callback: (message: Buffer) => void): void;
  
  /**
   * Close the reader
   */
  close(): void;
}

/**
 * FrameWriter writes length-prefixed messages to a stream
 */
export interface FrameWriter {
  /**
   * Write a message (adds length prefix)
   */
  write(message: Buffer): Promise<Result<void, Error>>;
  
  /**
   * Flush any buffered data
   */
  flush(): Promise<Result<void, Error>>;
  
  /**
   * Close the writer
   */
  close(): void;
}

/**
 * Create a FrameReader from a Readable stream
 */
export function createFrameReader(stream: Readable): FrameReader {
  let buffer = Buffer.alloc(0);
  let messageCallback: ((message: Buffer) => void) | null = null;
  let closed = false;
  
  const processBuffer = async (): Promise<Result<Buffer, Error>> => {
    // Need at least header bytes
    if (buffer.length < headerSize) {
      return err(new Error("Incomplete header"));
    }
    
    // Read length prefix (little-endian)
    const length = buffer.readUInt32LE(0);
    
    // Validate length
    if (length > maxMessageSize) {
      return err(new Error(`Message too large: ${length} bytes`));
    }
    
    // Need complete message
    if (buffer.length < headerSize + length) {
      return err(new Error("Incomplete message"));
    }
    
    // Extract message
    const message = buffer.slice(headerSize, headerSize + length);
    
    // Shifts buffer (create new buffer)
    buffer = buffer.slice(headerSize + length);
    
    return ok(message);
  };
  
  const readNext = async (): Promise<Result<Buffer, Error>> => {
    if (closed) {
      return err(new Error("Reader closed"));
    }
    
    // Try to process existing buffer
    const result = await processBuffer();
    if (result.ok) {
      return result;
    }
    
    // Read more data
    return new Promise((resolve) => {
      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        
        // Try to process
        processBuffer().then((procResult) => {
          if (procResult.ok) {
            stream.removeListener("data", onData);
            resolve(procResult);
          } else if (buffer.length >= headerSize + maxMessageSize) {
            // Too much data, something is wrong
            stream.removeListener("data", onData);
            resolve(procResult);
          } else {
            // Need more data
            stream.once("data", onData);
          }
        });
      };
      
      stream.once("data", onData);
    });
  };
  
  // Set up data handler
  stream.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    
    // Try to process messages
    const processLoop = async () => {
      while (buffer.length >= headerSize) {
        const result = await processBuffer();
        if (result.ok && messageCallback) {
          messageCallback(result.value);
        } else if (!result.ok) {
          break; // Need more data
        }
      }
    };
    processLoop().catch(() => {
      // Ignore errors in background processing
    });
  });
  
  return {
    read: readNext,
    onMessage(callback: (message: Buffer) => void) {
      messageCallback = callback;
    },
    close() {
      closed = true;
      stream.destroy();
    },
  };
}

/**
 * Create a FrameWriter from a Writable stream
 */
export function createFrameWriter(stream: Writable): FrameWriter {
  let closed = false;
  
  return {
    async write(message: Buffer): Promise<Result<void, Error>> {
      if (closed) {
        return err(new Error("Writer closed"));
      }
      
      const length = message.length;
      
      // Validate size
      if (length > maxMessageSize) {
        return err(new Error(`Message too large: ${length} bytes`));
      }
      
      // Create framed message: 4-byte length + payload
      const header = Buffer.alloc(headerSize);
      header.writeUInt32LE(length, 0);
      const framed = Buffer.concat([header, message]);
      
      // Write to stream
      const canWrite = stream.write(framed);
      if (!canWrite) {
        // Wait for drain
        await new Promise<void>((resolve, reject) => {
          stream.once("drain", resolve);
          stream.once("error", reject);
        });
      }
      
      return ok(undefined);
    },
    
    async flush(): Promise<Result<void, Error>> {
      if (closed) {
        return err(new Error("Writer closed"));
      }
      
      const result = stream.write(Buffer.alloc(0));
      if (!result) {
        await new Promise<void>((resolve, reject) => {
          stream.once("drain", resolve);
          stream.once("error", reject);
        });
      }
      
      return ok(undefined);
    },
    
    close() {
      closed = true;
      stream.end();
    },
  };
}

/**
 * Utility: Write a framed message to a buffer list
 * Returns array of framed buffers (for efficient writing)
 */
export function frameMessage(message: Buffer): Buffer[] {
  const length = message.length;
  
  if (length > maxMessageSize) {
    throw new Error(`Message too large: ${length} bytes`);
  }
  
  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(length, 0);
  
  return [header, message];
}

/**
 * Utility: Read length prefix from buffer
 * Returns { length, remaining } or null if not enough data
 */
export function readLengthPrefix(buffer: Buffer): { length: number; remaining: Buffer } | null {
  if (buffer.length < headerSize) {
    return null;
  }
  
  const length = buffer.readUInt32LE(0);
  
  if (length > maxMessageSize) {
    throw new Error(`Message too large: ${length} bytes`);
  }
  
  const remaining = buffer.slice(headerSize);
  
  return { length, remaining };
}

/**
 * Utility: Check if complete message is in buffer
 */
export function isCompleteMessage(buffer: Buffer): boolean {
  if (buffer.length < headerSize) {
    return false;
  }
  
  const length = buffer.readUInt32LE(0);
  return buffer.length >= headerSize + length;
}

/**
 * Utility: Extract complete message from buffer
 * Returns { message, remaining } or null if incomplete
 */
export function extractMessage(buffer: Buffer): { message: Buffer; remaining: Buffer } | null {
  if (buffer.length < headerSize) {
    return null;
  }
  
  const length = buffer.readUInt32LE(0);
  
  if (length > maxMessageSize) {
    throw new Error(`Message too large: ${length} bytes`);
  }
  
  if (buffer.length < headerSize + length) {
    return null;
  }
  
  const message = buffer.slice(headerSize, headerSize + length);
  const remaining = buffer.slice(headerSize + length);
  
  return { message, remaining };
}