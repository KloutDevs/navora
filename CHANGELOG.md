# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `DirectCDPAdapter` — `BrowserAdapter` implementation backed by per-tab CDP WebSocket connections
- Daemon WebSocket hub (`apps/daemon`) as the central routing layer between MCP plugins and Chrome
- `apps/daemon/src/main.ts` — standalone daemon binary auto-spawned by plugins on startup
- `apps/claude-plugin` and `apps/cursor-plugin` now route all tool calls through the daemon
- `browser_get_console` — buffered console log capture via injected `window.__abrConsoleLogs` interceptor
- Multi-tab support with per-tab `DevToolsProtocol` + `CommandExecutor` connection pool
- Tab switching via `Target.activateTarget` using correct CDP UUID target IDs
- React-compatible `browser_type` using `Input.insertText` + dispatched `input`/`change` events
- Fixed `browser_go_back` to use `Runtime.evaluate` with `window.history.back()`
- Fixed `browser_click` CDP response shape (`result.objectId` not `result.object.objectId`)
- Sequential `tabId` assignment in `TabManager.syncTabs` (replaces broken `parseInt(uuid)`)
