import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '.turbo/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/tests/**',
        '**/vitest.config.ts',
        '**/vitest.workspace.ts'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80
      }
    },
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    reporters: ['default', 'verbose']
  }
});