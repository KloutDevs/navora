import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

/** Ports probadas para CDP antes de lanzar otra instancia de Chrome. */
export const CDP_CANDIDATE_PORTS = [9222, 9223, 9224] as const;

export const DEFAULT_CDP_PORT = CDP_CANDIDATE_PORTS[0];

const CHROME_USER_DATA_DIR = join(tmpdir(), 'navora-chrome-profile');

/** Puerto CDP efectivo tras `ensureChromeWithCdp()` (`NAVORA_CDP_PORT` o valor por defecto). Usa el mismo valor que `DirectCDPAdapter` vía env en el daemon. */
export function getResolvedCdpPort(): number {
  const raw = process.env['NAVORA_CDP_PORT'];
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_CDP_PORT;
}

const CHROME_PATHS: Record<string, string[]> = {
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

/** Puertos a inspeccionar: `NAVORA_CDP_PORT` fuerza un único puerto; si no, la lista por defecto. */
export function getCdpProbePorts(): readonly number[] {
  const raw = process.env['NAVORA_CDP_PORT'];
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return [n];
  }
  return CDP_CANDIDATE_PORTS;
}

export async function isChromeReachable(port: number = DEFAULT_CDP_PORT): Promise<boolean> {
  try {
    const { default: http } = await import('node:http');
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}

/** Devuelve el primer puerto con CDP activo, o `undefined` si ninguno responde. */
export async function resolveReachableCdpPort(): Promise<number | undefined> {
  for (const port of getCdpProbePorts()) {
    if (await isChromeReachable(port)) return port;
  }
  return undefined;
}

/**
 * Asegura Chrome con CDP: si ya hay un puerto respondiendo, lo reutiliza.
 * Si no hay CDP (p. ej. el navegador abierto no tiene depuración remota), **no** intenta engancharse
 * a ese proceso: lanza una **segunda instancia** del mismo binario con `--remote-debugging-port`
 * y un **perfil de usuario separado** en el primer puerto libre de la lista.
 */
export async function ensureChromeWithCdp(): Promise<number | undefined> {
  const found = await resolveReachableCdpPort();
  if (found !== undefined) {
    process.env['NAVORA_CDP_PORT'] = String(found);
    return found;
  }

  process.stderr.write(
    '[ai-browser] Sin CDP en ' +
      getCdpProbePorts().join(', ') +
      '; iniciando una segunda instancia con perfil aislado y depuración remota.\n'
  );

  const ports = getCdpProbePorts();
  for (const port of ports) {
    try {
      await launchChrome(port);
      process.env['NAVORA_CDP_PORT'] = String(port);
      process.stderr.write(`[ai-browser] CDP disponible en el puerto ${port}.\n`);
      return port;
    } catch {
      // siguiente puerto
    }
  }

  process.stderr.write(
    '[ai-browser] No se pudo abrir CDP en ningún puerto probado; comprueba que Chrome/Brave/Chromium esté instalado.\n'
  );
  return undefined;
}

function findChromeBinary(): string | null {
  const os = platform();
  const candidates = CHROME_PATHS[os] ?? [];
  return candidates.find(p => existsSync(p)) ?? null;
}

export async function launchChrome(port: number = DEFAULT_CDP_PORT): Promise<void> {
  const bin = findChromeBinary();
  if (!bin) {
    throw new Error(
      'No se encontró ningún navegador basado en Chromium (Chrome, Brave, Chromium) en las rutas habituales.'
    );
  }

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${CHROME_USER_DATA_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--disable-infobars',
  ];

  const proc = spawn(bin, args, {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400));
    if (await isChromeReachable(port)) return;
  }

  throw new Error(
    `El navegador se lanzó pero el puerto CDP ${port} no respondió a tiempo (¿puerto en uso?).`
  );
}
