import { describe, it, expect, vi, beforeEach } from "vitest";

const ensureChromeWithCdp = vi.hoisted(() => vi.fn());
const resolveReachableCdpPort = vi.hoisted(() => vi.fn().mockResolvedValue(9222));
const getResolvedCdpPort = vi.hoisted(() => vi.fn(() => 9222));
const isChromeReachable = vi.hoisted(() => vi.fn());

const navigate = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const takeScreenshot = vi.hoisted(() => vi.fn().mockResolvedValue({ data: "dGVzdA==" }));
const extractDom = vi.hoisted(() => vi.fn().mockResolvedValue({ html: "<p/>" }));
const extractText = vi.hoisted(() => vi.fn().mockResolvedValue("hi"));
const clickElement = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const typeText = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const scroll = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const waitForSelector = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const executeScript = vi.hoisted(() => vi.fn().mockResolvedValue({ result: 1 }));
const getConsoleLogs = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const getTabs = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const goBack = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const reload = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
const cdpEvaluate = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const cdpSendCommand = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const cdpNetworkHar = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock("../src/chrome-launcher.js", () => ({
  ensureChromeWithCdp,
  resolveReachableCdpPort,
  getCdpProbePorts: () => [9222, 9223, 9224],
  getResolvedCdpPort,
  isChromeReachable,
}));

vi.mock("../src/browser.js", () => ({
  navigate,
  takeScreenshot,
  extractDom,
  extractText,
  clickElement,
  typeText,
  scroll,
  waitForSelector,
  executeScript,
  getConsoleLogs,
  getTabs,
  goBack,
  reload,
  cdpEvaluate,
  cdpSendCommand,
  cdpNetworkHar,
}));

import { ensureChrome } from "../src/chrome-bootstrap.js";
import {
  baseToolNames,
  callTool,
  resolveActiveTools,
  cdpToolNames,
} from "../src/tool-dispatcher.js";

describe("ensureChrome", () => {
  beforeEach(() => {
    resolveReachableCdpPort.mockReset();
    resolveReachableCdpPort.mockResolvedValue(9222);
  });

  it("no escribe advertencia si CDP está disponible", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await ensureChrome();
    expect(resolveReachableCdpPort).toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("continúa con advertencia si no hay CDP", async () => {
    resolveReachableCdpPort.mockResolvedValue(undefined);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await ensureChrome();
    expect(err.mock.calls.length).toBeGreaterThan(0);
    err.mockRestore();
  });
});

describe("tool registry", () => {
  it("expone 13 herramientas base y 3 CDP", () => {
    expect(baseToolNames()).toHaveLength(13);
    expect(baseToolNames()).toContain("browser_navigate");
    expect(cdpToolNames()).toEqual(["cdp_evaluate", "cdp_send_command", "cdp_network_har"]);
  });
});

describe("resolveActiveTools", () => {
  beforeEach(() => {
    delete process.env.NAVORA_CDP_PORT;
    isChromeReachable.mockReset();
    isChromeReachable.mockResolvedValue(true);
  });

  it("sin NAVORA_CDP_PORT solo devuelve herramientas base", async () => {
    expect((await resolveActiveTools()).length).toBe(13);
    expect(isChromeReachable).not.toHaveBeenCalled();
  });

  it("con NAVORA_CDP_PORT y Chrome alcanzable añade herramientas CDP", async () => {
    process.env.NAVORA_CDP_PORT = "9222";
    const tools = await resolveActiveTools();
    expect(tools.length).toBe(16);
    delete process.env.NAVORA_CDP_PORT;
  });
});

describe("callTool", () => {
  beforeEach(() => {
    navigate.mockClear();
  });

  it("delega browser_navigate", async () => {
    await callTool("browser_navigate", { url: "https://example.com" });
    expect(navigate).toHaveBeenCalledWith("https://example.com", undefined);
  });

  it("rechaza herramienta desconocida", async () => {
    await expect(callTool("no_existe", {})).rejects.toThrow("Unknown tool");
  });
});
