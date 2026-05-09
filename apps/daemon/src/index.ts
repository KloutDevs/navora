/**
 * @navora/daemon - Persistence Layer
 * SQLite-based persistence for tool calls, connections, permissions, and blob cache
 */

// Re-export all persistence components
export {
  SqlitePersistenceLayer,
  type PersistenceConfig,
  type ConnectionRow,
  type ToolCallRow,
  type PermissionGrantRow,
  type CacheEntryRow,
  type SchemaMetaRow,
} from "./persistence/index";

export {
  createBlobStore,
  type BlobStore,
  type BlobMetadata,
  type BlobKind,
} from "./persistence/blob-store";

export {
  createRetentionWorker,
  type RetentionWorker,
  type RetentionConfig,
} from "./persistence/retention-worker";

export { runMigrations, getDatabaseVersion } from "./persistence/migrations";

// Re-export permissions components
export {
  SqlitePermissionStore,
  createPermissionStore,
  type PermissionStoreConfig,
  type PermissionCheck,
  type PermissionGrant,
  type ListedPermission,
} from "./permissions/permission-store";

export {
  ConfirmationGate,
  createConfirmationGate,
  type ConfirmationGateConfig,
  type ConfirmationRequest,
  type ConfirmationDecision,
  type PendingConfirmation,
} from "./permissions/confirmation-gate";

// Re-export NM bridge components
export {
  createFrameReader,
  createFrameWriter,
  type FrameReader,
  type FrameWriter,
  maxMessageSize,
  headerSize,
  frameMessage,
  readLengthPrefix,
  isCompleteMessage,
  extractMessage,
} from "./nm/framing";

export {
  NMConnection,
  createNMConnection,
  type NMConnectionConfig,
  type NMConnectionEvents,
  type ConnectionState,
} from "./nm/connection";

export {
  NMMultiplexer,
  createNMMultiplexer,
  type MultiplexerConfig,
  type RouteContext,
} from "./nm/multiplexer";

export {
  ChromeExtensionAdapter,
  createChromeExtensionAdapter,
  type ChromeExtensionAdapterConfig,
  type ChromeExtensionAdapterEvents,
} from "./nm/adapter";

export {
  createMessageChunker,
  type MessageChunker,
  type ChunkOptions,
  chunkSize,
  maxChunkSize,
  chunkMessage,
  getChunkCount,
} from "./nm/chunking";

// Re-export dispatcher components
export {
  RateLimiter,
  createRateLimiter,
  type RateLimiterConfig,
  type RateLimitResult,
} from "./dispatcher/rate-limiter";

export {
  AdapterRegistry,
  createAdapterRegistry,
  type AdapterRegistryConfig,
  type AdapterEntry,
  type AdapterStats,
} from "./dispatcher/adapter-registry";

export {
  Dispatcher,
  createDispatcher,
  type DispatcherConfig,
  type ToolRequest,
  type ToolResponse,
} from "./dispatcher/pipeline";

export {
  ResourceReader,
  createResourceReader,
  type ResourceReaderConfig,
  type ResourceContent,
  type ResourceEntry,
} from "./dispatcher/resource-reader";

// Re-export transport components
export {
  StdioTransport,
  createStdioTransport,
  runStdioServer,
  type StdioTransportOptions,
} from "./transport/stdio";

export {
  WebSocketHub,
  createWebSocketHub,
  type WsClient,
  type WebSocketHubOptions,
  type TokenValidationResult,
} from "./transport/websocket";

// Re-export lifecycle components
export {
  createDaemon,
  runDaemon,
  type DaemonConfig,
  type DaemonInstance,
  type DaemonState,
} from "./lifecycle/index";

export {
  LockfileManager,
  createLockfileManager,
  type LockfileData,
  type LockfileConfig,
} from "./lifecycle/lockfile";