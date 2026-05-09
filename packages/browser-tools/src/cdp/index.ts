/**
 * CDP module — Chrome DevTools Protocol client for browser automation.
 */

export { DevToolsProtocol, type CDPClientOptions, type CDPCommand, type CDPResponse, type CDPEvent, type CDPEventListener, DevToolsProtocolError } from "./client";
export { TabManager, type TabManagerOptions } from "./tab-manager";
export { CommandExecutor, type CommandExecutorOptions } from "./executor";
export { ConnectionManager, type ConnectionManagerOptions, type TargetInfo } from "./connection";
export { createCDPErrorMapper, mapCDPError, type CDPErrorMapper } from "./errors";