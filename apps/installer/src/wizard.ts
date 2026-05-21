import { confirm, isCancel, note, outro, select, text } from '@clack/prompts';
import { createSpinner } from './spinner.js';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { printBanner } from './banner.js';
import { c } from './colors.js';

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = require(pkgPath) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
import { readState, writeState } from './state.js';
import { getServiceStatus, installService, startService, stopService, uninstallService } from './daemon-service.js';
import {
  CLAUDE_LEGACY_KEYS,
  CLAUDE_MCP_SERVER_NAME,
  checkClaudeNavoraInstalled,
  clearStaleDaemonLockfile,
  getDaemonPort,
  isDaemonReachable,
  resolveLocalPluginPaths,
  runCapture,
  sleep,
  startDaemon,
} from './probes.js';
import {
  buildManifest,
  createShimWrapper,
  detectNmBrowsers,
  isNmHostRegistered,
  registeredExtensionId,
  registerNmHost,
  resolveExtensionDistPath,
  resolveShimCliPath,
  writeManifest,
  type NmBrowserProfile,
} from './nm-setup.js';
import {
  CURSOR_MCP_SERVER_KEY,
  isCursorNavoraConfigured,
  removeCursorMcpServers,
  upsertCursorMcpServer,
} from './cursor-config.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WizardStatus {
  daemonRunning: boolean;
  daemonService: boolean;
  extensionBrowser: string | null;
  extensionId: string | null;
  claudeInstalled: boolean;
  cursorInstalled: boolean;
}

type StepId = 'daemon' | 'extension' | 'claude' | 'cursor';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stepHeader(version: string, current: number, total: number, title: string): void {
  printBanner(version);
  const header = `── [${current}/${total}]  ${title} `;
  const pad = '─'.repeat(Math.max(0, 51 - header.length));
  process.stdout.write(`  ${c.p3}${header}${pad}${c.reset}\n\n`);
}

function runInteractive(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

async function waitForDaemon(ms = 12000): Promise<boolean> {
  await clearStaleDaemonLockfile();
  startDaemon();
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await sleep(400);
    if (await isDaemonReachable()) return true;
  }
  return false;
}

// ─── Status detection ─────────────────────────────────────────────────────────

async function detectStatus(): Promise<WizardStatus> {
  const svc = getServiceStatus();
  const [daemonRunning, claudeInfo] = await Promise.all([
    isDaemonReachable(),
    checkClaudeNavoraInstalled(),
  ]);
  const cursorInfo = isCursorNavoraConfigured();

  // Extension: check live NM registry first, then fall back to persisted state
  let extensionBrowser: string | null = null;
  let extensionId: string | null = null;
  const browsers = detectNmBrowsers();
  for (const b of browsers) {
    if (isNmHostRegistered(b)) {
      extensionBrowser = b.label;
      extensionId = registeredExtensionId(b);
      break;
    }
  }
  if (!extensionBrowser) {
    const state = readState();
    extensionBrowser = state.extension?.browser ?? null;
    extensionId = state.extension?.extensionId ?? null;
  }

  return {
    daemonRunning,
    daemonService: svc.installed,
    extensionBrowser,
    extensionId,
    claudeInstalled: claudeInfo.installed,
    cursorInstalled: cursorInfo.configured,
  };
}

function renderStatusCard(status: WizardStatus): string {
  const row = (label: string, ok: boolean, detail: string) => {
    const icon = ok ? `${c.ok}✓${c.reset}` : `${c.err}✗${c.reset}`;
    const detailColored = ok ? `${c.p6}${detail}${c.reset}` : `${c.dim}${detail}${c.reset}`;
    return `  ${c.p4}${label.padEnd(14)}${c.reset} ${icon}  ${detailColored}`;
  };

  const daemonDetail = status.daemonRunning
    ? `corriendo (:${getDaemonPort()})${status.daemonService ? ' [servicio]' : ''}`
    : status.daemonService
      ? 'servicio instalado, no responde'
      : 'no corriendo';

  const extDetail = status.extensionBrowser
    ? `${status.extensionBrowser}${status.extensionId ? ` [${status.extensionId.slice(0, 8)}…]` : ''}`
    : 'no configurada';

  return [
    row('Daemon', status.daemonRunning, daemonDetail),
    row('Extensión', !!status.extensionBrowser, extDetail),
    row('Claude Code', status.claudeInstalled, status.claudeInstalled ? 'navora' : 'no instalado'),
    row('Cursor', status.cursorInstalled, status.cursorInstalled ? 'navora' : 'no configurado'),
  ].join('\n');
}

