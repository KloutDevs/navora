/**
 * DaemonLauncher — ensures the ai-browser daemon is running.
 * Checks the WebSocket port; if unreachable, spawns the daemon process.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';

const DAEMON_PORT = Number(process.env['NAVORA_DAEMON_PORT'] ?? 51520);
const DAEMON_HOST = process.env['NAVORA_DAEMON_HOST'] ?? '127.0.0.1';

function isDaemonReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: DAEMON_HOST, port: DAEMON_PORT });
    sock.setTimeout(2000);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

function resolveDaemonBinary(): { mode: 'node'; path: string } | { mode: 'npx'; pkg: string } {
  if (process.env['NAVORA_DAEMON_BINARY']) {
    return { mode: 'node', path: process.env['NAVORA_DAEMON_BINARY'] };
  }

  // Monorepo layout: <workspace-root>/apps/daemon/dist/main.js
  // This plugin bundle:  <workspace-root>/apps/claude-plugin/dist/index.js
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const monoRepoPath = join(__dirname, '..', '..', '..', 'apps', 'daemon', 'dist', 'main.js');

  if (existsSync(monoRepoPath)) {
    return { mode: 'node', path: monoRepoPath };
  }

  // npm install context — daemon is a separate published package
  return { mode: 'npx', pkg: 'navora-daemon' };
}

function clearStaleLockfile(): void {
  const lockPath = join(tmpdir(), 'ai-browser-runtime', 'daemon.pid');
  try {
    const content = readFileSync(lockPath, 'utf8');
    const { pid } = JSON.parse(content) as { pid: number };
    let alive = false;
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process') as typeof import('child_process');
        const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { stdio: 'pipe' }).toString();
        alive = out.includes(String(pid));
      } else {
        process.kill(pid, 0);
        alive = true;
      }
    } catch { alive = false; }
    if (!alive) unlinkSync(lockPath);
  } catch { /* no lockfile or already clean */ }
}

function openLogFd(): number {
  try {
    const logDir = join(tmpdir(), 'ai-browser-runtime');
    mkdirSync(logDir, { recursive: true });
    return openSync(join(logDir, 'daemon.log'), 'a');
  } catch {
    return -1;
  }
}

export async function ensureDaemon(): Promise<void> {
  if (await isDaemonReachable()) return;

  clearStaleLockfile();
  const binary = resolveDaemonBinary();
  process.stderr.write(`[ai-browser] Starting daemon (${DAEMON_HOST}:${DAEMON_PORT})...\n`);

  const logFd = openLogFd();
  const errIo = logFd >= 0 ? logFd : 'ignore' as const;
  const sharedOpts = {
    detached: true,
    stdio: ['ignore', 'ignore', errIo] as ['ignore', 'ignore', number | 'ignore'],
    windowsHide: true,
    env: { ...process.env },
  };

  const proc = binary.mode === 'node'
    ? spawn(process.execPath, [binary.path], sharedOpts)
    : spawn(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['-y', binary.pkg],
        { ...sharedOpts, shell: process.platform === 'win32' }
      );
  proc.unref();

  // Wait up to 8 seconds for daemon to be reachable
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 300));
    if (await isDaemonReachable()) {
      process.stderr.write('[ai-browser] Daemon started.\n');
      return;
    }
  }

  process.stderr.write('[ai-browser] Warning: daemon did not become reachable — some tools may fail.\n');
}
