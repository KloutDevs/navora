import {
  cancel,
  intro,
  isCancel,
  note,
  outro,
  select,
  spinner,
} from '@clack/prompts';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { spawn } from 'node:child_process';

// Activa debug en modo local automáticamente para ver errores del servicio
if (!process.env['NAVORA_DEBUG'] && process.argv.includes('--debug')) {
  process.env['NAVORA_DEBUG'] = '1';
}

import {
  getServiceStatus,
  installService,
  startService,
  stopService,
  uninstallService,
} from './daemon-service.js';
import {
  buildManifest,
  createShimWrapper,
  detectNmBrowsers,
  isNmHostRegistered,
  manifestFilePath,
  NM_HOST_NAME,
  registerNmHost,
  registeredExtensionId,
  resolveExtensionDistPath,
  resolveShimCliPath,
  unregisterNmHost,
  writeManifest,
  type NmBrowserProfile,
} from './nm-setup.js';

import {
  CURSOR_MCP_SERVER_KEY,
  removeCursorMcpServers,
  upsertCursorMcpServer,
} from './cursor-config.js';
import {
  CDP_CHECK_PORTS,
  CLAUDE_LEGACY_KEYS,
  CLAUDE_MCP_SERVER_NAME,
  findCdpPortReachable,
  gatherEnvironmentState,
  getDaemonPort,
  type InstallerEnvState,
  isDaemonReachable,
  clearStaleDaemonLockfile,
  DAEMON_LOG_PATH,
  resolveLocalPluginPaths,
  runCapture,
  sleep,
  startDaemon,
} from './probes.js';
import { formatInstallerSummary } from './format-installer-summary.js';
import { usageInstructions } from './usage.js';

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

async function ensureDaemonForTest(): Promise<boolean> {
  if (await isDaemonReachable()) return true;
  await clearStaleDaemonLockfile();
  startDaemon();
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await sleep(400);
    if (await isDaemonReachable()) return true;
  }
  return false;
}

async function installClaudeMcp(): Promise<void> {
  // Limpia claves legado silenciosamente antes de instalar
  for (const legacy of CLAUDE_LEGACY_KEYS) {
    await runCapture('claude', ['mcp', 'remove', legacy]);
  }
  // Elimina la clave canónica para permitir reinstalación limpia
  await runCapture('claude', ['mcp', 'remove', CLAUDE_MCP_SERVER_NAME]);

  const local = resolveLocalPluginPaths();
  const addArgs = local
    ? ['mcp', 'add', CLAUDE_MCP_SERVER_NAME, 'node', local.claudePlugin]
    : ['mcp', 'add', CLAUDE_MCP_SERVER_NAME, 'npx', '-y', 'navora-claude-plugin'];

  const code = await runInteractive('claude', addArgs);
  const modeTag = local ? '(build local)' : '(npx)';

  if (code !== 0) {
    note(
      'El comando `claude` falló o no está en el PATH. Instalá manualmente:\n' +
        `  claude mcp add ${CLAUDE_MCP_SERVER_NAME} npx -y navora-claude-plugin`,
      'Claude Code'
    );
  } else {
    note(`MCP registrado en Claude Code ${modeTag}.`, 'Claude Code');
  }
}

async function uninstallClaudeMcp(): Promise<void> {
  // Elimina clave canónica y todas las claves legado conocidas
  const allKeys = [CLAUDE_MCP_SERVER_NAME, ...CLAUDE_LEGACY_KEYS];
  let removed = false;
  for (const key of allKeys) {
    const { code } = await runCapture('claude', ['mcp', 'remove', key]);
    if (code === 0) removed = true;
  }
  if (!removed) {
    note(
      'No se pudo eliminar. Comprobá que la CLI esté instalada o quitá la entrada a mano.',
      'Claude Code'
    );
  } else {
    note('Entrada(s) MCP eliminada(s) en Claude Code.', 'Claude Code');
  }
}

