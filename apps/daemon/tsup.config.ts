import { defineConfig } from 'tsup';

const sharedConfig = {
  format: ['esm'] as const,
  target: 'node18' as const,
  bundle: true,
  splitting: false,
  sourcemap: false,
  noExternal: [
    '@navora/browser-tools',
    '@navora/shared',
    '@navora/mcp',
    '@navora/protocol',
  ],
};

export default defineConfig([
  {
    ...sharedConfig,
    entry: { main: 'src/main.ts' },
    clean: true,
  },
  {
    ...sharedConfig,
    entry: { 'nm-shim-cli': 'src/nm-shim/cli.ts' },
    clean: false,
  },
]);
