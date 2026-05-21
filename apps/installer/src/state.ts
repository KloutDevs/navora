import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface NavoraState {
  version: '1';
  daemon?: {
    serviceInstalled: boolean;
    installedAt: string;
  };
  extension?: {
    browser: string;
    extensionId: string | null;
    nmRegistered: boolean;
    configuredAt: string;
  };
  mcp?: {
    claude?: { installed: boolean; key: string };
    cursor?: { installed: boolean };
  };
}

const STATE_DIR = join(homedir(), '.navora');
const STATE_FILE = join(STATE_DIR, 'state.json');

export function readState(): NavoraState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as NavoraState;
  } catch {
    return { version: '1' };
  }
}

export function writeState(patch: Partial<Omit<NavoraState, 'version'>>): void {
  const current = readState();
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ ...current, ...patch, version: '1' } as NavoraState, null, 2),
    'utf8'
  );
}
