import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  bundle: true,
  platform: 'node',
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
