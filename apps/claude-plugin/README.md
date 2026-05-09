# @ai-browser-runtime/claude-plugin

MCP plugin for [Claude Code](https://claude.ai/code) — gives Claude direct control over a Chrome browser via CDP.

## Install

```bash
claude mcp add ai-browser node /path/to/navora/apps/claude-plugin/dist/index.js
```

Once published to npm:

```bash
claude mcp add ai-browser npx @ai-browser-runtime/claude-plugin
```

## How it works

On first use the plugin:
1. Checks if Chrome is reachable on CDP port `9222` — launches it if not
2. Checks if the Navora daemon is running on `:51432` — spawns it if not
3. Connects to the daemon via WebSocket and authenticates
4. Routes all tool calls through the daemon to the correct browser tab

## Tools

See the [root README](../../README.md#available-tools) for the full tool reference.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_BROWSER_CDP_PORT` | `9222` | Chrome remote debugging port |
| `AI_BROWSER_DAEMON_PORT` | `51432` | Daemon port |
| `AI_BROWSER_AUTH_SECRET` | `dev-secret-change-in-production` | Shared signing secret |
| `AI_BROWSER_DAEMON_BINARY` | auto | Path override for daemon binary |

## License

MIT
