/**
 * DaemonLauncher — ensures the ai-browser daemon is running.
 * Checks the WebSocket port; if unreachable, spawns the daemon process.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import net from 'node:net';

const DAEMON_PORT = Number(process.env['AI_BROWSER_DAEMON_PORT'] ?? 51432);
const DAEMON_HOST = process.env['AI_BROWSER_DAEMON_HOST'] ?? '127.0.0.1';

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
  if (process.env['AI_BROWSER_DAEMON_BINARY']) {
    return { mode: 'node', path: process.env['AI_BROWSER_DAEMON_BINARY'] };
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

export async function ensureDaemon(): Promise<void> {
  if (await isDaemonReachable()) return;

  const binary = resolveDaemonBinary();
  process.stderr.write(`[ai-browser] Starting daemon (${DAEMON_HOST}:${DAEMON_PORT})...\n`);

  const proc = binary.mode === 'node'
    ? spawn(process.execPath, [binary.path], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
      })
    : spawn('npx', [binary.pkg], {
        detached: true,
        stdio: 'ignore',
        shell: true,
        env: { ...process.env },
      });
  proc.unref();

  // Wait up to 6 seconds for daemon to be reachable
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 300));
    if (await isDaemonReachable()) {
      process.stderr.write('[ai-browser] Daemon started.\n');
      return;
    }
  }

  process.stderr.write('[ai-browser] Warning: daemon did not become reachable — some tools may fail.\n');
}
