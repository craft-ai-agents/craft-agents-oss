/**
 * Cross-platform asset copy script.
 *
 * Replaces the 4 platform-specific shell scripts (build:resources, build:resources:win,
 * build:assets, build:assets:win) with a single script using Node's fs.cpSync.
 *
 * Copies two categories of files into dist/:
 * 1. Electron-specific resources (icons, DMG backgrounds) → dist/resources/
 * 2. Bundled config assets (docs, tool-icons, themes, permissions, config-defaults) → dist/assets/
 *
 * The dist/assets/ directory is the canonical location for all bundled assets.
 * At Electron startup, setBundledAssetsRoot(__dirname) is called, and then
 * getBundledAssetsDir('docs') resolves to <__dirname>/assets/docs/, etc.
 *
 * Run: bun scripts/copy-assets.ts
 */

import { cpSync, mkdirSync, existsSync } from 'fs';

// ============================================================
// 1. Electron-specific resources (icons, DMG backgrounds, etc.)
// ============================================================
cpSync('resources', 'dist/resources', { recursive: true });

// ============================================================
// 2. Shared config assets → dist/assets/
//    These are resolved at runtime via getBundledAssetsDir(subfolder)
// ============================================================
mkdirSync('dist/assets', { recursive: true });

// Shared assets from packages/shared/assets/
const sharedAssetsRoot = '../../packages/shared/assets';
for (const dir of ['docs', 'tool-icons']) {
  const src = `${sharedAssetsRoot}/${dir}`;
  if (existsSync(src)) {
    cpSync(src, `dist/assets/${dir}`, { recursive: true });
  }
}

// Config assets from resources/ → also copy to dist/assets/
// (themes and permissions currently live under resources/ alongside Electron icons)
for (const dir of ['themes', 'permissions']) {
  const src = `resources/${dir}`;
  if (existsSync(src)) {
    cpSync(src, `dist/assets/${dir}`, { recursive: true });
  }
}

// Config defaults file (single JSON, not a directory)
if (existsSync('resources/config-defaults.json')) {
  cpSync('resources/config-defaults.json', 'dist/assets/config-defaults.json');
}

// Note: PDF.js worker is handled by Vite via ?url import in PDFPreviewOverlay.tsx
