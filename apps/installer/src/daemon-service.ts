/**
 * Daemon service management — cross-platform.
 *
 * Windows : Task Scheduler via schtasks (no admin required, runs at logon)
 * Linux   : systemd --user service
 * macOS   : LaunchAgent (~/Library/LaunchAgents)
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

// ─── Constants ────────────────────────────────────────────────────────────────

export const WIN_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const WIN_RUN_VALUE = 'NavoraDaemon';       // Registry Run key value
export const SERVICE_NAME = 'navora-daemon';       // systemd / launchctl

// ─── Debug logging ────────────────────────────────────────────────────────────

const DEBUG = process.env['NAVORA_DEBUG'] === '1';

function dbg(msg: string): void {
  if (DEBUG) process.stderr.write(`[daemon-service] ${msg}\n`);
}

// ─── Command helpers ──────────────────────────────────────────────────────────

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runRaw(cmd: string, args: string[]): RunResult {
  dbg(`run: ${cmd} ${args.join(' ')}`);
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    dbg(`  → ok: ${stdout.trim().slice(0, 200)}`);
    return { stdout, stderr: '', code: 0 };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string; status?: number };
    const stderr = err.stderr ?? '';
    const stdout = err.stdout ?? '';
    const code = err.status ?? 1;
    dbg(`  → error (${code}): ${stderr.trim().slice(0, 300)}`);
    return { stdout, stderr, code };
  }
}

/** Runs and throws a descriptive error on failure. */
function run(cmd: string, args: string[]): string {
  const r = runRaw(cmd, args);
  if (r.code !== 0) {
    const detail = (r.stderr || r.stdout).trim();
    throw new Error(`Comando falló (${r.code}): ${cmd} ${args.join(' ')}\n${detail}`);
  }
  return r.stdout;
}

/** Runs silently; returns null on failure. */
function tryRun(cmd: string, args: string[]): string | null {
  const r = runRaw(cmd, args);
  return r.code === 0 ? r.stdout : null;
}

// ─── Windows helpers ──────────────────────────────────────────────────────────

const WIN_CONFIG_DIR = join(homedir(), 'AppData', 'Local', 'Navora');
const WIN_CONFIG_FILE = join(WIN_CONFIG_DIR, 'config.json');

interface WinConfig {
  mode?: 'local' | 'npx';
  nodePath?: string;
  daemonPath?: string;
}

function writeWinConfig(cfg: WinConfig): void {
  mkdirSync(WIN_CONFIG_DIR, { recursive: true });
  writeFileSync(WIN_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  dbg(`config written: ${WIN_CONFIG_FILE}`);
}

function readWinConfig(): WinConfig | null {
  try {
    return JSON.parse(readFileSync(WIN_CONFIG_FILE, 'utf8')) as WinConfig;
  } catch {
    return null;
  }
}

/** Writes a .bat for local mode (node + daemonPath). */
function writeBatWrapper(nodePath: string, daemonPath: string): string {
  mkdirSync(WIN_CONFIG_DIR, { recursive: true });
  const bat = join(WIN_CONFIG_DIR, 'navora-daemon.bat');
  writeFileSync(
    bat,
    `@echo off\r\nstart "" /B "${nodePath}" "${daemonPath}"\r\n`,
    'utf8'
  );
  dbg(`bat wrapper (local): ${bat}`);
  return bat;
}

/** Writes a .bat for npx mode — uses the full path to npx.cmd resolved at install time. */
function writeBatWrapperNpx(npxPath: string): string {
  mkdirSync(WIN_CONFIG_DIR, { recursive: true });
  const bat = join(WIN_CONFIG_DIR, 'navora-daemon.bat');
  writeFileSync(bat, `@echo off\r\nstart "" /B "${npxPath}" -y navora-daemon\r\n`, 'utf8');
  dbg(`bat wrapper (npx): ${bat} using ${npxPath}`);
  return bat;
}

/**
 * Resolves the absolute path to npx at install time, using the same Node
 * installation that is running the installer. Services (Registry Run, systemd,
 * launchd) start with a minimal PATH that often does NOT include npm global
 * bin, so we must bake the full path rather than relying on PATH at runtime.
 */
function resolveNpxPath(): string {
  const nodeDir = dirname(process.execPath);
  const candidate = platform() === 'win32'
    ? join(nodeDir, 'npx.cmd')
    : join(nodeDir, 'npx');
  if (existsSync(candidate)) {
    dbg(`resolved npx: ${candidate}`);
    return candidate;
  }
  // Fallback: hope PATH is available (nvm global installs, etc.)
  dbg(`npx not found next to node (${candidate}), falling back to name-only`);
  return platform() === 'win32' ? 'npx.cmd' : 'npx';
}

/** Removes a stale lockfile if the recorded PID is no longer alive. */
function clearStaleLockfileSync(): void {
  const lockPath = join(tmpdir(), 'navora', 'daemon.pid');
  try {
    const data = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number };
    const out = tryRun('tasklist', ['/FI', `PID eq ${data.pid}`, '/NH']);
    const alive = out !== null && out.includes(String(data.pid));
    if (!alive) {
      unlinkSync(lockPath);
      dbg(`cleared stale lockfile (dead PID ${data.pid})`);
    }
  } catch {
    // no lockfile or unreadable — that's fine
  }
}

