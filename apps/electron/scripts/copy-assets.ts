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
// Copy all resources (icons, themes, docs, permissions, tool-icons, etc.)
cpSync('resources', 'dist/resources', { recursive: true });

console.log('✓ Copied resources/ → dist/resources/');

// Copy audio-player utility process (built separately by esbuild)
// This ensures the compiled audio-player.cjs is available in the packaged app.
import { existsSync as _existsSync, copyFileSync as _copyFileSync, mkdirSync as _mkdirSync } from 'fs';

const utilityDistDir = join('dist', 'utility');
if (!_existsSync(utilityDistDir)) {
  _mkdirSync(utilityDistDir, { recursive: true });
}
const audioPlayerSrc = join('dist', 'utility', 'audio-player.cjs');
if (_existsSync(audioPlayerSrc)) {
  console.log('✓ audio-player.cjs found in dist/utility/');
} else {
  console.log('⚠ audio-player.cjs not found in dist/utility/ — sound notifications will not work');
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
