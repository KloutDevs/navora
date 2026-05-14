/**
 * NM routing: daemon → extension requests on native port, responses back.
 */

import type { NMEnvelope } from "@navora/protocol";
import {
  addEntry,
  extractClientHint,
  extractProfile,
  summarizeToolParams,
} from "./activity-log";
import { nmHandlers } from "./nm-handlers";

const SKIP_TOOL_LOG = new Set<string>(["ping", "mcp/session"]);

export async function dispatchDaemonNmMessage(port: chrome.runtime.Port, env: NMEnvelope): Promise<void> {
  if (env.kind !== "request") {
    return;
  }

  const method = env.method;
  const handler = nmHandlers[method];
  const params = (env.params ?? {}) as Record<string, unknown>;
  const profile = extractProfile(params);
  const client = extractClientHint(params) ?? "MCP (daemon)";
  const t0 = Date.now();

  try {
    if (!handler) {
      await postEnvelope(port, {
        kind: "response",
        request_id: env.request_id,
        success: false,
        error: { code: "UNKNOWN_METHOD", message: `No handler for ${method}` },
      });
      addEntry({
        type: "error",
        client,
        profile,
        summary: `Método NM desconocido: ${method}`,
        status: "error",
        durationMs: Date.now() - t0,
      });
      return;
    }

    const result = await handler(params);
    await postEnvelope(port, {
      kind: "response",
      request_id: env.request_id,
      success: true,
      result,
    });

    if (!SKIP_TOOL_LOG.has(method)) {
      addEntry({
        type: "tool_call",
        tool: method,
        client,
        profile,
        summary: summarizeToolParams(method, params),
        status: "ok",
        durationMs: Date.now() - t0,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await postEnvelope(port, {
      kind: "response",
      request_id: env.request_id,
      success: false,
      error: { code: "EXEC_ERROR", message: msg },
    });
    if (!SKIP_TOOL_LOG.has(method)) {
      addEntry({
        type: "tool_call",
        tool: method,
        client,
        profile,
        summary: `${summarizeToolParams(method, params)} → ${truncateOneLine(msg, 120)}`,
        status: "error",
        durationMs: Date.now() - t0,
      });
    } else {
      addEntry({
        type: "error",
        tool: method,
        client,
        profile,
        summary: truncateOneLine(msg, 160),
        status: "error",
        durationMs: Date.now() - t0,
      });
    }
  }
}

function truncateOneLine(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

function postEnvelope(port: chrome.runtime.Port, envelope: NMEnvelope): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      port.postMessage(envelope);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}