/** Checks if a daemon process is currently running via lockfile PID. */
function isDaemonProcessRunning(): boolean {
  try {
    const lockPath = join(tmpdir(), 'navora', 'daemon.pid');
    const data = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number };
    if (platform() === 'win32') {
      // tasklist exits 0 even when the PID doesn't exist — must check output
      const out = tryRun('tasklist', ['/FI', `PID eq ${data.pid}`, '/NH', '/FO', 'CSV']);
      return out !== null && out.includes(`"${data.pid}"`);
    }
    // Unix: signal 0 checks existence
    process.kill(data.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Finds which PID is using a TCP port on Windows (via netstat). */
function pidOnPort(port: number): number | null {
  const out = tryRun('netstat', ['-ano', '-p', 'TCP']);
  if (!out) return null;
  const pattern = new RegExp(`127\\.0\\.0\\.1:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`);
  const m = pattern.exec(out);
  return m ? Number(m[1]) : null;
}

/** Kills the process holding the given port, if any. */
function killPortOwner(port: number): void {
  const pid = pidOnPort(port);
  if (pid && pid > 4) {   // PID 0-4 are system processes — never kill
    dbg(`killing PID ${pid} which holds port ${port}`);
    tryRun('taskkill', ['/PID', String(pid), '/F']);
  }
}

// ─── Status ──────────────────────────────────────────────────────────────────

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  platform: 'windows' | 'linux' | 'macos' | 'unsupported';
  detail?: string;
}

export function getServiceStatus(): ServiceStatus {
  const os = platform();
  dbg(`getServiceStatus on ${os}`);

  if (os === 'win32') {
    const out = tryRun('reg', ['query', WIN_RUN_KEY, '/v', WIN_RUN_VALUE]);
    if (!out) return { installed: false, running: false, platform: 'windows' };
    // Check if the daemon process is running (lockfile PID check)
    const running = isDaemonProcessRunning();
    dbg(`registry entry found, running=${running}`);
    return { installed: true, running, platform: 'windows', detail: out.trim() };
  }

  if (os === 'linux') {
    const unitFile = join(homedir(), '.config', 'systemd', 'user', `${SERVICE_NAME}.service`);
    if (!existsSync(unitFile)) return { installed: false, running: false, platform: 'linux' };
    const out = tryRun('systemctl', ['--user', 'is-active', SERVICE_NAME]) ?? '';
    return { installed: true, running: out.trim() === 'active', platform: 'linux' };
  }

  if (os === 'darwin') {
    const plist = launchAgentPath();
    if (!existsSync(plist)) return { installed: false, running: false, platform: 'macos' };
    const out = tryRun('launchctl', ['list', SERVICE_NAME]);
    return {
      installed: true,
      running: out !== null && !out.includes('Could not find'),
      platform: 'macos',
    };
  }

  return { installed: false, running: false, platform: 'unsupported' };
}

// ─── Install ──────────────────────────────────────────────────────────────────

export function installService(daemonPath?: string): void {
  const os = platform();
  const node = process.execPath;
  const mode = daemonPath ? 'local' : 'npx';
  dbg(`installService on ${os}, mode=${mode}, daemon=${daemonPath ?? 'npx'}`);

  if (os === 'win32') {
    if (daemonPath) {
      writeWinConfig({ mode: 'local', nodePath: node, daemonPath });
      const bat = writeBatWrapper(node, daemonPath);
      run('reg', ['add', WIN_RUN_KEY, '/v', WIN_RUN_VALUE, '/t', 'REG_SZ', '/d', bat, '/f']);
    } else {
      const npx = resolveNpxPath();
      writeWinConfig({ mode: 'npx', nodePath: npx });
      const bat = writeBatWrapperNpx(npx);
      run('reg', ['add', WIN_RUN_KEY, '/v', WIN_RUN_VALUE, '/t', 'REG_SZ', '/d', bat, '/f']);
    }
    return;
  }

  if (os === 'linux') {
    const dir = join(homedir(), '.config', 'systemd', 'user');
    mkdirSync(dir, { recursive: true });
    const unitFile = join(dir, `${SERVICE_NAME}.service`);
    const npx = resolveNpxPath();
    const execStart = daemonPath
      ? `ExecStart="${node}" "${daemonPath}"`
      : `ExecStart="${npx}" -y navora-daemon`;
    const content = [
      '[Unit]',
      'Description=Navora Daemon',
      'After=network.target',
      '',
      '[Service]',
      'Type=simple',
      execStart,
      'Restart=on-failure',
      'RestartSec=5',
      `StandardOutput=append:${join(homedir(), '.navora-daemon.log')}`,
      `StandardError=append:${join(homedir(), '.navora-daemon.log')}`,
      '',
      '[Install]',
      'WantedBy=default.target',
    ].join('\n') + '\n';
    dbg(`writing ${unitFile}`);
    writeFileSync(unitFile, content, 'utf8');
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', SERVICE_NAME]);
    return;
  }

  if (os === 'darwin') {
    const plist = launchAgentPath();
    const logFile = join(homedir(), '.navora-daemon.log');
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    const npx = resolveNpxPath();
    const programArgs = daemonPath
      ? [`    <string>${node}</string>`, `    <string>${daemonPath}</string>`].join('\n')
      : [
          `    <string>${npx}</string>`,
          '    <string>-y</string>',
          '    <string>navora-daemon</string>',
        ].join('\n');
    const content = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"',
      '  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      `  <key>Label</key><string>${SERVICE_NAME}</string>`,
      '  <key>ProgramArguments</key>',
      '  <array>',
      programArgs,
      '  </array>',
      '  <key>RunAtLoad</key><true/>',
      '  <key>KeepAlive</key><true/>',
      `  <key>StandardOutPath</key><string>${logFile}</string>`,
      `  <key>StandardErrorPath</key><string>${logFile}</string>`,
      '</dict>',
      '</plist>',
    ].join('\n') + '\n';
    dbg(`writing ${plist}`);
    writeFileSync(plist, content, 'utf8');
    return;
  }

  throw new Error(`Plataforma no soportada para gestión de servicios: ${os}`);
}

