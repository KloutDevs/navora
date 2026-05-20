# Navora

**Open-source browser automation runtime for AI agents.**

Navora bridges tool-calling AI clients (Claude, Cursor, and any MCP-compatible host) to a real Chrome instance. It exposes browser control tools via the Model Context Protocol over stdio.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/KloutDevs/navora/actions/workflows/ci.yml/badge.svg)](https://github.com/KloutDevs/navora/actions/workflows/ci.yml)

---

## Quick start

### Option A — Recommended (Extension path)

Works on any page without enabling Chrome debug mode.

**1. Run the installer**

```bash
npx navora
```

The interactive installer sets up the daemon and Native Messaging host on your machine.

**2. Install the Chrome extension**

- Download the `.zip` from the [latest GitHub Release](https://github.com/KloutDevs/navora/releases)
- Unzip the archive
- Open `chrome://extensions` in Chrome
- Enable **Developer mode** (toggle in the top-right corner)
- Click **Load unpacked** and select the unzipped folder

> Sideloaded extensions persist across Chrome restarts but must be re-loaded after Chrome updates.

**3. Verify the setup**

```bash
navora doctor
```

Exit 0 means the daemon is reachable and healthy. Exit 1 means the daemon is unreachable — check that the installer completed without errors.

---

### Option B — Developer (CDP path)

Requires Chrome with remote debugging enabled. Gives access to additional low-level CDP tools (`cdp_evaluate`, `cdp_send_command`, `cdp_network_har`). No extension needed.

**1. Start Chrome with remote debugging**

```bash
# Chrome
chrome --remote-debugging-port=9222

# Brave
brave --remote-debugging-port=9222
```

**2. Register the MCP plugin**

Claude Code:

```bash
claude mcp add navora npx navora-claude-plugin
```

Cursor — add to `~/.cursor/mcp.json` or workspace `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "navora": {
      "command": "npx",
      "args": ["navora-claude-plugin"]
    }
  }
}
```

**Requirements:** Node.js 20+, Chrome or any Chromium-based browser.

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
| `browser_wait_for` | Wait for a CSS selector or text content to appear in the page (`text` and `caseSensitive` params available) |
| `browser_execute_script` | Execute arbitrary JavaScript and return the result |
| `browser_get_console` | Read buffered console log entries from the page |

All tools accept an optional `tabId` parameter for multi-tab routing.

### Developer-only tools (CDP path required)

These tools require Chrome started with `--remote-debugging-port=9222`.

| Tool | Description |
|------|-------------|
| `cdp_evaluate` | Evaluate a JavaScript expression via the CDP Runtime domain |
| `cdp_send_command` | Send an arbitrary CDP command and return the result |
| `cdp_network_har` | Export a HAR archive of captured network activity |

---

## Architecture

Navora supports two transport paths:

```text
AI Client (MCP/stdio)
  |
  v
navora-claude-plugin / navora-cursor-plugin
  |
  +-- Extension path (Native Messaging):
  |     daemon <-> nm-shim <-> Chrome extension <-> Chrome
  |
  +-- CDP path (developer):
        daemon <-> DirectCDPAdapter <-> Chrome :9222
```

**Extension path** routes tool calls through the Navora Chrome extension via Native Messaging. The extension runs in the browser context with full page access, so no debug port is needed.

**CDP path** connects directly to Chrome's DevTools Protocol. Simpler setup, but requires starting Chrome with `--remote-debugging-port`.

The daemon is a lightweight Node.js process that:
- Accepts WebSocket connections from plugin clients (token-authenticated)
- Routes `tools/call` requests to the correct tab's executor
- Enforces a single-instance guarantee via lockfile

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

### Daemon and plugin

| Variable | Default | Description |
|----------|---------|-------------|
| `NAVORA_CDP_PORT` | `9222` | Chrome remote debugging port |
| `NAVORA_DAEMON_PORT` | `51520` | Daemon WebSocket port |
| `NAVORA_DAEMON_HOST` | `127.0.0.1` | Daemon host |
| `NAVORA_AUTH_SECRET` | `dev-secret-change-in-production` | Token signing secret |
| `NAVORA_DAEMON_BINARY` | auto-detected | Path to `apps/daemon/dist/main.js` |
| `NAVORA_PROFILE_ID` | `default` | Profile ID for multi-profile routing |
| `NAVORA_DEBUG` | — | Set to `1` to enable daemon debug logging |

### Native Messaging shim (extension path)

| Variable | Default | Description |
|----------|---------|-------------|
| `NAVORA_RUNTIME_TOKEN` | — | Required WebSocket auth token for shim → daemon |
| `NAVORA_RUNTIME_HOST` | `127.0.0.1` | Daemon host |
| `NAVORA_RUNTIME_PORT` | `51520` | Daemon WebSocket port |
| `NAVORA_RUNTIME_LOCKDIR` | — | Lockfile directory (default: system temp) |
| `NAVORA_RUNTIME_DAEMON_PATH` | `dist/index.js` | Override path when spawning the daemon |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branching, and coding guidelines.

## Security

See [SECURITY.md](SECURITY.md) for responsible disclosure.

## License

MIT — see [LICENSE](LICENSE).
