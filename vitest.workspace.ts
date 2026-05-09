import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: '../../vitest.config.ts',
    test: {
      name: 'protocol',
      include: ['packages/protocol/src/**/*.test.ts', 'packages/protocol/tests/**/*.test.ts']
    }
  },
  {
    extends: '../../vitest.config.ts',
    test: {
      name: 'shared',
      include: ['packages/shared/src/**/*.test.ts', 'packages/shared/tests/**/*.test.ts']
    }
  },
  {
    extends: '../../vitest.config.ts',
    test: {
      name: 'browser-tools',
      include: ['packages/browser-tools/src/**/*.test.ts', 'packages/browser-tools/tests/**/*.test.ts']
    }
  },
  {
    extends: '../../vitest.config.ts',
    test: {
      name: 'mcp',
      include: ['packages/mcp/src/**/*.test.ts', 'packages/mcp/tests/**/*.test.ts']
    }
  },
  {
    extends: '../../vitest.config.ts',
    test: {
      name: 'ui',
      include: ['packages/ui/src/**/*.test.ts', 'packages/ui/tests/**/*.test.ts']
    }
  },
  {
    extends: '../../vitest.config.ts',
    test: {
      name: 'daemon',
      include: ['apps/daemon/src/**/*.test.ts', 'apps/daemon/tests/**/*.test.ts']
    }
  },
  {
    extends: '../../vitest.config.ts',
    test: {
      name: 'extension',
      include: ['apps/extension/src/**/*.test.ts', 'apps/extension/tests/**/*.test.ts']
    }
  }
]);