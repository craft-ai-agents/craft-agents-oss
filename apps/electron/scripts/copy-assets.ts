/**
 * Cross-platform asset copy script.
 *
 * Copies the resources/ directory to dist/resources/.
 * All bundled assets (docs, themes, permissions, tool-icons) now live in resources/
 * which electron-builder handles natively via directories.buildResources.
 *
 * At Electron startup, setBundledAssetsRoot(__dirname) is called, and then
 * getBundledAssetsDir('docs') resolves to <__dirname>/resources/docs/, etc.
 *
 * Run: bun scripts/copy-assets.ts
 */

import { cpSync, copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Copy all resources (icons, themes, docs, permissions, tool-icons, etc.)
cpSync('resources', 'dist/resources', { recursive: true });

console.log('✓ Copied resources/ → dist/resources/');

// Copy Cursor HTTP/2 bridge script (used by the Cursor provider proxy
// to talk to api2.cursor.sh). It runs as a `node` subprocess, so it must
// stay as a plain .mjs file shipped to dist/resources/.
const cursorBridgeSrc = join('..', '..', 'packages', 'cursor-provider', 'src', 'h2-bridge.mjs');
const cursorBridgeDest = join('dist', 'resources', 'h2-bridge.mjs');
try {
  copyFileSync(cursorBridgeSrc, cursorBridgeDest);
  console.log('✓ Copied Cursor h2-bridge.mjs → dist/resources/');
} catch (err) {
  console.error('✗ Failed to copy Cursor h2-bridge.mjs:', err);
  process.exit(1);
}

// Copy PowerShell parser script (for Windows command validation in Explore mode)
// Source: packages/shared/src/agent/powershell-parser.ps1
// Destination: dist/resources/powershell-parser.ps1
const psParserSrc = join('..', '..', 'packages', 'shared', 'src', 'agent', 'powershell-parser.ps1');
const psParserDest = join('dist', 'resources', 'powershell-parser.ps1');
try {
  copyFileSync(psParserSrc, psParserDest);
  console.log('✓ Copied powershell-parser.ps1 → dist/resources/');
} catch (err) {
  // Only warn - PowerShell validation is optional on non-Windows platforms
  console.log('⚠ powershell-parser.ps1 copy skipped (not critical on non-Windows)');
}
