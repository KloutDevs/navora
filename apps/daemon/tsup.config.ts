import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { main: 'src/main.ts' },
    format: ['esm'],
    target: 'node18',
    bundle: true,
    splitting: false,
    sourcemap: false,
    clean: true,
    // Bundle all @navora/* workspace packages so the published binary is self-contained.
    // ws and better-sqlite3 stay external (native/large; listed as real deps in package.json).
    noExternal: [
      '@navora/browser-tools',
      '@navora/shared',
      '@navora/mcp',
      '@navora/protocol',
    ],
  },
]);
