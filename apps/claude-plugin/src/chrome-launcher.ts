import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';

const CDP_PORT = 9222;
const CHROME_USER_DATA_DIR = '/tmp/ai-browser-chrome-profile';

const CHROME_PATHS: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    (process.env['LOCALAPPDATA'] ?? '') + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env['LOCALAPPDATA'] + '\\Google\\Chrome\\Application\\chrome.exe',
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

export async function isChromeReachable(port = CDP_PORT): Promise<boolean> {
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

function findChromeBinary(): string | null {
  const os = platform();
  const candidates = CHROME_PATHS[os] ?? [];
  return candidates.find(p => existsSync(p)) ?? null;
}

export async function launchChrome(port = CDP_PORT): Promise<void> {
  const bin = findChromeBinary();
  if (!bin) {
    throw new Error(
      `No Chromium-based browser found (Chrome, Brave, Chromium).\n` +
      `Launch your browser manually with: brave --remote-debugging-port=${port}\n` +
      `Or set AI_BROWSER_CDP_PORT if using a different port.`
    );
  }

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${CHROME_USER_DATA_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];

  const proc = spawn(bin, args, {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();

  // Wait up to 8 seconds for Chrome to be reachable
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400));
    if (await isChromeReachable(port)) return;
  }

  throw new Error(`Chrome launched but CDP port ${port} is not responding. Check that no other Chrome instance is blocking the port.`);
}
