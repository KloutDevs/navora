import { spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isCursorNavoraConfigured } from './cursor-config.js';

const DEFAULT_DAEMON_PORT = Number(process.env['NAVORA_DAEMON_PORT'] ?? 51520);
const DEFAULT_DAEMON_HOST = process.env['NAVORA_DAEMON_HOST'] ?? '127.0.0.1';

/** Nombre del servidor MCP en Claude Code (`claude mcp add <nombre> …`). */
export const CLAUDE_MCP_SERVER_NAME = 'navora';

/** Claves legado conocidas (para limpiar antes de reinstalar). */
export const CLAUDE_LEGACY_KEYS = ['navora-browser'] as const;

// ─── Detección de modo local vs npm ──────────────────────────────────────────

export interface LocalPluginPaths {
  claudePlugin: string;
  cursorPlugin: string;
  daemon: string;
}

/**
 * Resuelve las rutas de los plugins locales si el installer se ejecuta
 * desde el monorepo (build local). Devuelve `null` si se ejecuta vía npx.
 */
export function resolveLocalPluginPaths(): LocalPluginPaths | null {
  try {
    const installerDir = dirname(fileURLToPath(import.meta.url));
    const claudePlugin = resolve(installerDir, '../../claude-plugin/dist/index.js');
    const cursorPlugin = resolve(installerDir, '../../cursor-plugin/dist/index.js');
    const daemon = resolve(installerDir, '../../daemon/dist/main.js');
    if (existsSync(claudePlugin) && existsSync(cursorPlugin)) {
      return { claudePlugin, cursorPlugin, daemon };
    }
    return null;
  } catch {
    return null;
  }
}

/** `'local'` si hay un build local del monorepo; `'npm'` si se ejecuta vía npx. */
export function detectInstallerMode(): 'local' | 'npm' {
  return resolveLocalPluginPaths() !== null ? 'local' : 'npm';
}

/** Puertos CDP comprobados solo con HTTP (sin abrir ni controlar el navegador). */
export const CDP_CHECK_PORTS = [9222, 9223, 9224] as const;

/** Rutas conocidas (mismo criterio que el launcher del plugin). */
const BROWSER_PATHS: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    (process.env['LOCALAPPDATA'] ?? '') + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env['LOCALAPPDATA'] ?? '') + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
  ],
  darwin: [
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/brave-browser',
    '/usr/bin/brave',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
};

export interface DetectedBrowser {
  label: string;
  path: string;
}

export function browserLabelForPath(p: string): string {
  const lower = p.toLowerCase();
  if (lower.includes('brave')) return 'Brave';
  if (lower.includes('chromium')) return 'Chromium';
  return 'Chrome';
}

/** Primer navegador Chromium instalado por orden de preferencia de rutas. */
export function findInstalledBrowsers(opts?: {
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
}): DetectedBrowser[] {
  const os = opts?.platform ?? platform();
  const existsFn = opts?.exists ?? existsSync;
  const candidates = BROWSER_PATHS[os] ?? [];
  const found: DetectedBrowser[] = [];
  const seen = new Set<string>();
  for (const p of candidates) {
    if (!p || !existsFn(p) || seen.has(p)) continue;
    seen.add(p);
    found.push({ label: browserLabelForPath(p), path: p });
  }
  return found;
}

// ─── Version detection ────────────────────────────────────────────────────────

/** Lee la versión del package.json de un paquete local. */
function readLocalVersion(pkgRelPath: string): string | null {
  try {
    const installerDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(installerDir, pkgRelPath);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/** Versión del plugin/daemon en el build local actual. */
export function getCurrentBuildVersion(): string | null {
  return (
    readLocalVersion('../../claude-plugin/package.json') ??
    readLocalVersion('../../daemon/package.json')
  );
}

/**
 * Versión instalada en Claude Code.
 * Parsea `claude mcp list` buscando la línea del servidor navora con versión.
 */
export async function getInstalledClaudeVersion(): Promise<string | null> {
  const { stdout } = await runCapture('claude', ['mcp', 'list', '--json']).catch(() => ({ code: 1, stdout: '' }));
  if (!stdout) return null;
  try {
    const list = JSON.parse(stdout) as Array<{ name: string; version?: string }>;
    const entry = list.find((e) => /navora/i.test(e.name));
    return entry?.version ?? null;
  } catch {
    // claude mcp list --json may not be supported — fallback: no version info
    return null;
  }
}

export interface ClaudeMcpInfo {
  installed: boolean;
  /** Clave bajo la que está registrado, p.ej. `'navora'` o `'navora-browser'`. */
  key: string | null;
}

export interface InstallerEnvState {
  platform: string;
  nodeVersion: string;
  browsers: DetectedBrowser[];
  daemonReachable: boolean;
  daemonPort: number;
  /** Puerto CDP que responde, o `undefined` si ninguno de los puertos probados responde. */
  cdpPort: number | undefined;
  claudeMcpInstalled: boolean;
  claudeMcpKey: string | null;
  cursorMcpInstalled: boolean;
  cursorMcpKey: string | null;
  /** `'local'` si el installer detecta un build local del monorepo; `'npm'` si corre vía npx. */
  installerMode: 'local' | 'npm';
  /** Versión del build actual (package.json). */
  currentBuildVersion: string | null;
  /** ¿El daemon está registrado como servicio del sistema? */
  daemonServiceInstalled: boolean;
  /** ¿El daemon servicio está corriendo? */
  daemonServiceRunning: boolean;
}

export function runCapture(command: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: process.platform === 'win32',
      env: process.env,
    });
    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string | Buffer) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }));
    child.on('error', () => resolve({ code: 1, stdout }));
  });
}

