import process from 'node:process';
import { c } from './colors.js';

const ART_ROWS: [string, string][] = [
  [c.p1, ' ███╗   ██╗ █████╗ ██╗   ██╗ ██████╗ ██████╗  █████╗ '],
  [c.p2, ' ████╗  ██║██╔══██╗██║   ██║██╔═══██╗██╔══██╗██╔══██╗'],
  [c.p3, ' ██╔██╗ ██║███████║██║   ██║██║   ██║██████╔╝███████║'],
  [c.p4, ' ██║╚██╗██║██╔══██║╚██╗ ██╔╝██║   ██║██╔══██╗██╔══██║'],
  [c.p5, ' ██║ ╚████║██║  ██║ ╚████╔╝ ╚██████╔╝██║  ██║██║  ██║'],
  [c.p6, ' ╚═╝  ╚═══╝╚═╝  ╚═╝  ╚═══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝'],
];

export function printBanner(version: string): void {
  process.stdout.write('\x1Bc');
  const art = ART_ROWS.map(([color, row]) => `${color}${row}${c.reset}`).join('\n');
  process.stdout.write('\n' + art + '\n\n');
  process.stdout.write(`  ${c.p6}v${version}${c.reset}\n`);
  process.stdout.write(`${c.p1}${'─'.repeat(53)}${c.reset}\n\n`);
}
