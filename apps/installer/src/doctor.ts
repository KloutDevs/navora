import type { InstallerEnvState } from './probes.js';

export interface DoctorIssue {
  key: string;
  message: string;
}

export interface DoctorVerdict {
  healthy: boolean;
  failures: DoctorIssue[];
  warnings: DoctorIssue[];
}

/**
 * Computa el veredicto de salud del entorno Navora de forma pura,
 * sin side effects ni I/O.
 *
 * Regla de exit:
 *   - daemon unreachable  → failure (healthy = false)
 *   - CDP unreachable     → failure (healthy = false)
 *   - Claude/Cursor MCP no instalado, sin browsers, sin servicio → warnings (no afectan healthy)
 */
export function computeVerdict(state: InstallerEnvState): DoctorVerdict {
  const failures: DoctorIssue[] = [];
  const warnings: DoctorIssue[] = [];

  if (!state.daemonReachable) {
    failures.push({
      key: 'daemon-unreachable',
      message: `Daemon no responde en el puerto ${state.daemonPort}`,
    });
  }

  if (state.cdpPort === undefined) {
    warnings.push({
      key: 'cdp-not-detected',
      message: `Chrome no detectado en puertos CDP (${[9222, 9223, 9224].join(', ')}) — solo requerido para herramientas de desarrollador (cdp_evaluate, cdp_send_command, cdp_network_har)`,
    });
  }

  if (!state.claudeMcpInstalled) {
    warnings.push({
      key: 'claude-mcp-missing',
      message: 'Claude Code MCP no está instalado',
    });
  }

  if (!state.cursorMcpInstalled) {
    warnings.push({
      key: 'cursor-mcp-missing',
      message: 'Cursor MCP no está configurado',
    });
  }

  if (state.browsers.length === 0) {
    warnings.push({
      key: 'no-browsers',
      message: 'No se detectó ningún browser Chromium instalado',
    });
  }

  if (!state.daemonServiceInstalled) {
    warnings.push({
      key: 'no-service',
      message: 'El daemon no está registrado como servicio del sistema',
    });
  }

  return {
    healthy: failures.length === 0,
    failures,
    warnings,
  };
}

/**
 * Genera el texto legible del resultado del doctor.
 * El output siempre empieza con "Verdict: ✓ healthy" o "Verdict: ✗ unhealthy".
 */
export function renderVerdict(verdict: DoctorVerdict, daemonPort: number): string {
  const lines: string[] = [];

  if (verdict.healthy) {
    lines.push('Verdict: ✓ healthy');
  } else {
    lines.push(`Verdict: ✗ unhealthy (daemon port: ${daemonPort})`);
  }

  if (verdict.failures.length > 0) {
    lines.push('');
    lines.push('Failures:');
    for (const f of verdict.failures) {
      lines.push(`  ✗ ${f.message}`);
    }
  }

  if (verdict.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of verdict.warnings) {
      lines.push(`  ⚠ ${w.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * Reúne el estado del entorno, computa el veredicto y lo imprime.
 * Retorna 0 si el entorno está sano, 1 si hay algún failure.
 * No llama process.exit — la responsabilidad es del caller.
 */
export async function runDoctor(): Promise<0 | 1> {
  const { gatherEnvironmentState } = await import('./probes.js');
  const state = await gatherEnvironmentState();
  const verdict = computeVerdict(state);
  const output = renderVerdict(verdict, state.daemonPort);
  console.log(output);
  return verdict.healthy ? 0 : 1;
}
