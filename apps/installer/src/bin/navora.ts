#!/usr/bin/env node
/**
 * Shim de entrada para el CLI navora.
 *
 * Usa ÚNICAMENTE node: built-ins y dynamic import() para evitar que el
 * empaquetador arrastre TUI/clack al tiempo de arranque del comando doctor.
 *
 * Dispatch:
 *   navora doctor          → dynamic import de ../doctor.js
 *   navora --version | -v  → imprime versión y sale con 0
 *   navora --help | -h     → imprime uso y sale con 0
 *   navora (sin args)      → dynamic import de ../index.js  (activa el TUI)
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = require(pkgPath) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const USAGE = `\
navora — Navora AI Browser Runtime installer

Usage:
  navora              Launch interactive TUI installer
  navora doctor       Run health check (exit 0 = healthy, 1 = unhealthy)
  navora --version    Print version
  navora --help       Show this help
`;

async function main(): Promise<void> {
  const [, , cmd] = process.argv;

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
    const code = await runDoctor();
    process.exit(code);
  }

  // Sin args o cualquier otro subcomando → activar TUI
  await import('../index.js');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
