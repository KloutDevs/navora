/**
 * Build extra files (background and content scripts) using esbuild
 */

import * as esbuild from 'esbuild';
import { copyFileSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, 'dist/chrome-mv3');
const srcDir = resolve(__dirname, 'src');

// Build background script
await esbuild.build({
  entryPoints: [resolve(srcDir, 'background/index.ts')],
  bundle: true,
  outfile: resolve(distDir, 'background.js'),
  format: 'esm',
  platform: 'browser',
  target: 'chrome110',
  minify: false,
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});

console.log('Built background.js');

// Build content script
await esbuild.build({
  entryPoints: [resolve(srcDir, 'content/index.ts')],
  bundle: true,
  outfile: resolve(distDir, 'content.js'),
  format: 'iife',
  platform: 'browser',
  target: 'chrome110',
  minify: false,
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});

console.log('Built content.js');

// Copy CSS
const cssContent = readFileSync(resolve(srcDir, 'content/styles.css'), 'utf-8');
writeFileSync(resolve(distDir, 'content.css'), cssContent);
console.log('Copied content.css');

console.log('All extra files built successfully');