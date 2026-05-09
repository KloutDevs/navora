/**
 * NM Shim Framing
 * 
 * Implements 4-byte little-endian length prefix framing for native messaging.
 * This is identical to the daemon's framing layer but standalone for the shim.
 */

import { Buffer } from "buffer";

/**
 * Header size in bytes (4 bytes for length prefix)
 */
export const headerSize = 4;

/**
 * Maximum message size (1MB as per Chrome native messaging spec)
 */
export const maxMessageSize = 1024 * 1024;

/**
 * Read length prefix from buffer
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
 * Create a framed message buffer (length prefix + payload)
 */
export function frameMessage(message: Buffer): Buffer {
  const length = message.length;

  if (length > maxMessageSize) {
    throw new Error(`Message too large: ${length} bytes`);
  }

  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(length, 0);

  return Buffer.concat([header, message]);
}

/**
 * Check if complete message is in buffer
 */
export function isCompleteMessage(buffer: Buffer): boolean {
  if (buffer.length < headerSize) {
    return false;
  }

  const length = buffer.readUInt32LE(0);
  return buffer.length >= headerSize + length;
}

/**
 * Extract complete message from buffer
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