// ─── Start / stop ─────────────────────────────────────────────────────────────

export function startService(_daemonPath?: string): void {
  const os = platform();
  dbg(`startService on ${os}`);

  if (os === 'win32') {
    clearStaleLockfileSync();
    const daemonPort = Number(process.env['NAVORA_DAEMON_PORT'] ?? 51520);
    killPortOwner(daemonPort);
    const cfg = readWinConfig();
    if (!cfg) throw new Error('Servicio no instalado (config no encontrado).');
    const logDir = join(tmpdir(), 'navora');
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, 'daemon.log');
    let errFd = -1;
    try { errFd = openSync(logPath, 'a'); } catch { /* ignore */ }
    const stdio: ['ignore', 'ignore', number] | 'ignore' = errFd >= 0
      ? ['ignore', 'ignore', errFd]
      : 'ignore';
    if (cfg.mode === 'npx' || !cfg.nodePath || !cfg.daemonPath) {
      // cfg.nodePath stores the resolved npx path when mode === 'npx'
      const npxBin = cfg.nodePath ?? resolveNpxPath();
      dbg(`spawning via npx: ${npxBin}`);
      const child = spawn(npxBin, ['-y', 'navora-daemon'], {
        detached: true,
        stdio,
        windowsHide: true,
        env: { ...process.env },
      });
      child.unref();
    } else {
      dbg(`spawning node directly: ${cfg.nodePath} ${cfg.daemonPath}`);
      const child = spawn(cfg.nodePath, [cfg.daemonPath], {
        detached: true,
        stdio,
        windowsHide: true,
        env: { ...process.env },
      });
      child.unref();
    }
    if (errFd >= 0) { try { closeSync(errFd); } catch { /* ignore */ } }
  } else if (os === 'linux') {
    run('systemctl', ['--user', 'start', SERVICE_NAME]);
  } else if (os === 'darwin') {
    run('launchctl', ['load', launchAgentPath()]);
  }
}

export function stopService(): void {
  const os = platform();
  dbg(`stopService on ${os}`);

  if (os === 'win32') {
    try {
      const lockPath = join(tmpdir(), 'navora', 'daemon.pid');
      const data = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number };
      dbg(`killing daemon PID ${data.pid}`);
      tryRun('taskkill', ['/PID', String(data.pid), '/F']);
    } catch { /* no lockfile or already dead */ }
  } else if (os === 'linux') {
    tryRun('systemctl', ['--user', 'stop', SERVICE_NAME]);
  } else if (os === 'darwin') {
    tryRun('launchctl', ['unload', launchAgentPath()]);
  }
}

// ─── Uninstall ────────────────────────────────────────────────────────────────

export function uninstallService(): void {
  const os = platform();
  dbg(`uninstallService on ${os}`);
  stopService();

  if (os === 'win32') {
    tryRun('reg', ['delete', WIN_RUN_KEY, '/v', WIN_RUN_VALUE, '/f']);
    return;
  }

  if (os === 'linux') {
    tryRun('systemctl', ['--user', 'disable', SERVICE_NAME]);
    const f = join(homedir(), '.config', 'systemd', 'user', `${SERVICE_NAME}.service`);
    if (existsSync(f)) { unlinkSync(f); dbg(`deleted ${f}`); }
    tryRun('systemctl', ['--user', 'daemon-reload']);
    return;
  }

  if (os === 'darwin') {
    const plist = launchAgentPath();
    if (existsSync(plist)) { unlinkSync(plist); dbg(`deleted ${plist}`); }
    return;
  }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function launchAgentPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', 'com.navora.daemon.plist');
}
