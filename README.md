# Navora

Navora is an open source browser automation runtime for AI agents. It provides a robust bridge between tool-calling clients and Chrome through a daemon plus extension architecture.

## Why Navora

- Agent-first runtime with MCP-compatible tooling.
- Multi-profile support via a native messaging shim per Chrome profile.
- Structured execution pipeline with validation, permissions, rate limits, persistence, and redaction.
- Monorepo architecture ready for extension and production hardening.

## Architecture at a glance

```text
AI Client (MCP)
  │ stdio (JSON-RPC 2.0)
  ▼
apps/daemon ←→ WebSocket :51432 ←→ apps/daemon/src/nm-shim (one process per Chrome profile)
  │ stdio (Native Messaging framing)
  ▼
apps/extension (Chrome MV3)
  │ CDP WebSocket :9222
  ▼
Chrome browser
```

## Repository layout

- `apps/daemon` - Long-running process that handles transport, routing, persistence, and policy pipeline.
- `apps/extension` - Chrome MV3 extension built with WXT.
- `apps/claude-plugin` - MCP plugin that can talk directly to Chrome via CDP.
- `packages/browser-tools` - Browser adapter interfaces and CDP implementation.
- `packages/mcp` - MCP server builder and stdio transport.
- `packages/protocol` - Shared wire types and protocol contracts.
- `packages/shared` - Result type, logging utilities, IDs, and redaction helpers.

## Getting started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Chrome with remote debugging available

### Install

```bash
pnpm install
```

### Development commands

```bash
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

## Environment variables

- `AI_BROWSER_RUNTIME_TOKEN` - Required token for shim-to-daemon WebSocket auth.
- `AI_BROWSER_RUNTIME_HOST` - Daemon host (default: `127.0.0.1`).
- `AI_BROWSER_RUNTIME_PORT` - Daemon port (default: `51432`).
- Chrome CDP port default: `9222`.

## Contributing

Please read `CONTRIBUTING.md` before opening a pull request.

## Security

If you find a vulnerability, follow `SECURITY.md` for responsible disclosure.

## License

MIT - see `LICENSE`.