async function configureCursorMcp(): Promise<void> {
  // Limpia todas las claves conocidas antes de escribir la canónica
  removeCursorMcpServers([CURSOR_MCP_SERVER_KEY, ...CLAUDE_LEGACY_KEYS]);

  const local = resolveLocalPluginPaths();
  const entry = local
    ? { command: 'node', args: [local.cursorPlugin] }
    : { command: 'npx', args: ['-y', 'navora-cursor-plugin'] };

  const path = upsertCursorMcpServer(CURSOR_MCP_SERVER_KEY, entry);
  const modeTag = local ? '(build local)' : '(npx)';
  note(`Servidor MCP escrito en:\n${path} ${modeTag}`, 'Cursor MCP');
}

async function removeCursorMcp(): Promise<void> {
  const removed = removeCursorMcpServers([CURSOR_MCP_SERVER_KEY, 'navora-browser']);
  if (removed) {
    note('Entrada MCP eliminada de ~/.cursor/mcp.json.', 'Cursor MCP');
  } else {
    note('No había entrada Navora que eliminar en ~/.cursor/mcp.json.', 'Cursor MCP');
  }
}

async function installMissing(state: InstallerEnvState): Promise<void> {
  const needClaude = !state.claudeMcpInstalled;
  const needCursor = !state.cursorMcpInstalled;
  if (!needClaude && !needCursor) {
    note('No falta nada: Claude Code y Cursor ya están configurados.', 'Instalación');
    return;
  }
  if (needClaude) await installClaudeMcp();
  if (needCursor) await configureCursorMcp();
}

async function reinstallAll(): Promise<void> {
  await installClaudeMcp();
  await configureCursorMcp();
}

async function verifyInstallation(): Promise<void> {
  const local = resolveLocalPluginPaths();
  const daemonMode = local ? 'build local' : 'npx';

  const s = spinner();
  s.start(`Verificando daemon (${daemonMode}) y CDP…`);
  const daemonOk = await ensureDaemonForTest();
  const cdpPort = await findCdpPortReachable();
  s.stop('');

  const lines: string[] = [];
  if (daemonOk) {
    lines.push(`Daemon (:${getDaemonPort()}):          ✓ accesible`);
  } else {
    lines.push(`Daemon (:${getDaemonPort()}):          ✗ no responde`);
    try {
      const log = readFileSync(DAEMON_LOG_PATH, 'utf8').trim();
      if (log) {
        const tail = log.split('\n').slice(-5).join('\n');
        lines.push(`  Log (${DAEMON_LOG_PATH}):`);
        lines.push(...tail.split('\n').map((l) => `    ${l}`));
      }
    } catch {
      lines.push(`  Sin log disponible (${DAEMON_LOG_PATH})`);
    }
  }

  lines.push(
    `CDP (${CDP_CHECK_PORTS.join('/')}): ` +
      (cdpPort !== undefined ? `✓ respuesta en ${cdpPort}` : '✗ sin respuesta HTTP')
  );

  if (cdpPort === undefined) {
    lines.push('');
    lines.push('Arranque manual del browser con CDP:');
    lines.push('  • Windows: "…\\brave.exe" --remote-debugging-port=9222');
    lines.push('  • macOS: open -a "Brave Browser" --args --remote-debugging-port=9222');
    lines.push('  • Linux: brave-browser --remote-debugging-port=9222');
  }

  const ok = daemonOk && cdpPort !== undefined;
  note(lines.join('\n'), ok ? 'Verificación: OK' : 'Verificación: falló');

  // Pausa para que el usuario pueda leer el resultado antes de volver al menú
  await select({
    message: 'Continuar',
    options: [{ value: 'ok', label: 'Volver al menú' }],
  });
}

