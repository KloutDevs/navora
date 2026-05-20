# Contributing to Navora

Thanks for contributing to Navora.

## Development setup

Requirements: Node.js 20+ and pnpm.

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Run quality checks:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   ```

## Project structure

```
apps/
  claude-plugin/   MCP plugin that exposes browser tools to Claude Code
  daemon/          Long-running Node.js process; dispatcher pipeline, NM bridge, persistence
  extension/       Chrome MV3 extension built with WXT
  nm-shim/         Thin binary Chrome launches as the Native Messaging host

packages/
  browser-tools/   BrowserAdapter interface + CDP implementation
  mcp/             MCPServerBuilder — JSON-RPC 2.0 over stdio
  protocol/        Shared wire types (NMMessage, WSMessage, ProtocolError, ...)
  shared/          Core utilities (Result<T,E>, Logger, ulid, redact)
  ui/              Shared UI components
```

For data-flow and architecture details see [CLAUDE.md](./CLAUDE.md).

## Branching

- Create a focused branch for each change.
- Use the following prefixes:
  - `feat/` — new feature
  - `fix/` — bug fix
  - `docs/` — documentation only
  - `chore/` — maintenance, deps, tooling

## Commit format

Follow [Conventional Commits](https://www.conventionalcommits.org/). Include a scope when the change targets a specific package or subsystem.

```
feat(browser-tools): add browser_hover tool
fix(daemon): handle connection timeout in NMMultiplexer
docs: document nm-shim environment variables
chore(deps): upgrade vitest to 2.x
```

No AI attribution in commit messages.

## Pull requests

- Keep PRs under 400 lines of changed code when possible. Split larger changes into a chain.
- Include tests and documentation in the same PR as the feature or fix.
- Describe the problem, approach, and verification steps in the PR body.

## Adding a new browser tool

When adding a tool end-to-end, touch these files in order:

1. **Daemon pipeline** — `apps/daemon/src/dispatcher/pipeline.ts`
   - Register the tool name in `getKnownTools()`.
   - Add a `case` in `executeTool()` that calls the adapter method and returns a `Result`.

2. **Adapter interface** — `packages/browser-tools/src/adapter.ts`
   - Add the method signature to the `BrowserAdapter` interface.

3. **Adapter implementations** — implement the method in all three adapters:
   - `packages/browser-tools/src/cdp/direct-adapter.ts` — real CDP path.
   - `packages/browser-tools/src/nm/nm-adapter.ts` — native messaging path.
   - `packages/browser-tools/src/fake-adapter.ts` — test double; return a sensible stub.

4. **Extension handler** — `apps/extension/src/background/nm-handlers.ts`
   - Add a handler that receives the NM message and calls the appropriate Chrome/CDP API.

5. **Claude plugin schema** — `apps/claude-plugin/src/tool-dispatcher.ts`
   - Register the tool's input schema and wire it to the adapter call.

6. **Tests**
   - Integration/unit tests under `apps/daemon/tests/`.
   - Adapter-level tests under `packages/browser-tools/tests/`.

## Coding guidelines

- Follow existing monorepo package boundaries (see dependency rules in CLAUDE.md).
- Use `Result<T, E>` for all async operations — never throw across module boundaries.
- Keep tool pipeline behavior consistent when adding new tools; the pipeline handles permissions, rate-limiting, blob storage, and persistence automatically.

## Before opening a PR

- Confirm all tests pass locally.
- Confirm lint and typecheck pass.
- Describe the problem, approach, and verification steps in the PR.
