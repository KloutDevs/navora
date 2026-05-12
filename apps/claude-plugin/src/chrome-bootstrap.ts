import { resolveReachableCdpPort, getCdpProbePorts } from './chrome-launcher.js';

// Only verify Chrome is reachable — never auto-launch.
// The daemon manages its own CDP connection; the plugin just checks.
export async function ensureChrome(): Promise<void> {
  try {
    const port = await resolveReachableCdpPort();
    if (port !== undefined) {
      process.env['NAVORA_CDP_PORT'] = String(port);
      return;
    }
    process.stderr.write(
      `[ai-browser] Warning: no hay CDP en los puertos ${getCdpProbePorts().join(', ')}.\n`
    );
    process.stderr.write('[ai-browser] Abrí Chrome/Brave con --remote-debugging-port=9222\n');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[ai-browser] Warning: ${msg}\n`);
  }
}