async function pluginSubmenu(): Promise<void> {
  for (;;) {
    process.stdout.write('\x1Bc');
    const state = await gatherEnvironmentState();
    const claudeTag = state.claudeMcpInstalled ? '[✓ instalado]' : '[✗ no instalado]';
    const cursorTag = state.cursorMcpInstalled ? '[✓ instalado]' : '[✗ no instalado]';

    const choice = await select({
      message: '¿Qué plugin?',
      options: [
        { value: 'claude', label: `Claude Code MCP  ${claudeTag}` },
        { value: 'cursor', label: `Cursor MCP       ${cursorTag}` },
        { value: 'back', label: 'Volver' },
      ],
    });

    if (isCancel(choice) || choice === 'back') return;

    if (choice === 'claude') {
      if (state.claudeMcpInstalled) {
        const act = await select({
          message: 'Claude Code MCP',
          options: [
            { value: 'reinstall', label: 'Reinstalar / actualizar' },
            { value: 'remove', label: 'Eliminar' },
            { value: 'cancel', label: 'Cancelar' },
          ],
        });
        if (isCancel(act) || act === 'cancel') continue;
        if (act === 'reinstall') await installClaudeMcp();
        if (act === 'remove') await uninstallClaudeMcp();
      } else {
        await installClaudeMcp();
      }
    }

    if (choice === 'cursor') {
      if (state.cursorMcpInstalled) {
        const act = await select({
          message: 'Cursor MCP',
          options: [
            { value: 'reinstall', label: 'Reinstalar / actualizar' },
            { value: 'remove', label: 'Eliminar' },
            { value: 'cancel', label: 'Cancelar' },
          ],
        });
        if (isCancel(act) || act === 'cancel') continue;
        if (act === 'reinstall') await configureCursorMcp();
        if (act === 'remove') await removeCursorMcp();
      } else {
        await configureCursorMcp();
      }
    }
  }
}

// ─── Daemon service management ───────────────────────────────────────────────

async function daemonServiceSubmenu(): Promise<void> {
  const local = resolveLocalPluginPaths();

  for (;;) {
    process.stdout.write('\x1Bc');
    const svc = getServiceStatus();

    if (svc.platform === 'unsupported') {
      note('Gestión de servicios no soportada en esta plataforma.', 'Daemon servicio');
      await select({ message: 'Continuar', options: [{ value: 'ok', label: 'Volver' }] });
      return;
    }

    const statusTag = svc.installed
      ? svc.running ? '[✓ corriendo]' : '[○ detenido]'
      : '[✗ no instalado]';

    const options: { value: string; label: string }[] = [];

    if (!svc.installed) {
      options.push({ value: 'install', label: 'Instalar como servicio del sistema' });
    } else {
      options.push({ value: 'reinstall', label: 'Reinstalar servicio' });
      options.push(svc.running
        ? { value: 'stop', label: 'Detener servicio' }
        : { value: 'start', label: 'Iniciar servicio' }
      );
      options.push({ value: 'uninstall', label: 'Desinstalar servicio' });
    }
    options.push({ value: 'back', label: 'Volver' });

    const choice = await select({
      message: `Daemon como servicio  ${statusTag}`,
      options,
    });

    if (isCancel(choice) || choice === 'back') return;

    const daemonPath = local?.daemon;
    if (!daemonPath && (choice === 'install' || choice === 'reinstall')) {
      note('No se encontró el daemon local.\nEjecutá: pnpm --filter navora-daemon build', 'Error');
      await pause();
      continue;
    }

    const logPath = DAEMON_LOG_PATH;
    const s = spinner();
    let resultMsg = '';
    let isError = false;

    try {
      if (choice === 'install' || choice === 'reinstall') {
        s.start('Registrando servicio…');
        if (svc.installed) uninstallService();
        installService(daemonPath!);
        s.stop('');
        s.start('Iniciando daemon…');
        startService(daemonPath!);
        // Give daemon 2s to write its lockfile
        await new Promise(r => setTimeout(r, 2000));
        s.stop('');
        const newSvc = getServiceStatus();
        resultMsg = [
          newSvc.running ? '✓ Daemon corriendo.' : '✗ Daemon no respondió en 2s.',
          `Log: ${logPath}`,
          '',
          svc.platform === 'windows'
            ? 'Auto-start: HKCU\\...\\Run → NavoraDaemon'
            : svc.platform === 'linux'
            ? 'Auto-start: systemctl --user enable navora-daemon'
            : 'Auto-start: ~/Library/LaunchAgents/com.navora.daemon.plist',
        ].join('\n');
      } else if (choice === 'start') {
        s.start('Iniciando daemon…');
        startService(daemonPath ?? undefined);
        await new Promise(r => setTimeout(r, 2000));
        s.stop('');
        const newSvc = getServiceStatus();
        resultMsg = newSvc.running
          ? `✓ Daemon corriendo.\nLog: ${logPath}`
          : `✗ Daemon no respondió.\nLog: ${logPath}`;
      } else if (choice === 'stop') {
        s.start('Deteniendo daemon…');
        stopService();
        s.stop('');
        resultMsg = 'Daemon detenido.';
      } else if (choice === 'uninstall') {
        s.start('Desinstalando servicio…');
        uninstallService();
        s.stop('');
        resultMsg = 'Servicio desinstalado.';
      }
    } catch (e) {
      s.stop('');
      isError = true;
      resultMsg = `${e instanceof Error ? e.message : String(e)}\n\nLog: ${logPath}\nCorré con --debug para ver los comandos.`;
    }

    note(resultMsg, isError ? 'Error' : 'Servicio');
    await pause();
  }
}

