import { platform, release } from 'node:os';
import process from 'node:process';

/** SO y Node (sin inspeccionar navegadores ni rutas de instalación). */
export function formatRuntimeSummary(): string {
  const osLine = `Sistema: ${platform()} (${release()})`;
  const nodeLine = `Node.js: ${process.version}`;
  return [osLine, nodeLine].join('\n');
}
