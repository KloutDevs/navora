# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Next focus: v0.3 tool parity — hover, drag, form fill, network capture, accessibility tree._

---

## [0.3.1] — 2026-05-21

### Changed

**Installer — wizard refactor**
- Replaced flat TUI menu with a sequential 4-step wizard (daemon → extension → Claude Code → Cursor). Steps are skipped automatically when a component is already configured.
- State persistence at `~/.navora/state.json` — subsequent runs detect installed components and jump straight to a status screen instead of repeating the full setup.
- `navora status`, `navora doctor`, `navora daemon [install|start|stop|uninstall]` — all commands now work as non-interactive subcommands in addition to the wizard flow.

**Installer — UI overhaul**
- NAVORA ASCII art banner with a 6-shade ANSI 256-color purple gradient (`colors.ts`).
- Full purple palette applied to step headers, status card rows (icons, labels, details), and the spinner.
- Custom ASCII bar spinner (`/ - \ |`, `spinner.ts`) replaces `@clack/prompts` spinner which produced flicker on Windows.

**Installer — branding cleanup**
- Native Messaging host name changed `com.ai-browser-runtime.nm` → `com.navora.nm`.
- Daemon lockfile and log paths changed from `%TEMP%/ai-browser-runtime/` → `%TEMP%/navora/`.

### Fixed

- Installer: `trim()` crash when pressing Enter without entering an extension ID — now safely returns `null` instead of calling `.trim()` on `undefined`.
- Installer: `readVersion()` path resolution corrected per tsup chunk split location (1 level up from `dist/` for the wizard chunk, 2 levels up from `dist/bin/` for the entry binary).
- Installer: daemon service install no longer blocks when no local build is present — falls back to `npx navora-daemon` automatically.

---

## [0.3.0] — 2026-05-19

### Added

**Browser tools — retry logic**
- `CommandExecutor.withRetry` — 2 attempts with `[200, 400]` ms backoff on transient CDP errors (codes `-1`, `-2`, `-3`, `-32000`). 10 action methods wrapped; `waitForSelector` and `waitForText` intentionally excluded (they use `pollUntil`).
- `isTransientCDPError(e)` — predicate used by `withRetry` to distinguish retriable from non-retriable failures.

**Browser tools — structured error codes**
- `CDPError` class with typed `code` and `method` fields, replacing bare `Error` objects across the CDP layer.
- `isCDPError(e)` type guard exported from `@navora/browser-tools`.
- `createCDPErrorMapper()` — converts `DevToolsProtocolError`, duck-typed objects, WebSocket errors, and unknowns into `CDPError`. Uses `instanceof DevToolsProtocolError` before duck-type fallback.

**Browser tools — `waitForText`**
- `CommandExecutor.waitForText(text, options?, tabId?)` → `Result<void, Error>`. Polls `document.body.innerText` via `Runtime.evaluate`; `caseSensitive` defaults to `false`.
- Propagated through `BrowserAdapter`, `DirectCDPAdapter`, `FakeAdapter`, and `NMAdapter`.

**Daemon — `browser_wait_for` text routing**
- `browser_wait_for` now accepts `{ text }` in addition to `{ selector }`. Empty params return a 400 validation error.
- `resolveErrorCode(e)` — maps CDPError codes to HTTP-style status codes: `-1`/`-3`/`-32000` → 503, `-2` → 504, "not found" messages → 404, default → 500.

**Extension — `wait_for` NM handler**
- `nm-handlers.ts`: `wait_for` handler routes `text` and `selector` via `document.body.innerText` polling and `document.querySelector` polling respectively, both injected into the MAIN world.

### Fixed
- `createDefaultLogger()` in `pipeline.ts` used `console.warn`/`console.error` as fallbacks. Now fully no-op — callers must inject a real logger.

### Testing
- `packages/browser-tools/tests/executor-retry.test.ts` — 4 cases: retry on transient, exhaustion, no-retry on non-transient, `waitForSelector` isolation.
- `packages/browser-tools/tests/executor-wait-for-text.test.ts` — 5 cases: first-poll match, N-poll match, timeout, case-insensitive, case-sensitive.
- `apps/daemon/tests/dispatcher-error-codes.test.ts` — `resolveErrorCode` for all CDP codes and generic errors.
- `apps/daemon/tests/dispatcher-browser-wait-for.test.ts` — text/selector routing, empty-params 400, `caseSensitive` forwarding.

---

## [0.2.0] — 2026-05-13

### Added

**Extension — activity log**
- `apps/extension/src/background/activity-log.ts` — circular buffer (500 entries) with `chrome.storage.local` persistence and 160 ms debounce. Survives service worker restarts.
- Activity entries wired into the background dispatcher: every tool call, NM connect/disconnect, and error records a structured entry with client name, profile ID, duration, and a human-readable summary.
- `mcp/session` NM handler — the daemon can notify the extension when an MCP client connects or disconnects.
- `CLEAR_ACTIVITY_LOG` background message type — sidepanel can clear the log without touching the store.

**Extension — sidepanel**
- Sidepanel UI rework: activity feed replaces the old static log, shows tool calls, NM events, and errors in real time.
- Extension manifest renamed to **"Navora"**, version bumped to `0.2.0`.

**Installer**
- Interactive TUI (`@clack/prompts`) for guided setup of the NM host, extension, and daemon.
- Cross-platform daemon service management: Windows Registry `Run` key, `systemd --user`, `launchd LaunchAgent`.
- Browser detection (Chrome, Brave, Edge, Chromium) on Windows, macOS, and Linux with NM host registration.
- Pre-generated 30-day HMAC shim token written into the shim wrapper so no extra auth step is needed on first connection.
- Shim wrapper now resolves the full `node` binary path (Chrome launches NM hosts with a minimal `PATH`).
- Installer points users to the extensions page reload button instead of requiring a full browser restart.

