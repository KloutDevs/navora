import { CDP_CHECK_PORTS } from './probes.js';
import type { InstallerEnvState } from './probes.js';

export function formatInstallerSummary(state: InstallerEnvState): string {
  const envLine = `Entorno: ${state.platform} | Node ${state.nodeVersion}`;

  let browsersLine: string;
  if (state.browsers.length === 0) {
    browsersLine = 'Browsers: ninguno encontrado en rutas conocidas';
  } else if (state.browsers.length === 1) {
    const b = state.browsers[0]!;
    browsersLine = `Browsers: ${b.label} — ${b.path}`;
  } else {
    const lines = state.browsers.map((b) => `  ${b.label} — ${b.path}`);
    browsersLine = `Browsers:\n${lines.join('\n')}`;
  }

  const cdpLine =
    state.cdpPort !== undefined
      ? `CDP: respuesta en el puerto ${state.cdpPort}`
      : `CDP: sin respuesta en ${CDP_CHECK_PORTS.join('/')}`;

  const daemonLine = state.daemonReachable
    ? `Daemon: accesible en :${state.daemonPort}`
    : `Daemon: no accesible en :${state.daemonPort}`;

  const version = state.currentBuildVersion ? ` v${state.currentBuildVersion}` : '';
  const modeLine = `Modo: ${state.installerMode === 'local' ? `build local${version}` : `npm${version}`}`;

  const svcLine = state.daemonServiceInstalled
    ? `Daemon servicio: ${state.daemonServiceRunning ? '✓ corriendo' : '○ detenido'}`
    : 'Daemon servicio: ✗ no instalado';

  const claudeKey = state.claudeMcpKey ? ` [${state.claudeMcpKey}]` : '';
  const claudeLine = state.claudeMcpInstalled
    ? `  Claude Code MCP: ✓ instalado${claudeKey}`
    : '  Claude Code MCP: ✗ no instalado';

  const cursorKey = state.cursorMcpKey ? ` [${state.cursorMcpKey}]` : '';
  const cursorLine = state.cursorMcpInstalled
    ? `  Cursor MCP:      ✓ configurado${cursorKey}`
    : '  Cursor MCP:      ✗ no configurado';

  return [
    envLine,
    modeLine,
    browsersLine,
    cdpLine,
    daemonLine,
    svcLine,
    '',
    'Plugins instalados:',
    claudeLine,
    cursorLine,
  ].join('\n');
}
