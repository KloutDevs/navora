/**
 * Early console hook — must load at document_start before page scripts run ideally.
 * Circular buffer 200 entries; flush via window.__navoraFlushConsole.
 */

type Level = "log" | "warn" | "error" | "info" | "debug";

const MAX = 200;
const buffer: Array<{ level: Level; args: string[]; timestamp: number }> = [];

function safeString(v: unknown): string {
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

const methods = ["log", "warn", "error", "info", "debug"] as const;

for (const level of methods) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    orig(...args);
    buffer.push({
      level,
      timestamp: Date.now(),
      args: args.map(safeString),
    });
    while (buffer.length > MAX) buffer.shift();
  };
}

(window as unknown as { __navoraFlushConsole: () => typeof buffer }).__navoraFlushConsole = () => {
  const out = buffer.splice(0, buffer.length);
  return out;
};