async function pause(): Promise<void> {
  await select({ message: 'Continuar', options: [{ value: 'ok', label: 'Volver al menú' }] });
}

// ─── Extension / Native Messaging setup ──────────────────────────────────────

async function extensionSubmenu(): Promise<void> {
  const local = resolveLocalPluginPaths();

  // 1. Check nm-shim-cli is built
  const shimCli = resolveShimCliPath();
  if (!shimCli) {
    const needBuild = local
      ? 'Ejecutá: pnpm --filter navora-daemon build'
      : 'El shim no está disponible en modo npm todavía.';
    note(`nm-shim-cli no encontrado.\n${needBuild}`, 'Extensión');
    await select({ message: 'Continuar', options: [{ value: 'ok', label: 'Volver' }] });
    return;
  }

  // 2. Check extension is built and show path
  const extDist = resolveExtensionDistPath();
  if (!extDist) {
    const needBuild = local
      ? 'Ejecutá: pnpm --filter @navora/extension build'
      : 'La extensión no está disponible.';
    note(`Extensión no buildeada.\n${needBuild}`, 'Extensión');
    await select({ message: 'Continuar', options: [{ value: 'ok', label: 'Volver' }] });
    return;
  }

  // 3. Detect compatible browsers
  const browsers = detectNmBrowsers();
  if (browsers.length === 0) {
    note(
      'No se detectó ningún browser compatible (Chrome, Brave, Edge, Chromium).',
      'Extensión'
    );
    await select({ message: 'Continuar', options: [{ value: 'ok', label: 'Volver' }] });
    return;
  }

  for (;;) {
    process.stdout.write('\x1Bc');

    // Show current NM status per browser
    const browserOptions = browsers.map((b) => {
      const registered = isNmHostRegistered(b);
      const extId = registered ? registeredExtensionId(b) : null;
      const tag = registered
        ? extId ? `[✓ ${extId.slice(0, 8)}…]` : '[✓ sin ID]'
        : '[✗ no registrado]';
      return { value: b.id, label: `${b.label}  ${tag}` };
    });

    const browserChoice = await select({
      message: '¿Para qué browser configurar la extensión?',
      options: [...browserOptions, { value: 'back', label: 'Volver' }],
    });

    if (isCancel(browserChoice) || browserChoice === 'back') return;

    const browser = browsers.find((b) => b.id === browserChoice)!;
    const alreadyRegistered = isNmHostRegistered(browser);

    const action = await select({
      message: `${browser.label} — ¿qué querés hacer?`,
      options: [
        { value: 'install', label: alreadyRegistered ? 'Reinstalar / actualizar' : 'Instalar NM host' },
        ...(alreadyRegistered ? [{ value: 'remove', label: 'Desinstalar NM host' }] : []),
        { value: 'cancel', label: 'Cancelar' },
      ],
    });

    if (isCancel(action) || action === 'cancel') continue;

    if (action === 'remove') {
      const ok = unregisterNmHost(browser);
      note(
        ok ? `NM host eliminado para ${browser.label}.` : `No había NM host registrado para ${browser.label}.`,
        'Extensión'
      );
      continue;
    }

    // ── Install flow ──────────────────────────────────────────────────────────

    // Step A: show extension load instructions
    note(
      [
        `Ruta de la extensión buildeada:`,
        `  ${extDist}`,
        ``,
        `Si aún no la cargaste en ${browser.label}:`,
        `  1. Abrí ${browser.extensionsUrl}`,
        `  2. Activá "Modo desarrollador"`,
        `  3. Clic en "Cargar desempaquetada"`,
        `  4. Seleccioná la ruta de arriba`,
        `  5. Copiá el ID de extensión que aparece (32 letras)`,
      ].join('\n'),
      'Cargar extensión'
    );

    // Step B: ask for extension ID
    const { text } = await import('@clack/prompts');
    const rawId = await text({
      message: 'Pegá el ID de la extensión (o Enter para omitir):',
      placeholder: 'abcdefghijklmnopabcdefghijklmnop',
      validate: (v) => {
        if (!v) return; // allow empty
        if (!/^[a-z]{32}$/.test(v)) return 'El ID debe tener 32 letras minúsculas';
      },
    });

    if (isCancel(rawId)) continue;
    const extensionId = rawId.trim() || null;

    // Step C: create shim wrapper + manifest + register
    const s = spinner();
    s.start(`Registrando NM host para ${browser.label}…`);
    try {
      const wrapperPath = createShimWrapper(shimCli);
      const manifest = buildManifest(wrapperPath, extensionId);
      const manifestPath = writeManifest(manifest);
      registerNmHost(browser, manifestPath);
      s.stop('');
      note(
        [
          `NM host registrado para ${browser.label}.`,
          `  Shim:     ${wrapperPath}`,
          `  Manifest: ${manifestPath}`,
          extensionId
            ? `  Extension ID: ${extensionId}`
            : `  ⚠ Sin extension ID — la extensión no podrá conectar hasta que lo agregues.`,
          ``,
          `Recargá la extensión en ${browser.extensionsUrl} → botón reload (no hace falta reiniciar el browser).`,
        ].join('\n'),
        extensionId ? 'Registrado ✓' : 'Registrado (incompleto)'
      );
    } catch (e) {
      s.stop('');
      note(
        `Error al registrar: ${e instanceof Error ? e.message : String(e)}`,
        'Error'
      );
    }
  }
}

