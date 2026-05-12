import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      all: false,
      reporter: ['text', 'json', 'html'],
      include: [
        'packages/*/src/**/*.ts',
        'apps/daemon/src/**/*.ts',
        'apps/installer/src/**/*.ts',
        'apps/claude-plugin/src/**/*.ts',
      ],
      exclude: [
        'node_modules/',
        '**/dist/**',
        '.turbo/',
        '**/.wxt/**',
        'apps/extension/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/tests/**',
        '**/vitest.config.ts',
        '**/vitest.workspace.ts',
        '**/*.d.ts',
      ],
      // Objetivo de equipo (CLAUDE.md): 80% líneas/funciones/declaraciones, 70% ramas.
      // Piso anti-regresión en el merge actual; subir al acercarse al objetivo.
      thresholds: {
        lines: 63,
        statements: 63,
        functions: 72,
        branches: 70,
      },
      watermarks: {
        lines: [80, 95],
        functions: [80, 95],
        branches: [70, 85],
        statements: [80, 95],
      },
    },
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    reporters: ['default', 'verbose'],
  },
});
