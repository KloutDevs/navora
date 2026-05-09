import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [
    '@ai-browser-runtime/browser-tools',
    '@ai-browser-runtime/shared',
  ],
});
