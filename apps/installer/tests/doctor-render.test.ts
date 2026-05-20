import { describe, expect, it } from 'vitest';
import { computeVerdict, renderVerdict } from '../src/doctor.js';
import type { InstallerEnvState } from '../src/probes.js';

function makeState(overrides: Partial<InstallerEnvState> = {}): InstallerEnvState {
  return {
    platform: 'linux',
    nodeVersion: 'v20.0.0',
    browsers: [{ label: 'Chrome', path: '/usr/bin/google-chrome' }],
    daemonReachable: true,
    daemonPort: 51520,
    cdpPort: 9222,
    claudeMcpInstalled: true,
    claudeMcpKey: 'navora',
    cursorMcpInstalled: true,
    cursorMcpKey: 'navora',
    installerMode: 'npm',
    currentBuildVersion: '0.3.0',
    daemonServiceInstalled: true,
    daemonServiceRunning: true,
    ...overrides,
  };
}

describe('renderVerdict', () => {
  it('healthy con warnings → output empieza con "Verdict: ✓ healthy"', () => {
    const state = makeState({ claudeMcpInstalled: false });
    const verdict = computeVerdict(state);
    const output = renderVerdict(verdict, state.daemonPort);
    expect(output.startsWith('Verdict: ✓ healthy')).toBe(true);
    expect(verdict.healthy).toBe(true);
  });

  it('unhealthy con daemon-unreachable → output empieza con "Verdict: ✗ unhealthy" y contiene el port', () => {
    const state = makeState({ daemonReachable: false });
    const verdict = computeVerdict(state);
    const output = renderVerdict(verdict, state.daemonPort);
    expect(output.startsWith('Verdict: ✗ unhealthy')).toBe(true);
    expect(output).toContain(String(state.daemonPort));
  });

  it('unhealthy incluye descripción del failure en el output', () => {
    const state = makeState({ daemonReachable: false });
    const verdict = computeVerdict(state);
    const output = renderVerdict(verdict, state.daemonPort);
    expect(output).toContain('✗');
    expect(output.toLowerCase()).toContain('daemon');
  });

  it('healthy sin warnings → solo la línea de veredicto positivo', () => {
    const state = makeState();
    const verdict = computeVerdict(state);
    const output = renderVerdict(verdict, state.daemonPort);
    expect(output.startsWith('Verdict: ✓ healthy')).toBe(true);
    expect(output).not.toContain('✗');
  });
});