**Daemon**
- `generateToken()` utility exported for nm-shim / daemon auth.
- WebSocket `server.on('error')` now emits unconditionally (was debug-only).
- `setInterval` keepalive added to guard against event loop drain.
- `killPortOwner()` clears zombie processes before startup.
- Default port changed from `51432` → `51520` (51432 is in the Windows excluded port range).
- Daemon stderr now logged to `%TEMP%/ai-browser-runtime/daemon.log`.
- `PERSISTENCE_ONLY_TOOLS` constant extracted — eliminates triplicated `skipAdapter` logic across `pipeline.ts` and `lifecycle/index.ts`.
- 3 new raw CDP tools exposed via `cdp-direct-tools.ts`.

**Packages**
- `packages/browser-tools`: `NmAdapter` and `NmTypes` added for NM-backed tool execution.
- `apps/claude-plugin`: `tool-dispatcher.ts` extracted from `index.ts`; Chrome auto-launch removed (verify-only mode).
- `daemon-launcher.ts`: detects monorepo vs npm context, falls back to `npx navora-daemon` when running from an npm install.

**Testing**
- `@vitest/coverage-v8` configured with anti-regression thresholds (63/63/72/70), target watermarks at 80 %.
- Test suites added for `apps/installer` (`cursor-config`, `probes`, `format-installer-summary`) and `apps/claude-plugin` (7 tests).
- `apps/daemon`: transport (31 tests), dispatcher routing (7 tests), permissions (11 tests).
- HMAC token generation/validation tests (7 cases) and `PERSISTENCE_ONLY_TOOLS` coverage.
- Stale-lockfile regression test for the Windows `tasklist` exit-0 bug.
- CI workflow added (GitHub Actions).

**npm publishing**
- `@navora/daemon` renamed to `navora-daemon` for flat npm publish; build switched from `tsc` to `tsup` (bundles `@navora/*` deps).
- `better-sqlite3` marked optional (unused in the direct-adapter path).
- `navora-claude-plugin` and `navora-cursor-plugin` published at `0.2.0`.

### Changed
- All packages renamed from `@ai-browser-runtime/*` scope to `@navora/*`.
- WebSocket token expiry window extended from **24 hours to 30 days** to match installer-generated shim token lifetime.
- `ActivityLogEntry` / `store.addActivityLog` removed from the Zustand store — activity state is now owned by the standalone `activity-log` module.
- `ConnectionStatus` interface moved from `nm-client.ts` to `src/shared/types.ts`.

### Fixed
- TypeScript widening of `id` literals in `detectNmBrowsers()` browser profile arrays (added `as const` + `satisfies NmBrowserProfile[]`).
- Windows `isProcessRunning()` now checks PID in `tasklist` output (was returning `true` for any exit-0 result).
- `ulid` monotonic test (flaky timing) and `nm-shim` lockfile test (missing env isolation).
- Installer: Cursor MCP was configured with `navora-claude-plugin` instead of `navora-cursor-plugin`.

---

## [0.1.0] — 2026-04-28

### Added
- `DirectCDPAdapter` — `BrowserAdapter` implementation backed by per-tab CDP WebSocket connections.
- Daemon WebSocket hub as the central routing layer between MCP plugins and Chrome.
- Standalone daemon binary (`apps/daemon/src/main.ts`) auto-spawned by plugins on first use.
- `apps/claude-plugin` and `apps/cursor-plugin` route all tool calls through the daemon.
- `browser_get_console` — buffered console log capture via injected `window.__abrConsoleLogs` interceptor.
- Multi-tab support with per-tab `DevToolsProtocol` + `CommandExecutor` connection pool.
- Tab switching via `Target.activateTarget` using correct CDP UUID target IDs.
- React-compatible `browser_type` using `Input.insertText` + dispatched `input`/`change` events.
- SQLite persistence layer (`better-sqlite3`): tool call log, connection registry, permission store, blob store (payloads > 10 KB).
- `ConfirmationGate` and `RateLimiter` wired into the dispatcher pipeline (dormant — activated in v0.4).
- `@navora/protocol` — wire types (`NMMessage`, `NMEnvelope`, `WSMessage`, `WSEnvelope`, `ProtocolError`).
- `@navora/shared` — core utilities: `Result<T,E>`, `Logger`, `ulid`, `redact`.
- `@navora/browser-tools` — `BrowserAdapter` interface + CDP implementation.
- `@navora/mcp` — `MCPServerBuilder` / `MCPServer` (JSON-RPC 2.0 over stdio).
- NM bridge: 4-byte LE length-prefix framing, `NMConnection`, `NMMultiplexer` (routes by profile ID).
- `nm-shim` binary — bridges Chrome extension (stdio) ↔ daemon (WebSocket); spawns daemon if not running.
- WebSocket token auth using `HMAC-SHA256`.
- pnpm + Turborepo monorepo setup with `tsconfig` hierarchy, ESLint, and Vitest.

### Fixed
- `browser_go_back` uses `Runtime.evaluate` + `window.history.back()`.
- `browser_click` CDP response shape (`result.objectId` not `result.object.objectId`).
- Sequential `tabId` assignment in `TabManager.syncTabs` (replaces broken `parseInt(uuid)`).
- `exactOptionalPropertyTypes` errors in `wsUrl` and `clickElement`.
