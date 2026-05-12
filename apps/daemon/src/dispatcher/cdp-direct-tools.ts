/**
 * CDP tools that bypass BrowserAdapter — raw DevToolsProtocol to a page target.
 */

import http from "node:http";
import { DevToolsProtocol } from "@navora/browser-tools";
import { isOk } from "@navora/shared";

interface ChromeTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

function fetchTargets(port: number): Promise<ChromeTarget[]> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body) as ChromeTarget[]);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error("CDP HTTP timeout"));
    });
  });
}

async function withPageProtocol<T>(port: number, fn: (cdp: DevToolsProtocol) => Promise<T>): Promise<T> {
  const targets = await fetchTargets(port);
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`No CDP page target on port ${port}`);
  }

  const cdp = new DevToolsProtocol({ url: page.webSocketDebuggerUrl });
  const conn = await cdp.connect();
  if (!isOk(conn)) {
    throw conn.error;
  }

  try {
    return await fn(cdp);
  } finally {
    await cdp.dispose();
  }
}

export async function cdpEvaluate(expression: string, port: number): Promise<unknown> {
  return withPageProtocol(port, async (cdp) => {
    const r = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (!isOk(r)) throw r.error;
    return r.value;
  });
}

export async function cdpSendCommand(
  method: string,
  params: Record<string, unknown> | undefined,
  port: number
): Promise<unknown> {
  return withPageProtocol(port, async (cdp) => {
    const r = await cdp.send(method, params);
    if (!isOk(r)) throw r.error;
    return r.value;
  });
}

/** Minimal network introspection — enables domains and returns a placeholder payload. */
export async function cdpNetworkHar(port: number): Promise<unknown> {
  return withPageProtocol(port, async (cdp) => {
    await cdp.send("Network.enable", {});
    await cdp.send("Page.enable", {});
    const r = await cdp.send("Network.getCookies", {});
    return {
      note: "HAR-style capture is not fully implemented; Network domain enabled and cookies sampled.",
      cookiesResult: isOk(r) ? r.value : null,
    };
  });
}
