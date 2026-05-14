# Navora Roadmap

Navora is a browser automation **runtime** for AI agents — not a thin proxy.
The distinction matters: a runtime has state, identity, memory, and policy.
A proxy has none of those. This roadmap is built around that moat.

## Where we are today (v0.2)

- 13 core browser tools + 3 raw CDP tools
- Daemon WebSocket hub with per-tab CDP connection pool
- Multi-tab routing via sequential tab IDs
- Chrome extension (Navora, v0.2.0) with Native Messaging bridge and real-time activity log sidepanel
- SQLite persistence, permission gate, rate limiter — wired in dispatcher, not activated
- Interactive installer TUI: guided NM host setup, daemon service management, pre-generated 30-day auth tokens
- Published on npm: `navora-claude-plugin`, `navora-cursor-plugin`, `navora-daemon`

The foundation is solid. The tool surface is thin. That changes in v0.3.

---

## v0.2.x — Foundation complete ✓

**Testing & quality**
- Coverage configured (`@vitest/coverage-v8`): anti-regression thresholds at 63/63/72/70, watermarks at 80% target
- Fixed `vitest.workspace.ts` path bug that silently broke coverage collection
- Added test suites for `apps/installer`, `apps/claude-plugin`, `apps/daemon` (transport, dispatcher, permissions)
- Fixed 2 failing tests: `ulid` monotonic (flaky timing) and `nm-shim` lockfile (missing env isolation)
- WebSocket token auth: replaced reversed-string signature with `HMAC-SHA256`; added `generateToken()` utility
- Extracted `PERSISTENCE_ONLY_TOOLS` constant — eliminates the triplicated `skipAdapter` list
- CI workflow (GitHub Actions)

**Installer**
- Interactive TUI (`@clack/prompts`) for MCP plugin install, daemon service management, and NM host setup
- Browser detection (Chrome, Brave, Edge, Chromium) on Windows, macOS, Linux
- Pre-generated 30-day HMAC shim token so the shim connects to the daemon without any extra auth step
- Shim wrapper resolves the full `node` binary path (Chrome uses a minimal `PATH`)

**Extension**
- Activity log module: circular buffer (500 entries) persisted in `chrome.storage.local`, survives service worker restarts
- Every tool call, NM connect/disconnect, and error recorded with client name, profile, duration, and human-readable summary
- Sidepanel rework: live activity feed replaces the old static log
- `mcp/session` NM handler: daemon notifies the extension on MCP client connect/disconnect
- Renamed to **Navora** in the manifest, bumped to `0.2.0`

**npm**
- `navora-daemon` published as a flat tsup bundle; plugins auto-discover it via `npx navora-daemon`
- `navora-claude-plugin` and `navora-cursor-plugin` published at `0.2.0`
- All packages renamed from `@ai-browser-runtime/*` → `@navora/*`

---

## v0.3 — Parity (close the tool gap)

**Goal**: match or exceed chrome-devtools-mcp's tool count.  
**Target**: Q3 2026.

### Input

| Tool | Notes |
|------|-------|
| `browser_hover` | Move cursor over element — triggers `:hover`, tooltips |
| `browser_drag` | Drag element A onto element B |
| `browser_fill_form` | Fill multiple fields in one call — reduces round-trips |
| `browser_upload_file` | Set `<input type="file">` via CDP `DOM.setFileInputFiles` |
| `browser_handle_dialog` | Accept/dismiss/type into `alert`, `confirm`, `prompt` |
| `browser_press_key` | Send keyboard shortcuts via `Input.dispatchKeyEvent` |

### Network

| Tool | Notes |
|------|-------|
| `browser_get_network_requests` | Return HAR-compatible list of captured requests |
| `browser_get_network_request` | Single request by ID with headers + body |

Network capture is activated per-tab via `Network.enable` — no overhead on tabs that don't need it.

### Inspection

| Tool | Notes |
|------|-------|
| `browser_get_accessibility_tree` | Serialized AX tree via `Accessibility.getFullAXTree` |
| `browser_set_viewport` | Resize viewport (width, height, device scale factor) |
| `browser_emulate_device` | Apply a named device preset (mobile, tablet, etc.) |

