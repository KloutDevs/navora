/**
 * Native Messaging setup — cross-platform (Windows / Linux / macOS).
 * Handles browser detection, shim wrapper creation and NM host registration.
 */

import {
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// ─── Constants ────────────────────────────────────────────────────────────────

export const NM_HOST_NAME = 'com.ai-browser-runtime.nm';
export const NM_HOST_DESCRIPTION = 'Navora AI Browser Runtime Native Messaging Host';

// ─── Browser profiles ─────────────────────────────────────────────────────────

export interface NmBrowserProfile {
  id: 'chrome' | 'brave' | 'edge' | 'chromium';
  label: string;
  installed: boolean;
  /** Windows registry subkey under HKCU\Software */
  registrySubkey?: string;
  /** Linux/macOS NM config directory (absolute, may use ~) */
  nmConfigDir?: string;
  /** URL to open the extensions page */
  extensionsUrl: string;
}

function resolveHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

function isInstalledWin(paths: string[]): boolean {
  return paths.some((p) => existsSync(p));
}

function isInstalledUnix(cmds: string[]): boolean {
  for (const cmd of cmds) {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch { /* continue */ }
  }
  return false;
}

function isInstalledMac(appPaths: string[]): boolean {
  return appPaths.some((p) => existsSync(p));
}

export function detectNmBrowsers(): NmBrowserProfile[] {
  const os = platform();

  if (os === 'win32') {
    const local = process.env['LOCALAPPDATA'] ?? '';
    const pf = process.env['PROGRAMFILES'] ?? 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';

    return [
      {
        id: 'chrome',
        label: 'Google Chrome',
        installed: isInstalledWin([
          join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
          join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
          join(local, 'Google\\Chrome\\Application\\chrome.exe'),
        ]),
        registrySubkey: 'Google\\Chrome\\NativeMessagingHosts',
        extensionsUrl: 'chrome://extensions',
      },
      {
        id: 'brave',
        label: 'Brave Browser',
        installed: isInstalledWin([
          join(pf, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
          join(pf86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
          join(local, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
        ]),
        registrySubkey: 'BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
        extensionsUrl: 'brave://extensions',
      },
      {
        id: 'edge',
        label: 'Microsoft Edge',
        installed: isInstalledWin([
          join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
          join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
          join(local, 'Microsoft\\Edge\\Application\\msedge.exe'),
        ]),
        registrySubkey: 'Microsoft\\Edge\\NativeMessagingHosts',
        extensionsUrl: 'edge://extensions',
      },
    ].filter((b) => b.installed);
  }

  if (os === 'linux') {
    return [
      {
        id: 'chrome',
        label: 'Google Chrome',
        installed: isInstalledUnix(['google-chrome', 'google-chrome-stable']),
        nmConfigDir: '~/.config/google-chrome/NativeMessagingHosts',
        extensionsUrl: 'chrome://extensions',
      },
      {
        id: 'brave',
        label: 'Brave Browser',
        installed: isInstalledUnix(['brave-browser', 'brave']),
        nmConfigDir: '~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts',
        extensionsUrl: 'brave://extensions',
      },
      {
        id: 'edge',
        label: 'Microsoft Edge',
        installed: isInstalledUnix(['microsoft-edge', 'microsoft-edge-stable']),
        nmConfigDir: '~/.config/microsoft-edge/NativeMessagingHosts',
        extensionsUrl: 'edge://extensions',
      },
      {
        id: 'chromium',
        label: 'Chromium',
        installed: isInstalledUnix(['chromium', 'chromium-browser']),
        nmConfigDir: '~/.config/chromium/NativeMessagingHosts',
        extensionsUrl: 'chrome://extensions',
      },
    ].filter((b) => b.installed);
  }

  if (os === 'darwin') {
    return [
      {
        id: 'chrome',
        label: 'Google Chrome',
        installed: isInstalledMac(['/Applications/Google Chrome.app']),
        nmConfigDir:
          '~/Library/Application Support/Google/Chrome/NativeMessagingHosts',
        extensionsUrl: 'chrome://extensions',
      },
      {
        id: 'brave',
        label: 'Brave Browser',
        installed: isInstalledMac(['/Applications/Brave Browser.app']),
        nmConfigDir:
          '~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts',
        extensionsUrl: 'brave://extensions',
      },
      {
        id: 'edge',
        label: 'Microsoft Edge',
        installed: isInstalledMac(['/Applications/Microsoft Edge.app']),
        nmConfigDir:
          '~/Library/Application Support/Microsoft Edge/NativeMessagingHosts',
        extensionsUrl: 'edge://extensions',
      },
      {
        id: 'chromium',
        label: 'Chromium',
        installed: isInstalledMac(['/Applications/Chromium.app']),
        nmConfigDir:
          '~/Library/Application Support/Chromium/NativeMessagingHosts',
        extensionsUrl: 'chrome://extensions',
      },
    ].filter((b) => b.installed);
  }

  return [];
}

// ─── Paths ────────────────────────────────────────────────────────────────────

export function resolveShimCliPath(): string | null {
  try {
    const installerDir = dirname(fileURLToPath(import.meta.url));
    const p = resolve(installerDir, '../../daemon/dist/nm-shim-cli.js');
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

export function resolveExtensionDistPath(): string | null {
  try {
    const installerDir = dirname(fileURLToPath(import.meta.url));
    const p = resolve(installerDir, '../../extension/dist/chrome-mv3');
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

// ─── Shim wrapper ─────────────────────────────────────────────────────────────

export function shimWrapperDir(): string {
  return join(tmpdir(), 'navora-runtime');
}

export function createShimWrapper(shimCliPath: string): string {
  const dir = shimWrapperDir();
  mkdirSync(dir, { recursive: true });

  const os = platform();
  if (os === 'win32') {
    const bat = join(dir, 'navora-shim.bat');
    writeFileSync(
      bat,
      `@echo off\r\nnode "${shimCliPath}" %*\r\n`,
      'utf8'
    );
    return bat;
  }

  const sh = join(dir, 'navora-shim.sh');
  writeFileSync(sh, `#!/bin/sh\nexec node "${shimCliPath}" "$@"\n`, 'utf8');
  chmodSync(sh, 0o755);
  return sh;
}

// ─── NM manifest ─────────────────────────────────────────────────────────────

export interface NmManifest {
  name: string;
  description: string;
  path: string;
  type: 'stdio';
  allowed_origins: string[];
}

export function buildManifest(
  wrapperPath: string,
  extensionId: string | null
): NmManifest {
  return {
    name: NM_HOST_NAME,
    description: NM_HOST_DESCRIPTION,
    path: wrapperPath,
    type: 'stdio',
    allowed_origins: extensionId
      ? [`chrome-extension://${extensionId}/`]
      : [],
  };
}

export function manifestFilePath(): string {
  return join(shimWrapperDir(), `${NM_HOST_NAME}.json`);
}

export function writeManifest(manifest: NmManifest): string {
  const dir = shimWrapperDir();
  mkdirSync(dir, { recursive: true });
  const p = manifestFilePath();
  writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return p;
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerNmHost(
  browser: NmBrowserProfile,
  manifestPath: string
): void {
  const os = platform();

  if (os === 'win32') {
    const regKey = `HKCU\\Software\\${browser.registrySubkey}\\${NM_HOST_NAME}`;
    execSync(
      `reg add "HKCU\\Software\\${browser.registrySubkey}" /v "${NM_HOST_NAME}" /t REG_SZ /d "${manifestPath}" /f`,
      { stdio: 'pipe' }
    );
    return;
  }

  // Linux / macOS: copy manifest to browser's NM config dir
  const nmDir = resolveHome(browser.nmConfigDir ?? '');
  if (!nmDir) throw new Error(`No NM config dir for ${browser.label}`);
  mkdirSync(nmDir, { recursive: true });
  const dest = join(nmDir, `${NM_HOST_NAME}.json`);
  writeFileSync(dest, readFileSync(manifestPath, 'utf8'), 'utf8');
}

export function unregisterNmHost(browser: NmBrowserProfile): boolean {
  const os = platform();
  try {
    if (os === 'win32') {
      execSync(
        `reg delete "HKCU\\Software\\${browser.registrySubkey}" /v "${NM_HOST_NAME}" /f`,
        { stdio: 'pipe' }
      );
      return true;
    }
    const nmDir = resolveHome(browser.nmConfigDir ?? '');
    const dest = join(nmDir, `${NM_HOST_NAME}.json`);
    if (existsSync(dest)) {
      unlinkSync(dest);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isNmHostRegistered(browser: NmBrowserProfile): boolean {
  const os = platform();
  try {
    if (os === 'win32') {
      execSync(
        `reg query "HKCU\\Software\\${browser.registrySubkey}" /v "${NM_HOST_NAME}"`,
        { stdio: 'pipe' }
      );
      return true;
    }
    const nmDir = resolveHome(browser.nmConfigDir ?? '');
    return existsSync(join(nmDir, `${NM_HOST_NAME}.json`));
  } catch {
    return false;
  }
}

export function registeredExtensionId(browser: NmBrowserProfile): string | null {
  try {
    let manifestContent: string | null = null;
    const os = platform();

    if (os === 'win32') {
      const out = execSync(
        `reg query "HKCU\\Software\\${browser.registrySubkey}" /v "${NM_HOST_NAME}"`,
        { stdio: 'pipe' }
      ).toString();
      const match = /REG_SZ\s+(.+)/.exec(out);
      if (!match) return null;
      manifestContent = readFileSync(match[1]!.trim(), 'utf8');
    } else {
      const nmDir = resolveHome(browser.nmConfigDir ?? '');
      const p = join(nmDir, `${NM_HOST_NAME}.json`);
      if (!existsSync(p)) return null;
      manifestContent = readFileSync(p, 'utf8');
    }

    const doc = JSON.parse(manifestContent) as NmManifest;
    const origin = doc.allowed_origins?.[0];
    if (!origin) return null;
    const m = /chrome-extension:\/\/([^/]+)\//.exec(origin);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}
