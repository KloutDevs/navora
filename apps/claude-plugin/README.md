# @navora/claude-plugin

MCP plugin for [Claude Code](https://claude.ai/code) — gives Claude direct control over a Chrome browser via CDP.

## Install

```bash
claude mcp add ai-browser node /path/to/navora/apps/claude-plugin/dist/index.js
```

Or with npx:

```bash
claude mcp add ai-browser npx navora-claude-plugin
```

## How it works

On first use the plugin:
1. Checks if Chrome is reachable on CDP port `9222` — launches it if not
2. Checks if the Navora daemon is running on `:51520` — spawns it if not
3. Connects to the daemon via WebSocket and authenticates
4. Routes all tool calls through the daemon to the correct browser tab

## Tools

See the [root README](../../README.md#available-tools) for the full tool reference.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `NAVORA_CDP_PORT` | `9222` | Chrome remote debugging port |
| `NAVORA_DAEMON_PORT` | `51520` | Daemon port |
| `NAVORA_AUTH_SECRET` | `dev-secret-change-in-production` | Shared signing secret |
| `NAVORA_DAEMON_BINARY` | auto | Path override for daemon binary |

## License

MIT
