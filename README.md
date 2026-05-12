# Navora

**Open-source browser automation runtime for AI agents.**

Navora bridges tool-calling AI clients (Claude, Cursor, and any MCP-compatible host) to a real Chrome instance. It exposes 13 browser control tools via the Model Context Protocol over stdio, routing all execution through a local daemon with a per-tab CDP connection pool.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/KloutDevs/navora/actions/workflows/ci.yml/badge.svg)](https://github.com/KloutDevs/navora/actions/workflows/ci.yml)

---

## Quick start

### Claude Code

```bash
claude mcp add navora node /path/to/navora/apps/claude-plugin/dist/index.js
```

Or with npx:

```bash
claude mcp add navora npx navora-claude-plugin
```

### Cursor

Add to your MCP config (`~/.cursor/mcp.json` or workspace `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "navora": {
      "command": "node",
      "args": ["/path/to/navora/apps/cursor-plugin/dist/index.js"]
    }
  }
}
```

### Requirements

- Node.js 20+
- Chrome, Brave, or any Chromium-based browser with remote debugging enabled

Chrome is launched automatically if not already running. To start it manually:

```bash
# Chrome
chrome --remote-debugging-port=9222

# Brave
brave --remote-debugging-port=9222
```

---

## Available tools

| Tool | Description |
|------|-------------|
| `browser_get_tabs` | List all open tabs with URLs and titles |
| `browser_navigate` | Navigate a tab to a URL |
| `browser_go_back` | Go back in browser history |
| `browser_reload` | Reload the current page |
| `browser_screenshot` | Capture a PNG screenshot (returned as base64) |
| `browser_get_dom` | Get the serialized DOM with `data-abr-id` on interactive elements |
| `browser_get_text` | Extract visible text content from the page |
| `browser_click` | Click an element by CSS selector or `data-abr-id` |
| `browser_type` | Type text into a focused input or specific element |
| `browser_scroll` | Scroll the page or a specific element |
| `browser_wait_for` | Wait for a CSS selector to appear in the DOM |
| `browser_execute_script` | Execute arbitrary JavaScript and return the result |
| `browser_get_console` | Read buffered console log entries from the page |

All tools accept an optional `tabId` parameter for multi-tab routing.

---

## Architecture

```text
AI Client (MCP)
  │ stdio (JSON-RPC 2.0)
  ▼
apps/claude-plugin  ──── or ────  apps/cursor-plugin
  │ startup: ensures Chrome + daemon are running
  │ WebSocket :51520 (JSON-RPC 2.0)
  ▼
apps/daemon  (WebSocket hub, auth, routing)
  │
  ▼
packages/browser-tools / DirectCDPAdapter
  │ per-tab CDP WebSocket :9222
  ▼
Chrome browser
```

The daemon is a lightweight Node.js process that:
- Accepts WebSocket connections from plugin clients (token-authenticated)
- Maintains a per-tab CDP connection pool
- Routes `tools/call` requests to the correct tab's `CommandExecutor`
- Enforces a single-instance guarantee via lockfile

The full dispatcher pipeline (permissions, rate limiting, SQLite persistence) is available in `apps/daemon/src/dispatcher/` and can be wired in for production use cases.

### Package layout

| Package | Role |
|---------|------|
| `apps/claude-plugin` | MCP server for Claude Code |
| `apps/cursor-plugin` | MCP server for Cursor (shares claude-plugin source) |
| `apps/daemon` | WebSocket hub + CDP routing daemon |
| `apps/extension` | Chrome MV3 extension (alternative transport via Native Messaging) |
| `packages/browser-tools` | `BrowserAdapter` interface, `DirectCDPAdapter`, `CommandExecutor` |
| `packages/mcp` | `MCPServerBuilder` / `MCPServer` — JSON-RPC 2.0 over stdio |
| `packages/protocol` | Wire types: `NMMessage`, `NMEnvelope`, `WSMessage` |
| `packages/shared` | `Result<T,E>`, `Logger`, ULID, redaction helpers |

---

## Development

### Setup

```bash
pnpm install
pnpm build
```

### Commands

```bash
pnpm build        # Build all packages (Turborepo)
pnpm test         # Run all tests
pnpm lint         # Lint all packages
pnpm typecheck    # Type-check without emitting

# Per-package
pnpm --filter @navora/daemon test
pnpm --filter @navora/browser-tools test

# Single file
pnpm vitest run apps/daemon/tests/integration.test.ts
```

### Build order

When making changes, build in dependency order:

```bash
pnpm --filter @navora/browser-tools build
pnpm --filter @navora/daemon build
pnpm --filter @navora/claude-plugin build
pnpm --filter @navora/cursor-plugin build
```

---

## Environment variables

### Daemon and Claude plugin

| Variable | Default | Description |
|----------|---------|-------------|
| `NAVORA_CDP_PORT` | `9222` | Chrome remote debugging port (plugin probes `9222`–`9224` unless overridden) |
| `NAVORA_DAEMON_PORT` | `51520` | Daemon WebSocket port |
| `NAVORA_DAEMON_HOST` | `127.0.0.1` | Daemon host |
| `NAVORA_AUTH_SECRET` | `dev-secret-change-in-production` | Token signing secret |
| `NAVORA_DAEMON_BINARY` | auto-detected | Path to `apps/daemon/dist/main.js` |
| `NAVORA_PROFILE_ID` | `default` | Profile ID for multi-profile routing |
| `NAVORA_DEBUG` | — | Set to `1` to enable daemon debug logging |

### Native Messaging shim (`nm-shim`, extension → daemon)

| Variable | Default | Description |
|----------|---------|-------------|
| `NAVORA_RUNTIME_TOKEN` | — | Required WebSocket auth token for shim → daemon |
| `NAVORA_RUNTIME_HOST` | `127.0.0.1` | Daemon host |
| `NAVORA_RUNTIME_PORT` | `51520` | Daemon WebSocket port |
| `NAVORA_RUNTIME_LOCKDIR` | — | Lockfile directory (optional; default under system temp) |
| `NAVORA_RUNTIME_DAEMON_PATH` | `dist/index.js` | Override path when spawning the daemon |
| `NAVORA_RUNTIME_MODE` | — | Internal: marks subprocess spawned as daemon |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branching, and coding guidelines.

## Security

See [SECURITY.md](SECURITY.md) for responsible disclosure.

## License

MIT — see [LICENSE](LICENSE).
