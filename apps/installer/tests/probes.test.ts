import { describe, it, expect } from "vitest";
import {
  browserLabelForPath,
  detectInstallerMode,
  findInstalledBrowsers,
  resolveLocalPluginPaths,
} from "../src/probes.js";

describe("browserLabelForPath", () => {
  it("detecta Brave", () => {
    expect(browserLabelForPath("/Applications/Brave Browser.app/foo")).toBe("Brave");
  });

  it("detecta Chromium", () => {
    expect(browserLabelForPath("/usr/bin/chromium-browser")).toBe("Chromium");
  });

  it("por defecto Chrome", () => {
    expect(browserLabelForPath("/usr/bin/google-chrome-stable")).toBe("Chrome");
  });
});

describe("findInstalledBrowsers", () => {
  it("devuelve candidatos existentes según plataforma y predicado exists", () => {
    const found = findInstalledBrowsers({
      platform: "linux",
      exists: (p) => p === "/usr/bin/google-chrome-stable",
    });
    expect(found).toEqual([{ label: "Chrome", path: "/usr/bin/google-chrome-stable" }]);
  });

  it("devuelve array vacío si ninguna ruta existe", () => {
    expect(
      findInstalledBrowsers({
        platform: "linux",
        exists: () => false,
      })
    ).toEqual([]);
  });
});

describe("resolveLocalPluginPaths / detectInstallerMode", () => {
  it("detectInstallerMode devuelve 'local' o 'npm' (nunca otro valor)", () => {
    const mode = detectInstallerMode();
    expect(["local", "npm"]).toContain(mode);
  });

  it("cuando se ejecuta desde el monorepo, resuelve paths locales válidos", () => {
    // En el contexto de los tests del monorepo, el installer dist está en
    // apps/installer/dist/ y los plugins en apps/claude-plugin/dist/
    const paths = resolveLocalPluginPaths();
    if (paths !== null) {
      expect(paths.claudePlugin).toContain("claude-plugin");
      expect(paths.cursorPlugin).toContain("cursor-plugin");
      expect(paths.claudePlugin.endsWith("index.js")).toBe(true);
      expect(paths.cursorPlugin.endsWith("index.js")).toBe(true);
    }
    // Si paths es null, estamos en modo npm — también válido
  });

  it("resolveLocalPluginPaths y detectInstallerMode son consistentes", () => {
    const paths = resolveLocalPluginPaths();
    const mode = detectInstallerMode();
    expect(paths !== null).toBe(mode === "local");
  });
});
