/**
 * Codex Binary Resolver
 *
 * Resolves the path to the Codex binary at runtime.
 * Supports bundled binaries in packaged apps and development overrides.
 *
 * Resolution order:
 * 1. CODEX_PATH environment variable (explicit override for production binary)
 * 2. Bundled binary in app resources (vendor/codex/{platform}-{arch}/codex)
 * 3. Local dev fork (checks multiple locations):
 *    - CODEX_DEV_PATH env var (explicit dev override)
 *    - ~/Documents/GitHub/craft-agents-codex/... (macOS default)
 *    - ~/code/craft-agents-codex/... (Linux common)
 *    - ~/projects/craft-agents-codex/... (Linux common)
 *    - ~/src/craft-agents-codex/... (Linux common)
 * 4. System 'codex' command in PATH (fallback)
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir, platform, arch } from 'os';

/**
 * Module-level root directory for bundled vendor binaries.
 * Set once at Electron startup via setVendorRoot(__dirname).
 */
let _vendorRoot: string | undefined;

/**
 * Register the Electron main process directory as the root for vendor binaries.
 * Call this once at app startup: setVendorRoot(__dirname)
 *
 * After this, resolveCodexBinary() will look for vendor/codex/{platform}-{arch}/codex
 * relative to this root in packaged apps.
 */
export function setVendorRoot(dir: string): void {
  _vendorRoot = dir;
}

/**
 * Get the vendor root directory (for testing/debugging).
 */
export function getVendorRoot(): string | undefined {
  return _vendorRoot;
}

/**
 * Get the platform-arch identifier used for bundled binaries.
 * Maps Node.js platform/arch to our naming convention.
 */
function getPlatformArch(): string {
  const p = platform();
  const a = arch();

  // Map platform
  let platformName: string;
  switch (p) {
    case 'darwin':
      platformName = 'darwin';
      break;
    case 'win32':
      platformName = 'win32';
      break;
    case 'linux':
      platformName = 'linux';
      break;
    default:
      platformName = p;
  }

  // Map arch
  let archName: string;
  switch (a) {
    case 'arm64':
      archName = 'arm64';
      break;
    case 'x64':
      archName = 'x64';
      break;
    default:
      archName = a;
  }

  return `${platformName}-${archName}`;
}

/**
 * Get the Codex binary filename for the current platform.
 */
function getCodexBinaryName(): string {
  return platform() === 'win32' ? 'codex.exe' : 'codex';
}

/**
 * Resolve the path to the Codex binary.
 *
 * Resolution order:
 * 1. CODEX_PATH environment variable (explicit override)
 * 2. Bundled binary in app vendor directory
 * 3. Local dev fork (for development)
 * 4. System 'codex' command (fallback)
 *
 * @returns Object with path and source information
 */
export function resolveCodexBinary(): { path: string; source: string } {
  const binaryName = getCodexBinaryName();

  // 1. Check CODEX_PATH environment variable (explicit override)
  const envPath = process.env.CODEX_PATH;
  if (envPath) {
    if (existsSync(envPath)) {
      return { path: envPath, source: 'CODEX_PATH environment variable' };
    }
    // If CODEX_PATH is set but doesn't exist, warn but continue
    console.warn(`CODEX_PATH set to ${envPath} but file does not exist, falling back to other sources`);
  }

  // 2. Check bundled binary in app vendor directory (packaged app)
  // In packaged Electron apps, __dirname is resources/app/dist/ (where main.cjs lives)
  // but vendor/ is at resources/app/vendor/ (one level up from dist/).
  // Try both the direct path and the parent directory.
  if (_vendorRoot) {
    const platformArch = getPlatformArch();
    const candidates = [
      join(_vendorRoot, 'vendor', 'codex', platformArch, binaryName),
      join(_vendorRoot, '..', 'vendor', 'codex', platformArch, binaryName),
    ];
    for (const bundledPath of candidates) {
      if (existsSync(bundledPath)) {
        return { path: bundledPath, source: 'bundled binary' };
      }
    }
  }

  // 3. Check local dev fork (development mode)
  // Check CODEX_DEV_PATH env var first, then common dev locations
  const home = homedir();
  const devPaths = [
    process.env.CODEX_DEV_PATH, // Explicit override
    join(home, 'Documents', 'GitHub', 'craft-agents-codex', 'codex-rs', 'target', 'release', binaryName), // macOS default
    join(home, 'code', 'craft-agents-codex', 'codex-rs', 'target', 'release', binaryName), // Linux common
    join(home, 'projects', 'craft-agents-codex', 'codex-rs', 'target', 'release', binaryName), // Linux common
    join(home, 'src', 'craft-agents-codex', 'codex-rs', 'target', 'release', binaryName), // Linux common
  ].filter(Boolean) as string[];

  for (const devPath of devPaths) {
    if (existsSync(devPath)) {
      return { path: devPath, source: 'local dev fork' };
    }
  }

  // 4. Fall back to system codex command
  return { path: 'codex', source: 'system PATH' };
}

/**
 * Get just the path to the Codex binary (convenience function).
 */
export function getCodexPath(): string {
  return resolveCodexBinary().path;
}
