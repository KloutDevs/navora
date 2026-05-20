import { describe, expect, it } from 'vitest';
import { computeVerdict } from '../src/doctor.js';
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

describe('computeVerdict', () => {
  it('todo ok → healthy sin failures ni warnings de daemon/CDP', () => {
    const verdict = computeVerdict(makeState());
    expect(verdict.healthy).toBe(true);
    expect(verdict.failures).toHaveLength(0);
  });

  it('daemonReachable false → failure, healthy false', () => {
    const verdict = computeVerdict(makeState({ daemonReachable: false }));
    expect(verdict.healthy).toBe(false);
    expect(verdict.failures.some((f) => f.key === 'daemon-unreachable')).toBe(true);
  });

  it('cdpPort undefined → failure, healthy false', () => {
    const verdict = computeVerdict(makeState({ cdpPort: undefined }));
    expect(verdict.healthy).toBe(false);
    expect(verdict.failures.some((f) => f.key === 'cdp-unreachable')).toBe(true);
  });

  it('claudeMcpInstalled false + daemon+CDP ok → warning only, sigue healthy', () => {
    const verdict = computeVerdict(makeState({ claudeMcpInstalled: false }));
    expect(verdict.healthy).toBe(true);
    expect(verdict.failures).toHaveLength(0);
    expect(verdict.warnings.some((w) => w.key === 'claude-mcp-missing')).toBe(true);
  });

  it('browsers vacío + daemon+CDP ok → warning only, sigue healthy', () => {
    const verdict = computeVerdict(makeState({ browsers: [] }));
    expect(verdict.healthy).toBe(true);
    expect(verdict.failures).toHaveLength(0);
    expect(verdict.warnings.some((w) => w.key === 'no-browsers')).toBe(true);
  });

  it('daemon unreachable Y cdp unreachable → dos failures', () => {
    const verdict = computeVerdict(makeState({ daemonReachable: false, cdpPort: undefined }));
    expect(verdict.healthy).toBe(false);
    expect(verdict.failures).toHaveLength(2);
  });
});
