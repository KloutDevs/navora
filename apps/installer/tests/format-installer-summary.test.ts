import { describe, it, expect } from "vitest";
import { formatInstallerSummary } from "../src/format-installer-summary.js";
import type { InstallerEnvState } from "../src/probes.js";

function baseState(over: Partial<InstallerEnvState> = {}): InstallerEnvState {
  return {
    platform: "linux",
    nodeVersion: "v20.0.0",
    browsers: [],
    daemonReachable: false,
    daemonPort: 51520,
    cdpPort: undefined,
    claudeMcpInstalled: false,
    claudeMcpKey: null,
    cursorMcpInstalled: false,
    cursorMcpKey: null,
    installerMode: "npm",
    currentBuildVersion: "0.2.0",
    daemonServiceInstalled: false,
    daemonServiceRunning: false,
    ...over,
  };
}

describe("formatInstallerSummary", () => {
  it("incluye líneas básicas y plugins", () => {
    const text = formatInstallerSummary(baseState());
    expect(text).toContain("Entorno: linux | Node v20.0.0");
    expect(text).toContain("v0.2.0");
    expect(text).toContain("ninguno encontrado");
    expect(text).toContain("CDP: sin respuesta");
    expect(text).toContain("Claude Code MCP: ✗ no instalado");
    expect(text).toContain("Cursor MCP:      ✗ no configurado");
  });

  it("formatea un solo browser", () => {
    const text = formatInstallerSummary(
      baseState({
        browsers: [{ label: "Brave", path: "/usr/bin/brave-browser" }],
      })
    );
    expect(text).toContain("Browsers: Brave — /usr/bin/brave-browser");
  });

  it("lista varios browsers con indentación", () => {
    const text = formatInstallerSummary(
      baseState({
        browsers: [
          { label: "Chrome", path: "/a/chrome" },
          { label: "Brave", path: "/b/brave" },
        ],
      })
    );
    expect(text).toContain("Browsers:\n");
    expect(text).toContain("  Chrome — /a/chrome");
    expect(text).toContain("  Brave — /b/brave");
  });

  it("muestra CDP y daemon cuando aplican", () => {
    const text = formatInstallerSummary(
      baseState({
        cdpPort: 9222,
        daemonReachable: true,
        claudeMcpInstalled: true,
        claudeMcpKey: "navora",
        cursorMcpInstalled: true,
        cursorMcpKey: "navora",
      })
    );
    expect(text).toContain("CDP: respuesta en el puerto 9222");
    expect(text).toContain("Daemon: accesible en :51520");
    expect(text).toContain("Claude Code MCP: ✓ instalado [navora]");
    expect(text).toContain("Cursor MCP:      ✓ configurado [navora]");
  });

  it("muestra la clave legado cuando está instalado con navora-browser", () => {
    const text = formatInstallerSummary(
      baseState({
        claudeMcpInstalled: true,
        claudeMcpKey: "navora-browser",
        cursorMcpInstalled: true,
        cursorMcpKey: "navora-browser",
      })
    );
    expect(text).toContain("Claude Code MCP: ✓ instalado [navora-browser]");
    expect(text).toContain("Cursor MCP:      ✓ configurado [navora-browser]");
  });

  it("muestra modo local cuando installerMode es local", () => {
    const text = formatInstallerSummary(baseState({ installerMode: "local" }));
    expect(text).toContain("Modo: build local");
  });
});