/**
 * Detecta si `claude mcp list` menciona el servidor Navora y bajo qué clave.
 * Reconoce la clave canónica (`navora`) y claves legado (`navora-browser`).
 */
export async function checkClaudeNavoraInstalled(): Promise<ClaudeMcpInfo> {
  const { code, stdout } = await runCapture('claude', ['mcp', 'list']);
  if (code !== 0) return { installed: false, key: null };
  for (const key of [CLAUDE_MCP_SERVER_NAME, ...CLAUDE_LEGACY_KEYS]) {
    if (new RegExp(`\\b${key}\\b`, 'i').test(stdout)) {
      return { installed: true, key };
    }
  }
  return { installed: false, key: null };
}

/** Detección silenciosa completa (OS, Node, navegadores, daemon, CDP, MCP). */
export async function gatherEnvironmentState(): Promise<InstallerEnvState> {
  const { getServiceStatus } = await import('./daemon-service.js');
  const browsers = findInstalledBrowsers();
  const [daemonReachable, cdpPort, claudeInfo] = await Promise.all([
    isDaemonReachable(),
    findCdpPortReachable(),
    checkClaudeNavoraInstalled(),
  ]);
  const cursorInfo = isCursorNavoraConfigured();
  const svc = getServiceStatus();

  return {
    platform: platform(),
    nodeVersion: process.version,
    browsers,
    daemonReachable,
    daemonPort: DEFAULT_DAEMON_PORT,
    cdpPort,
    claudeMcpInstalled: claudeInfo.installed,
    claudeMcpKey: claudeInfo.key,
    cursorMcpInstalled: cursorInfo.configured,
    cursorMcpKey: cursorInfo.key,
    installerMode: detectInstallerMode(),
    currentBuildVersion: getCurrentBuildVersion(),
    daemonServiceInstalled: svc.installed,
    daemonServiceRunning: svc.running,
  };
}

export function getDaemonPort(): number {
  return DEFAULT_DAEMON_PORT;
}

export function isDaemonReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: DEFAULT_DAEMON_HOST, port: DEFAULT_DAEMON_PORT });
    sock.setTimeout(2000);
    sock.on('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => {
      sock.destroy();
      resolve(false);
    });
  });
}

export async function findCdpPortReachable(): Promise<number | undefined> {
  for (const port of CDP_CHECK_PORTS) {
    if (await httpOk(`http://127.0.0.1:${port}/json/version`)) return port;
  }
  return undefined;
}

function httpOk(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    import('node:http')
      .then(({ get }) => {
        const req = get(url, (res) => {
          resolve(res.statusCode === 200);
          res.resume();
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => {
          req.destroy();
          resolve(false);
        });
      })
      .catch(() => resolve(false));
  });
}

/**
 * Elimina el lockfile del daemon si el proceso que referencia ya no existe.
 * Evita que un lockfile desactualizado impida que el daemon arranque.
 */
export async function clearStaleDaemonLockfile(): Promise<void> {
  const lockPath = join(tmpdir(), 'ai-browser-runtime', 'daemon.pid');
  try {
    const { readFile, unlink } = await import('node:fs/promises');
    const content = await readFile(lockPath, 'utf8');
    const { pid } = JSON.parse(content) as { pid: number };
    const alive = await isPidAlive(pid);
    if (!alive) await unlink(lockPath);
  } catch {
    // No lockfile o ya fue eliminado — correcto
  }
}

function isPidAlive(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      process.kill(pid, 0);
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Arranca el daemon en background.
 * - Modo local: `node apps/daemon/dist/main.js`
 * - Modo npm:   `npx -y navora-daemon`
 * Stderr se redirige a un archivo de log para diagnóstico.
 */
export const DAEMON_LOG_PATH = join(tmpdir(), 'ai-browser-runtime', 'daemon.log');

export function startDaemon(): void {
  const local = resolveLocalPluginPaths();

  // Abre el log file en modo append para capturar stderr del daemon
  let errFd: number;
  try {
    errFd = openSync(DAEMON_LOG_PATH, 'a');
  } catch {
    errFd = openSync('/dev/null', 'w');
  }

  const stdio: ['ignore', 'ignore', number] = ['ignore', 'ignore', errFd];

  const child = local
    ? spawn(process.execPath, [local.daemon], {
        detached: true,
        stdio,
        env: process.env,
        windowsHide: true,
      })
    : spawn(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['-y', 'navora-daemon'],
        {
          detached: true,
          stdio,
          shell: process.platform === 'win32',
          env: process.env,
          windowsHide: true,
        }
      );

  child.unref();
}

/** @deprecated Usar `startDaemon()` */
export function startDaemonViaNpx(): void {
  startDaemon();
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
