import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import {
  CURSOR_MCP_SERVER_KEY,
  isCursorNavoraConfigured,
  removeCursorMcpServers,
  upsertCursorMcpServer,
} from "../src/cursor-config.js";

describe("cursor-config", () => {
  let fakeHome = "";

  afterEach(() => {
    delete process.env.NAVORA_TEST_CURSOR_HOME;
    if (fakeHome) {
      try {
        rmSync(fakeHome, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      fakeHome = "";
    }
  });

  function useFakeHome(): string {
    fakeHome = join(tmpdir(), `navora-cursor-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    process.env.NAVORA_TEST_CURSOR_HOME = fakeHome;
    mkdirSync(join(fakeHome, ".cursor"), { recursive: true });
    return fakeHome;
  }

  it("upsertCursorMcpServer escribe mcp.json", () => {
    const home = useFakeHome();
    const path = upsertCursorMcpServer(CURSOR_MCP_SERVER_KEY, {
      command: "npx",
      args: ["-y", "navora-cursor-plugin"],
    });
    expect(path).toBe(join(home, ".cursor", "mcp.json"));
    const doc = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(doc.mcpServers[CURSOR_MCP_SERVER_KEY]?.args).toContain("navora-cursor-plugin");
  });

  it("isCursorNavoraConfigured es true con clave navora", () => {
    useFakeHome();
    writeFileSync(
      join(fakeHome, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          navora: { command: "npx", args: ["-y", "navora-cursor-plugin"] },
        },
      }),
      "utf8"
    );
    const info = isCursorNavoraConfigured();
    expect(info.configured).toBe(true);
    expect(info.key).toBe("navora");
  });

  it("isCursorNavoraConfigured detecta clave legado navora-browser", () => {
    useFakeHome();
    writeFileSync(
      join(fakeHome, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "navora-browser": { command: "node", args: ["/path/to/dist/index.js"] },
        },
      }),
      "utf8"
    );
    const info = isCursorNavoraConfigured();
    expect(info.configured).toBe(true);
    expect(info.key).toBe("navora-browser");
  });

  it("isCursorNavoraConfigured es false cuando no hay entradas navora", () => {
    useFakeHome();
    writeFileSync(
      join(fakeHome, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "node", args: [] } } }),
      "utf8"
    );
    const info = isCursorNavoraConfigured();
    expect(info.configured).toBe(false);
    expect(info.key).toBeNull();
  });

  it("removeCursorMcpServers elimina claves", () => {
    useFakeHome();
    upsertCursorMcpServer("other", { command: "node", args: ["x.js"] });
    upsertCursorMcpServer(CURSOR_MCP_SERVER_KEY, { command: "npx", args: ["-y", "navora-cursor-plugin"] });

    const changed = removeCursorMcpServers([CURSOR_MCP_SERVER_KEY]);
    expect(changed).toBe(true);
    const doc = JSON.parse(readFileSync(join(fakeHome, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(doc.mcpServers["other"]).toBeDefined();
    expect(doc.mcpServers[CURSOR_MCP_SERVER_KEY]).toBeUndefined();
  });
});
