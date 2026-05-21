import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const pkg = require(pkgPath) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

if (!process.env['NAVORA_DEBUG'] && process.argv.includes('--debug')) {
  process.env['NAVORA_DEBUG'] = '1';
}

const USAGE = `\
navora — Navora Browser Runtime

Usage:
  navora                          Wizard de configuración paso a paso
  navora status                   Muestra el estado actual (exit 0 = todo OK)
  navora doctor                   Diagnóstico de conexión
  navora daemon install           Instala el daemon como servicio del sistema
  navora daemon start             Inicia el daemon
  navora daemon stop              Detiene el daemon
  navora daemon uninstall         Desinstala el servicio del daemon
  navora --version                Imprime la versión
  navora --help                   Muestra esta ayuda
`;

async function main(): Promise<void> {
  const [, , cmd, subcmd] = process.argv;

  if (cmd === '--version' || cmd === '-v') {
    console.log(readVersion());
    process.exit(0);
  }

  if (cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  if (cmd === 'doctor') {
    const { runDoctor } = await import('../doctor.js');
    process.exit(await runDoctor());
  }

  if (cmd === 'status') {
    const { runStatus } = await import('../wizard.js');
    process.exit(await runStatus());
  }

  if (cmd === 'daemon') {
    const { runDaemonCmd } = await import('../wizard.js');
    process.exit(await runDaemonCmd(subcmd ?? ''));
  }

  // Sin args o comando desconocido → wizard interactivo
  const { runWizard } = await import('../wizard.js');
  await runWizard();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
