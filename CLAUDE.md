# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build          # Build all packages (via Turbo)
pnpm test           # Run all tests (via Turbo)
pnpm lint           # Lint all packages
pnpm typecheck      # Type-check all packages without emitting

# Per-package commands
pnpm --filter @navora/daemon test
pnpm --filter @navora/browser-tools test

# Single test file
pnpm vitest run apps/daemon/tests/integration.test.ts

# Extension build (WXT)
pnpm --filter @navora/extension build

# Claude Code plugin
pnpm --filter @navora/claude-plugin build
```

## Architecture

This is a **pnpm + Turborepo monorepo** (`apps/*`, `packages/*`). The project is a browser automation runtime where AI tools execute actions in Chrome via a daemon + extension architecture.

### Data flow

```
AI Client (MCP)
   │ stdio (JSON-RPC 2.0)
   ▼
apps/daemon  ←→  WebSocket :51520  ←→  apps/daemon/src/nm-shim  (one process per Chrome profile)
                                               │ stdio (Native Messaging framing)
                                               ▼
                                     apps/extension (Chrome MV3)
                                               │ CDP WebSocket :9222
                                               ▼
                                           Chrome browser
```

### Apps

**`apps/claude-plugin`** — Claude Code MCP plugin (`@navora/claude-plugin`).
- Exposes 13 browser tools via MCP stdio to Claude Code.
- Auto-detects and launches Chrome on CDP port 9222 if not running.
- Connects to Chrome directly via CDP (no daemon required).
- Install: `claude mcp add ai-browser npx @navora/claude-plugin`
- `src/index.ts` — MCP server + tool registry. `src/browser.ts` — CDP session wrapper. `src/chrome-launcher.ts` — Chrome auto-launch.

**`apps/daemon`** — Node.js long-running process (ESM).
- `lifecycle/` — Startup, lockfile (single-instance guarantee).
- `transport/` — WebSocket hub (`ws`, default port `51520`) and stdio MCP transport.
- `nm/` — Native Messaging bridge: framing (4-byte LE length prefix), `NMConnection`, `NMMultiplexer` (routes by profile ID).
- `nm-shim/` — Separate binary that Chrome launches as the NM host. Bridges Chrome extension (stdio) ↔ daemon (WebSocket). Spawns the daemon if not running. Reads `NAVORA_RUNTIME_TOKEN`, `NAVORA_RUNTIME_HOST`, `NAVORA_RUNTIME_PORT`.
- `dispatcher/` — Core request pipeline: `validate → permissionCheck → rateLimit → adapterRoute → captureBlobs → redact → persist → respond` (`pipeline.ts`).
- `persistence/` — SQLite via `better-sqlite3`: tool calls, connections, permissions, blob store (large payloads >10 KB land here by kind: `screenshot`, `dom_snapshot`, `console_logs`).
- `permissions/` — `SqlitePermissionStore` + `ConfirmationGate`.

**`apps/extension`** — Chrome MV3 extension built with **WXT**.
- `background/` — Service worker: `nm-client.ts` (native messaging client), `store.ts` (reactive state with subscribe).
- `content/` — Content script entry point.
- `overlay/` — Visual overlay injection.

### Packages

| Package | Role |
|---|---|
| `@navora/protocol` | Wire types: `NMMessage`, `NMEnvelope`, `WSMessage`, `WSEnvelope`, `ProtocolError` |
| `@navora/shared` | Core utilities: `Result<T,E>`, `Logger`, `ulid`, `redact` |
| `@navora/browser-tools` | `BrowserAdapter` interface + CDP implementation (`packages/browser-tools/src/cdp/`) |
| `@navora/mcp` | `MCPServerBuilder` / `MCPServer` — JSON-RPC 2.0 over stdio |
| `@navora/ui` | UI components |

### Key patterns

**`Result<T, E>`** — All async operations return `Result<T, E>` (never throw). Always use `isOk()` / `isError()` guards from `@navora/shared` before accessing `.value` or `.error`.

**`BrowserAdapter`** — The single integration point between the daemon and the browser. All tool execution goes through this interface (`packages/browser-tools/src/adapter.ts`). The daemon never imports Chrome APIs. `FakeAdapter` (`fake-adapter.ts`) is used in tests.

**Dispatcher pipeline** — When adding a new tool, register it in `getKnownTools()` and `executeTool()` in `apps/daemon/src/dispatcher/pipeline.ts`. The pipeline handles permissions, rate-limiting, blob storage, and persistence automatically.

**Dependency rules** — `protocol` and `shared` are leaf packages. `mcp → protocol, shared`. `browser-tools → shared`. `daemon` sits at the top and depends on all packages. Never introduce reverse dependencies.

**Multi-profile** — Each Chrome profile runs its own `nm-shim` process. The `NMMultiplexer` in the daemon maintains one `NMConnection` per profile ID and routes messages accordingly.

### Environment / defaults

| Variable | Default | Purpose |
|---|---|---|
| `NAVORA_RUNTIME_TOKEN` | — | Required WebSocket auth token for shim → daemon |
| `NAVORA_RUNTIME_HOST` | `127.0.0.1` | Daemon host |
| `NAVORA_RUNTIME_PORT` | `51520` | Daemon WebSocket port |
| `NAVORA_CDP_PORT` | `9222` | Chrome remote debugging |

### Testing

Tests live in `tests/` next to each package's `src/`. The workspace vitest config (`vitest.workspace.ts`) registers all test suites by name (`daemon`, `extension`, `protocol`, etc.). Coverage thresholds: 80% lines/functions/statements, 70% branches.