function pendingSteps(status: WizardStatus): StepId[] {
  const steps: StepId[] = [];
  if (!status.daemonRunning) steps.push('daemon');
  if (!status.extensionBrowser) steps.push('extension');
  if (!status.claudeInstalled) steps.push('claude');
  if (!status.cursorInstalled) steps.push('cursor');
  return steps;
}

// ─── Step: Daemon ─────────────────────────────────────────────────────────────

async function stepDaemon(version: string, current: number, total: number): Promise<void> {
  stepHeader(version, current, total, 'Daemon');

  process.stdout.write('  El daemon corre en background y gestiona todas las\n');
  process.stdout.write('  interacciones con el browser. Sin él, ninguna\n');
  process.stdout.write('  herramienta de automatización va a funcionar.\n\n');

  const choice = await select({
    message: '¿Cómo querés iniciarlo?',
    options: [
      { value: 'service', label: 'Instalar como servicio', hint: 'arranca solo al encender la PC' },
      { value: 'now', label: 'Solo iniciarlo ahora', hint: 'sin persistencia' },
      { value: 'skip', label: 'Omitir este paso' },
    ],
  });

  if (isCancel(choice) || choice === 'skip') return;

  const local = resolveLocalPluginPaths();

  if (choice === 'service') {
    const s = createSpinner('Registrando servicio del sistema...');
    try {
      installService(local?.daemon);
      s.message('Iniciando daemon...');
      startService(local?.daemon);
      await sleep(2000);
      const running = await isDaemonReachable();
      s.stop(running
        ? `Daemon corriendo en :${getDaemonPort()}`
        : 'Servicio registrado — verificá los logs si no responde'
      );
      writeState({ daemon: { serviceInstalled: true, installedAt: new Date().toISOString() } });
    } catch (e) {
      s.fail(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }

  const s = createSpinner('Iniciando daemon...');
  const ok = await waitForDaemon();
  s.stop(ok
    ? `Daemon corriendo en :${getDaemonPort()}`
    : 'Daemon no respondió — verificá los logs'
  );
}

// ─── Step: Extension ──────────────────────────────────────────────────────────

async function stepExtension(version: string, current: number, total: number): Promise<void> {
  stepHeader(version, current, total, 'Extensión del browser');

  process.stdout.write('  La extensión vincula el browser con el daemon.\n');
  process.stdout.write('  Sin ella, el daemon no puede controlar ninguna pestaña.\n\n');

  const browsers = detectNmBrowsers();

  if (browsers.length === 0) {
    note('No se detectó ningún browser compatible (Chrome, Brave, Edge, Chromium).', 'Sin browsers');
    return;
  }

  const browserChoice = await select({
    message: '¿En qué browser la instalás?',
    options: [
      ...browsers.map((b) => ({ value: b.id, label: b.label })),
      { value: 'skip', label: 'Omitir este paso' },
    ],
  });

  if (isCancel(browserChoice) || browserChoice === 'skip') return;

  const browser = browsers.find((b) => b.id === browserChoice) as NmBrowserProfile;
  const extDist = resolveExtensionDistPath();

  note(
    [
      `Cargá la extensión en ${browser.label}:`,
      '',
      `  1. Abrí ${browser.extensionsUrl}`,
      '  2. Activá "Modo desarrollador"  (esquina superior derecha)',
      '  3. "Cargar desempaquetada" →',
      `     ${extDist ?? '(extensión no buildeada localmente)'}`,
      '  4. Copiá el ID de 32 letras de la tarjeta',
    ].join('\n'),
    'Instrucciones'
  );

  const rawId = await text({
    message: 'ID de extensión  (Enter para omitir)',
    placeholder: 'abcdefghijklmnopabcdefghijklmnop',
    validate: (v) => {
      if (!v) return;
      if (!/^[a-z]{32}$/.test(v)) return 'El ID debe tener 32 letras minúsculas';
    },
  });

  if (isCancel(rawId)) return;
  const extensionId = typeof rawId === 'string' && rawId.trim() !== '' ? rawId.trim() : null;

  const shimCli = resolveShimCliPath();
  if (!shimCli) {
    note('nm-shim-cli no encontrado — ejecutá pnpm build para generar el shim.', 'Error');
    return;
  }

  const s = createSpinner(`Registrando host de mensajería nativa para ${browser.label}...`);
  try {
    const wrapperPath = createShimWrapper(shimCli);
    const manifest = buildManifest(wrapperPath, extensionId);
    const manifestPath = writeManifest(manifest);
    registerNmHost(browser, manifestPath);
    s.stop(extensionId
      ? `Extensión vinculada [${extensionId.slice(0, 8)}…]`
      : 'Host registrado (sin ID — completá más tarde)'
    );
    writeState({
      extension: {
        browser: browser.label,
        extensionId,
        nmRegistered: true,
        configuredAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    s.fail(`Error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Step: Claude Code MCP ────────────────────────────────────────────────────

async function stepClaude(version: string, current: number, total: number): Promise<void> {
  stepHeader(version, current, total, 'Plugin para Claude Code');

  process.stdout.write('  Registra navora en Claude Code para que las herramientas\n');
  process.stdout.write('  del browser aparezcan automáticamente en cada sesión.\n\n');

  const ok = await confirm({ message: '¿Registrar el plugin?' });
  if (isCancel(ok) || !ok) return;

  const s = createSpinner('Limpiando entradas anteriores...');
  for (const legacy of CLAUDE_LEGACY_KEYS) {
    await runCapture('claude', ['mcp', 'remove', legacy]);
  }
  await runCapture('claude', ['mcp', 'remove', CLAUDE_MCP_SERVER_NAME]);
  s.stop('');

  const local = resolveLocalPluginPaths();
  const addArgs = local
    ? ['mcp', 'add', CLAUDE_MCP_SERVER_NAME, 'node', local.claudePlugin]
    : ['mcp', 'add', CLAUDE_MCP_SERVER_NAME, 'npx', '-y', 'navora-claude-plugin'];

  const code = await runInteractive('claude', addArgs);

  if (code === 0) {
    const state = readState();
    writeState({ mcp: { ...(state.mcp ?? {}), claude: { installed: true, key: CLAUDE_MCP_SERVER_NAME } } });
  } else {
    note(
      `El comando \`claude\` falló. Instalá manualmente:\n  claude mcp add ${CLAUDE_MCP_SERVER_NAME} npx -y navora-claude-plugin`,
      'Acción requerida'
    );
  }
}

// ─── Step: Cursor MCP ─────────────────────────────────────────────────────────

async function stepCursor(version: string, current: number, total: number): Promise<void> {
  stepHeader(version, current, total, 'Plugin para Cursor');

  process.stdout.write('  Escribe la configuración en ~/.cursor/mcp.json para que\n');
  process.stdout.write('  Cursor tenga acceso a las herramientas navora.\n\n');

  const ok = await confirm({ message: '¿Registrar el plugin?' });
  if (isCancel(ok) || !ok) return;

  const s = createSpinner('Escribiendo ~/.cursor/mcp.json...');
  try {
    removeCursorMcpServers([CURSOR_MCP_SERVER_KEY, ...CLAUDE_LEGACY_KEYS]);
    const local = resolveLocalPluginPaths();
    const entry = local
      ? { command: 'node', args: [local.cursorPlugin] }
      : { command: 'npx', args: ['-y', 'navora-cursor-plugin'] };
    upsertCursorMcpServer(CURSOR_MCP_SERVER_KEY, entry);
    s.stop('Plugin registrado en Cursor');
    const state = readState();
    writeState({ mcp: { ...(state.mcp ?? {}), cursor: { installed: true } } });
  } catch (e) {
    s.fail(`Error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Reconfig menu ────────────────────────────────────────────────────────────

async function reconfigMenu(version: string): Promise<void> {
  printBanner(version);

  const component = await select({
    message: '¿Qué componente querés gestionar?',
    options: [
      { value: 'daemon', label: 'Daemon' },
      { value: 'extension', label: 'Extensión del browser' },
      { value: 'claude', label: 'Plugin Claude Code' },
      { value: 'cursor', label: 'Plugin Cursor' },
      { value: 'back', label: 'Volver' },
    ],
  });

  if (isCancel(component) || component === 'back') return;

  switch (component) {
    case 'daemon': await stepDaemon(version, 1, 1); break;
    case 'extension': await stepExtension(version, 1, 1); break;
    case 'claude': await stepClaude(version, 1, 1); break;
    case 'cursor': await stepCursor(version, 1, 1); break;
  }
}

// ─── Status menu (subsequent runs) ───────────────────────────────────────────

async function showStatusMenu(version: string, status: WizardStatus): Promise<void> {
  printBanner(version);
  note(renderStatusCard(status), 'Estado actual');

  const action = await select({
    message: '¿Qué querés hacer?',
    options: [
      { value: 'doctor', label: 'Verificar conexión' },
      { value: 'reconfig', label: 'Reconfigurar un componente' },
      { value: 'exit', label: 'Salir' },
    ],
  });

  if (isCancel(action) || action === 'exit') {
    outro('Hasta luego.');
    return;
  }

  if (action === 'doctor') {
    const { runDoctor } = await import('./doctor.js');
    process.exit(await runDoctor());
  }

  if (action === 'reconfig') {
    await reconfigMenu(version);
  }
}

// ─── Wizard entry point ───────────────────────────────────────────────────────

export async function runWizard(): Promise<void> {
  const version = readVersion();
  printBanner(version);

  const s = createSpinner('Detectando entorno...');
  const status = await detectStatus();
  s.stop('Entorno detectado');

  const pending = pendingSteps(status);

  if (pending.length === 0) {
    await showStatusMenu(version, status);
    return;
  }

  if (pending.length < 4) {
    printBanner(version);
    note(renderStatusCard(status), 'Estado actual');

    const total = pending.length;
    const proceed = await confirm({
      message: `${total} componente${total > 1 ? 's' : ''} pendiente${total > 1 ? 's' : ''}. ¿Completar la configuración?`,
    });

    if (isCancel(proceed) || !proceed) {
      outro('Podés continuar más tarde ejecutando `navora`.');
      return;
    }
  }

  const total = pending.length;
  for (let i = 0; i < pending.length; i++) {
    const current = i + 1;
    switch (pending[i]) {
      case 'daemon': await stepDaemon(version, current, total); break;
      case 'extension': await stepExtension(version, current, total); break;
      case 'claude': await stepClaude(version, current, total); break;
      case 'cursor': await stepCursor(version, current, total); break;
    }
  }

  const finalStatus = await detectStatus();
  printBanner(version);
  note(renderStatusCard(finalStatus), 'Instalación completada');
  outro('Reiniciá el IDE para activar el MCP. Ejecutá `navora doctor` para verificar.');
}

// ─── Non-interactive CLI commands ─────────────────────────────────────────────

export async function runStatus(): Promise<number> {
  const status = await detectStatus();
  const card = renderStatusCard(status);
  process.stdout.write(card + '\n');
  const allOk =
    status.daemonRunning && !!status.extensionBrowser && status.claudeInstalled && status.cursorInstalled;
  return allOk ? 0 : 1;
}

export async function runDaemonCmd(subcmd: string): Promise<number> {
  const local = resolveLocalPluginPaths();

  switch (subcmd) {
    case 'install': {
      const s = createSpinner('Registrando servicio del sistema...');
      try {
        installService(local?.daemon);
        s.message('Iniciando daemon...');
        startService(local?.daemon);
        await sleep(2000);
        const running = await isDaemonReachable();
        s.stop(running ? `Daemon corriendo (:${getDaemonPort()})` : 'Servicio registrado — daemon no respondió');
        writeState({ daemon: { serviceInstalled: true, installedAt: new Date().toISOString() } });
        return running ? 0 : 1;
      } catch (e) {
        s.fail(`Error: ${e instanceof Error ? e.message : String(e)}`);
        return 1;
      }
    }
    case 'start': {
      const s = createSpinner('Iniciando daemon...');
      const ok = await waitForDaemon();
      s.stop(ok ? `Daemon corriendo (:${getDaemonPort()})` : 'Daemon no respondió');
      return ok ? 0 : 1;
    }
    case 'stop': {
      const s = createSpinner('Deteniendo daemon...');
      stopService();
      s.stop('Daemon detenido');
      return 0;
    }
    case 'uninstall': {
      const s = createSpinner('Desinstalando servicio...');
      uninstallService();
      s.stop('Servicio desinstalado');
      return 0;
    }
    default: {
      process.stderr.write(`Subcomando desconocido: ${subcmd}\nUso: navora daemon [install|start|stop|uninstall]\n`);
      return 1;
    }
  }
}
