/**
 * Linux-specific build logic
 */

import { $ } from 'bun';
import { existsSync, renameSync, statSync } from 'fs';
import { join } from 'path';
import type { Arch, BuildConfig } from './common';

/**
 * Verify SDK native binary is bundled in the packaged Linux app.
 * Since SDK 0.2.113 the SDK ships a per-platform native binary instead of cli.js.
 */
export function verifyPackagedSDK(unpackedPath: string, _arch: Arch): void {
  const appPath = join(unpackedPath, 'resources', 'app');
  const binaryPath = join(
    appPath,
    'node_modules', '@anthropic-ai', 'claude-agent-sdk-binary', 'claude',
  );

  if (!existsSync(binaryPath)) {
    throw new Error(`CRITICAL: SDK native binary not bundled! Expected at: ${binaryPath}`);
  }

  const stats = statSync(binaryPath);
  if (stats.size < 50_000_000) {
    throw new Error(`CRITICAL: SDK native binary too small (${stats.size} bytes, expected ~210 MB)`);
  }

  console.log(`  SDK bundled: claude binary is ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
}

/**
 * Package the Linux app with electron-builder
 */
export async function packageLinux(config: BuildConfig): Promise<string> {
  const { arch, electronDir } = config;

  console.log('Packaging app with electron-builder...');

  // Run electron-builder
  await $`cd ${electronDir} && npx electron-builder --linux --${arch}`;

  // Verify SDK is bundled in the unpacked app before checking artifacts
  const unpackedPath = join(electronDir, 'release', 'linux-unpacked');
  if (existsSync(unpackedPath)) {
    console.log('Verifying SDK in packaged app...');
    verifyPackagedSDK(unpackedPath, arch);
  } else {
    console.warn('  linux-unpacked not found, skipping SDK verification');
  }

  // electron-builder uses different arch names: x86_64 for x64, aarch64 for arm64
  const linuxArch = arch === 'x64' ? 'x86_64' : 'aarch64';
  const builtName = `Craft-Agents-${linuxArch}.AppImage`;
  const builtPath = join(electronDir, 'release', builtName);

  if (!existsSync(builtPath)) {
    console.error('Contents of release directory:');
    await $`ls -la ${join(electronDir, 'release')}`;
    throw new Error(`Expected AppImage not found at ${builtPath}`);
  }

  // Rename to our standard naming convention
  const finalName = `Craft-Agents-${arch}.AppImage`;
  const finalPath = join(electronDir, 'release', finalName);

  if (builtPath !== finalPath) {
    renameSync(builtPath, finalPath);
    console.log(`  Renamed ${builtName} -> ${finalName}`);
  }

  // Get file size
  const file = Bun.file(finalPath);
  const sizeMB = ((await file.size) / 1024 / 1024).toFixed(2);

  console.log(`\n=== Build Complete ===`);
  console.log(`AppImage: ${finalPath}`);
  console.log(`Size: ${sizeMB} MB`);

  return finalPath;
}
