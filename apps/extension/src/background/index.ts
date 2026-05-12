/**
 * NM routing: daemon → extension requests on native port, responses back.
 */

import type { NMEnvelope } from "@navora/protocol";
import { nmHandlers } from "./nm-handlers";

export async function dispatchDaemonNmMessage(port: chrome.runtime.Port, env: NMEnvelope): Promise<void> {
  if (env.kind !== "request") {
    return;
  }

  const method = env.method;
  const handler = nmHandlers[method];
  const params = (env.params ?? {}) as Record<string, unknown>;

  try {
    if (!handler) {
      await postEnvelope(port, {
        kind: "response",
        request_id: env.request_id,
        success: false,
        error: { code: "UNKNOWN_METHOD", message: `No handler for ${method}` },
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await postEnvelope(port, {
      kind: "response",
      request_id: env.request_id,
      success: false,
      error: { code: "EXEC_ERROR", message: msg },
    });
  }
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