async function main(): Promise<void> {
  intro('navora — instalador');

  let state: InstallerEnvState;
  let quit = false;
  while (!quit) {
    process.stdout.write('\x1Bc');
    const spin = spinner();
    spin.start('Detectando entorno…');
    state = await gatherEnvironmentState();
    spin.stop('Listo.');

    note(formatInstallerSummary(state), 'Estado actual');

    const action = await select({
      message: '¿Qué querés hacer?',
      options: [
        {
          value: 'install-missing',
          label: 'Instalar todo lo que falta',
          hint: 'solo componentes pendientes',
        },
        {
          value: 'reinstall-all',
          label: 'Reinstalar / actualizar todo',
          hint: 'Claude Code + Cursor',
        },
        {
          value: 'verify',
          label: 'Verificar instalación',
          hint: 'diagnóstico y test de conexión',
        },
        {
          value: 'service',
          label: 'Daemon como servicio del sistema',
          hint: 'inicio automático al iniciar sesión',
        },
        {
          value: 'extension',
          label: 'Configurar extensión del browser',
          hint: 'instala Native Messaging host',
        },
        {
          value: 'plugins',
          label: 'Gestionar plugins individuales',
        },
        { value: 'exit', label: 'Salir' },
      ],
    });

    if (isCancel(action)) {
      cancel('Salida.');
      process.exit(0);
    }

    switch (action) {
      case 'install-missing': {
        await installMissing(state);
        break;
      }
      case 'reinstall-all':
        await reinstallAll();
        break;
      case 'verify':
        await verifyInstallation();
        break;
      case 'service':
        await daemonServiceSubmenu();
        break;
      case 'extension':
        await extensionSubmenu();
        break;
      case 'plugins':
        await pluginSubmenu();
        break;
      case 'exit':
        quit = true;
        break;
      default:
        break;
    }
  }

  note(usageInstructions(), 'Uso');
  outro('Listo. Reiniciá el IDE si cambiaste la configuración MCP.');
}

export { main };
