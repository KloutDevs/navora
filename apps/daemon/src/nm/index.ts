/**
 * NM (Native Messaging) Bridge Module
 * 
 * This module provides the communication layer between the daemon and Chrome extension
 * via native messaging protocol. It includes:
 * - Framing: 4-byte length prefix (little-endian uint32)
 * - Connection state machine: connected/disconnected/reconnecting
 * - Multiplexer: multi-profile routing
 * - Chrome extension adapter: wraps NM for extension communication
 * - Chunking: handles payloads > 700KB
 */

// Re-export all NM components
export {
  createFrameReader,
  createFrameWriter,
  type FrameReader,
  type FrameWriter,
  maxMessageSize,
  headerSize,
} from "./framing";

export {
  NMConnection,
  createNMConnection,
  type NMConnectionConfig,
  type NMConnectionEvents,
  type ConnectionState,
} from "./connection";

export {
  NMMultiplexer,
  createNMMultiplexer,
  type MultiplexerConfig,
  type RouteContext,
} from "./multiplexer";

export {
  ChromeExtensionAdapter,
  createChromeExtensionAdapter,
  type ChromeExtensionAdapterConfig,
  type ChromeExtensionAdapterEvents,
} from "./adapter";

export {
  createMessageChunker,
  type MessageChunker,
  type ChunkOptions,
  chunkSize,
  maxChunkSize,
} from "./chunking";