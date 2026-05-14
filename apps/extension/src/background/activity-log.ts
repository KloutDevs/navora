/**
 * Activity log: circular buffer + chrome.storage.local persistence for the sidepanel.
 */

export type ActivityEntryType = "connect" | "disconnect" | "tool_call" | "error";

export type ActivityEntryStatus = "ok" | "error";

export interface ActivityEntry {
  id: string;
  timestamp: number;
  type: ActivityEntryType;
  client?: string;
  tool?: string;
  profile?: string;
  summary: string;
  status: ActivityEntryStatus;
  durationMs?: number;
}

export const ACTIVITY_LOG_STORAGE_KEY = "navora_activity_log" as const;
export const LAST_PROFILE_STORAGE_KEY = "navora_last_profile" as const;

const MAX_BUFFER = 500;
const PERSIST_COUNT = 200;
const PERSIST_DEBOUNCE_MS = 160;

const buffer: ActivityEntry[] = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let initPromise: Promise<void> | null = null;

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `act_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function trimBuffer(): void {
  while (buffer.length > MAX_BUFFER) {
    buffer.shift();
  }
}

function lastProfileFromBuffer(): string | undefined {
  for (let i = buffer.length - 1; i >= 0; i--) {
    const p = buffer[i]?.profile;
    if (typeof p === "string" && p.trim()) return p.trim();
  }
  return undefined;
}

async function flushPersist(): Promise<void> {
  if (!hasChromeStorage()) return;
  const slice = buffer.slice(-PERSIST_COUNT);
  const payload: Record<string, unknown> = {
    [ACTIVITY_LOG_STORAGE_KEY]: slice,
  };
  const lp = lastProfileFromBuffer();
  if (lp) {
    payload[LAST_PROFILE_STORAGE_KEY] = lp;
  }
  await chrome.storage.local.set(payload);
}

function schedulePersist(): void {
  if (!hasChromeStorage()) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersist();
  }, PERSIST_DEBOUNCE_MS);
}

export function initActivityLog(): Promise<void> {
  if (!hasChromeStorage()) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve) => {
    chrome.storage.local.get(ACTIVITY_LOG_STORAGE_KEY, (r) => {
      const raw = r[ACTIVITY_LOG_STORAGE_KEY];
      buffer.length = 0;
      if (Array.isArray(raw)) {
        for (const row of raw) {
          if (row && typeof row === "object" && "id" in row && "timestamp" in row) {
            buffer.push(row as ActivityEntry);
          }
        }
      }
      trimBuffer();
      resolve();
    });
  });
  return initPromise;
}

export type ActivityEntryInput = Pick<ActivityEntry, "type" | "summary" | "status"> & {
  client?: string | undefined;
  tool?: string | undefined;
  profile?: string | undefined;
  durationMs?: number | undefined;
};

export function addEntry(partial: ActivityEntryInput): ActivityEntry {
  const entry: ActivityEntry = {
    id: newId(),
    timestamp: Date.now(),
    type: partial.type,
    summary: partial.summary,
    status: partial.status,
  };
  if (partial.client !== undefined) entry.client = partial.client;
  if (partial.tool !== undefined) entry.tool = partial.tool;
  if (partial.profile !== undefined) entry.profile = partial.profile;
  if (partial.durationMs !== undefined) entry.durationMs = partial.durationMs;
  buffer.push(entry);
  trimBuffer();
  schedulePersist();
  return entry;
}

export type ActivityLogFilter = {
  /** If set, only entries whose `type` is in this list */
  types?: ActivityEntryType[];
};

/**
 * Returns entries newest-first (for stacked UI).
 */
export function getEntries(filter?: ActivityLogFilter): ActivityEntry[] {
  const rev = [...buffer].reverse();
  if (!filter?.types?.length) return rev;
  const allow = new Set(filter.types);
  return rev.filter((e) => allow.has(e.type));
}

export function clearLog(): void {
  buffer.length = 0;
  if (hasChromeStorage()) {
    void chrome.storage.local.remove(ACTIVITY_LOG_STORAGE_KEY);
  }
}

/** NM / EXECUTE_TOOL helpers */

export function extractProfile(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  const pid = params["profileId"] ?? params["profile"];
  if (typeof pid === "string" && pid.trim()) return pid.trim();
  return undefined;
}

export function extractClientHint(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  const raw =
    params["mcpClient"] ??
    params["mcp_client"] ??
    params["client"] ??
    (typeof params["source"] === "string" ? params["source"] : undefined);
  if (typeof raw !== "string" || !raw.trim()) {
    const meta = params["_meta"];
    if (meta && typeof meta === "object" && meta !== null) {
      const c = (meta as Record<string, unknown>)["client"];
      if (typeof c === "string" && c.trim()) return formatClientLabel(c.trim());
    }
    return undefined;
  }
  return formatClientLabel(raw.trim());
}

export function formatClientLabel(raw: string): string {
  const k = raw.toLowerCase().replace(/\s+/g, "-");
  if (k.includes("claude")) return "Claude Code";
  if (k === "cursor" || k.includes("cursor")) return "Cursor";
  if (k.includes("vscode")) return "VS Code";
  return raw;
}

export function summarizeToolParams(method: string, params: Record<string, unknown>): string {
  const tab =
    typeof params["tabId"] === "number"
      ? `tab ${params["tabId"]}`
      : typeof params["tabId"] === "string"
        ? `tab ${params["tabId"]}`
        : undefined;

  const tail = tab ? ` · ${tab}` : "";

  switch (method) {
    case "navigate": {
      const url = typeof params["url"] === "string" ? truncate(params["url"], 72) : "?";
      return `navigate → ${url}${tail}`;
    }
    case "go_back":
      return `go_back${tail}`;
    case "reload":
      return `reload${tail}`;
    case "get_dom":
      return `get_dom${tail}`;
    case "get_text":
      return `get_text${tail}`;
    case "wait_for": {
      const sel = typeof params["selector"] === "string" ? truncate(params["selector"], 48) : "?";
      return `wait_for ${sel}${tail}`;
    }
    case "click": {
      const sel = typeof params["selector"] === "string" ? truncate(params["selector"], 48) : "?";
      return `click ${sel}${tail}`;
    }
    case "type": {
      const text = typeof params["text"] === "string" ? truncate(params["text"], 40) : "";
      const n = typeof params["text"] === "string" ? params["text"].length : 0;
      return `type (${n} chars) ${text ? `"${text}"` : ""}${tail}`.trim();
    }
    case "scroll":
      return `scroll Δy=${params["deltaY"] ?? "?"}${tail}`;
    case "screenshot":
      return `screenshot${tail}`;
    case "execute_script": {
      const src = typeof params["source"] === "string" ? params["source"] : "";
      return `execute_script (${src.length} chars)${tail}`;
    }
    case "get_console":
      return `get_console${tail}`;
    case "tabs/list":
      return "tabs/list";
    case "tabs/active":
      return "tabs/active";
    case "ping":
      return "ping";
    default:
      return `${method}${tail}`;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