### Stability

- Retry logic in `CommandExecutor` for transient CDP disconnects
- Structured error codes in all tool responses (not bare strings)
- `browser_wait_for` extended to support text content matching, not just selectors

---

## v0.4 — Differentiation (weaponize the runtime)

**Goal**: build features chrome-devtools-mcp cannot ship because of their architecture.  
**Target**: Q4 2026.

### Session replay

The SQLite audit log already captures every tool call. v0.4 makes it actionable.

- `browser_record_start` / `browser_record_stop` — mark a recording window
- `browser_replay` — re-execute a saved sequence against the live browser
- `browser_export_session` — export session as a replayable script (JSON or Playwright-compatible)

No other MCP browser runtime can do this. chrome-devtools-mcp has no persistence layer.

### Event streaming

The Chrome extension can push events to the daemon without polling. v0.4 wires this:

- Page navigation events (URL changes, load complete)
- Uncaught errors and console errors (pushed, not pulled)
- DOM mutation observer hooks — notify when a selector appears without `browser_wait_for` polling
- Network response events for watched URLs

Exposed to MCP clients as a `browser_listen` tool that registers a one-shot or persistent listener.

### Performance capture (lightweight)

Not full trace recording — targeted metrics via CDP performance domain:

- `browser_get_metrics` — LCP, CLS, FID, layout count, JS heap from `Performance.getMetrics`
- `browser_mark_timeline` — inject user timing marks, read them back after the action

This covers 80% of what developers actually need from performance tooling.

### Activated permission system

The `ConfirmationGate` and `RateLimiter` in `dispatcher/` are dormant today. v0.4 activates them:

- Per-tool rate limits configurable via env or config file
- `browser_grant` / `browser_revoke` — grant tool permissions for the session without prompting
- Permission log accessible via `browser_get_permissions`

This is a hard differentiator for production agent deployments where the runtime must operate within defined boundaries.

---

## v0.5 — Multi-profile orchestration

**Goal**: make Navora the only browser runtime that supports multi-agent, multi-profile workflows.  
**Target**: Q1 2027.

The `NMMultiplexer` already routes by profile ID. v0.5 builds the surface:

- `browser_list_profiles` — enumerate connected Chrome profiles
- `browser_switch_profile` — target subsequent tool calls at a different profile
- `browser_clone_session` — copy cookies + localStorage from one profile to another
- Parallel tool execution across profiles in a single MCP call

**Use case no one else can handle**: run an AI agent as a logged-in user in profile A while monitoring the same site as an anonymous user in profile B, simultaneously.

---

## v0.6 — Distribution and DX

**Goal**: zero-friction install, signed extension, first-class docs.  
**Target**: Q2 2027.

- Chrome Web Store listing for the extension (no manual sideloading)
- `npx navora-claude-plugin` fully self-contained (no manual daemon management)
- Cursor plugin on the Cursor MCP registry
- `navora doctor` CLI command — diagnoses connection issues, version mismatches, port conflicts
- Structured output for all tools (consistent JSON schema, versioned)
- OpenAPI-compatible tool schema export for client codegen

---

## What chrome-devtools-mcp will never have

| Capability | Why they can't ship it |
|---|---|
| Session replay | No persistence layer |
| Cross-session audit log | Stateless proxy |
| Multi-profile orchestration | Single Chrome connection model |
| Permission policies per tool | No permission layer |
| Agent budget / rate limits | No middleware |
| DOM mutation push events | No extension for push-side events |
| Profile isolation for parallel agents | Single process model |

These are not planned features we could build — they require the daemon + extension + SQLite architecture to exist first. Navora already has that. Shipping them is execution, not architecture.

---

## Non-goals

- **Full Puppeteer parity**: Puppeteer is for test scripts. Navora is for AI agents. Different interaction model.
- **Firefox support**: CDP is Chrome-specific. Supporting Firefox means a second adapter — deferred until v1.x.
- **Cloud/hosted mode**: Navora is local-first by design. Agent ↔ daemon ↔ your browser. No third-party relay.
- **Visual regression testing**: Screenshot diffing belongs in a test framework. `browser_screenshot` is sufficient.
