/**
 * Node.js-compatible subset of common.ts
 * Used by electron-dev-node.ts (tsx runner, no Bun dependency).
 * Only includes what electron-dev-node.ts actually needs.
 * Do NOT modify common.ts — this file is a standalone alternative.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export type Platform = 'darwin' | 'win32' | 'linux';
export type Arch = 'x64' | 'arm64';

export interface BuildConfig {
  platform: Platform;
  arch: Arch;
  upload: boolean;
  uploadLatest: boolean;
  uploadScript: boolean;
  rootDir: string;
  electronDir: string;
}

export const UV_VERSION = '0.10.6';
export const RTK_VERSION = '0.40.0';

export function getPlatformKey(platform: Platform, arch: Arch): string {
  return `${platform}-${arch}`;
}

export function getUvDownloadName(platform: Platform, arch: Arch): string {
  if (platform === 'darwin' && arch === 'arm64') return 'uv-aarch64-apple-darwin.tar.gz';
  if (platform === 'darwin' && arch === 'x64') return 'uv-x86_64-apple-darwin.tar.gz';
  if (platform === 'linux' && arch === 'arm64') return 'uv-aarch64-unknown-linux-gnu.tar.gz';
  if (platform === 'linux' && arch === 'x64') return 'uv-x86_64-unknown-linux-gnu.tar.gz';
  if (platform === 'win32' && arch === 'arm64') return 'uv-aarch64-pc-windows-msvc.zip';
  if (platform === 'win32' && arch === 'x64') return 'uv-x86_64-pc-windows-msvc.zip';
  throw new Error(`Unsupported uv target: ${platform}-${arch}`);
}

export function getRtkDownloadName(platform: Platform, arch: Arch): string {
  if (platform === 'darwin' && arch === 'arm64') return 'rtk-aarch64-apple-darwin.tar.gz';
  if (platform === 'darwin' && arch === 'x64') return 'rtk-x86_64-apple-darwin.tar.gz';
  if (platform === 'linux' && arch === 'arm64') return 'rtk-aarch64-unknown-linux-gnu.tar.gz';
  if (platform === 'linux' && arch === 'x64') return 'rtk-x86_64-unknown-linux-musl.tar.gz';
  if (platform === 'win32' && arch === 'x64') return 'rtk-x86_64-pc-windows-msvc.zip';
  if (platform === 'win32' && arch === 'arm64') return 'rtk-aarch64-pc-windows-msvc.zip';
  throw new Error(`Unsupported RTK target: ${platform}-${arch}`);
}

function verifySha256(filePath: string, expectedHash: string): boolean {
  const buffer = readFileSync(filePath);
  const hash = createHash('sha256').update(buffer).digest('hex');
  return hash.toLowerCase() === expectedHash.toLowerCase();
}

function findFileRecursive(root: string, fileName: string): string | null {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) return fullPath;
    if (entry.isDirectory()) {
      const nested = findFileRecursive(fullPath, fileName);
      if (nested) return nested;
    }
  }
  return null;
}

// Runs a command, throws on non-zero exit
function run(cmd: string, args: string[], opts: { quiet?: boolean; cwd?: string } = {}): void {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    stdio: opts.quiet ? 'pipe' : 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    const errMsg = opts.quiet && result.stderr ? result.stderr.toString() : '';
    throw new Error(`Command failed (${result.status}): ${cmd} ${args.join(' ')}${errMsg ? '\n' + errMsg : ''}`);
  }
}

export async function downloadUv(config: BuildConfig): Promise<void> {
  const { platform, arch, electronDir } = config;
  const uvDownload = getUvDownloadName(platform, arch);
  const uvBinaryName = platform === 'win32' ? 'uv.exe' : 'uv';
  const platformKey = getPlatformKey(platform, arch);

  const targetDir = join(electronDir, 'resources', 'bin', platformKey);
  const targetPath = join(targetDir, uvBinaryName);

  if (existsSync(targetPath)) {
    console.log(`uv already present at ${targetPath}`);
    return;
  }

  console.log(`Downloading uv ${UV_VERSION} for ${platformKey}...`);

  mkdirSync(targetDir, { recursive: true });
  const tempDir = join(electronDir, '.uv-download-temp');
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  try {
    const assetUrl = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${uvDownload}`;
    const checksumUrl = `${assetUrl}.sha256`;
    const assetPath = join(tempDir, uvDownload);
    const checksumPath = join(tempDir, `${uvDownload}.sha256`);
    const extractDir = join(tempDir, 'extract');

    console.log(`  Downloading ${assetUrl}...`);
    run('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', assetPath, assetUrl]);

    console.log('  Downloading checksum...');
    run('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', checksumPath, checksumUrl]);

    console.log('  Verifying checksum...');
    const checksumContent = readFileSync(checksumPath, 'utf-8');
    const hashMatch = checksumContent.match(/[a-fA-F0-9]{64}/);
    if (!hashMatch) throw new Error(`Unable to parse checksum from ${checksumPath}`);

    if (!verifySha256(assetPath, hashMatch[0])) {
      throw new Error('uv checksum verification failed');
    }
    console.log('  Checksum verified ✓');

    mkdirSync(extractDir, { recursive: true });

    if (uvDownload.endsWith('.zip')) {
      if (process.platform === 'win32') {
        run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
          `Expand-Archive -LiteralPath '${assetPath}' -DestinationPath '${extractDir}' -Force`]);
      } else {
        run('unzip', ['-o', assetPath, '-d', extractDir], { quiet: true });
      }
    } else {
      run('tar', ['-xzf', assetPath, '-C', extractDir]);
    }

    const extractedUv = findFileRecursive(extractDir, uvBinaryName);
    if (!extractedUv) throw new Error(`Unable to locate ${uvBinaryName} in extracted archive`);

    copyFileSync(extractedUv, targetPath);
    if (platform !== 'win32') {
      run('chmod', ['+x', targetPath], { quiet: true });
    }

    console.log(`  uv installed to ${targetPath} ✓`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function downloadRtk(config: BuildConfig): Promise<void> {
  const { platform, arch, electronDir } = config;
  const rtkDownload = getRtkDownloadName(platform, arch);
  const rtkBinaryName = platform === 'win32' ? 'rtk.exe' : 'rtk';
  const platformKey = getPlatformKey(platform, arch);

  const targetDir = join(electronDir, 'resources', 'bin', platformKey);
  const targetPath = join(targetDir, rtkBinaryName);

  if (existsSync(targetPath)) {
    console.log(`rtk already present at ${targetPath}`);
    return;
  }

  console.log(`Downloading RTK ${RTK_VERSION} for ${platformKey}...`);

  mkdirSync(targetDir, { recursive: true });
  const tempDir = join(electronDir, '.rtk-download-temp');
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  try {
    const assetUrl = `https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/${rtkDownload}`;
    const checksumUrl = `https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/checksums.txt`;
    const assetPath = join(tempDir, rtkDownload);
    const checksumPath = join(tempDir, 'checksums.txt');
    const extractDir = join(tempDir, 'extract');

    console.log(`  Downloading ${assetUrl}...`);
    run('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', assetPath, assetUrl]);

    console.log('  Downloading checksums...');
    run('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', checksumPath, checksumUrl]);

    console.log('  Verifying checksum...');
    const checksumContent = readFileSync(checksumPath, 'utf-8');
    const expectedHash = checksumContent
      .split('\n')
      .find((line) => line.includes(rtkDownload))
      ?.replace(/^sha256:/, '')
      .trim()
      .split(/\s+/)[0];

    if (!expectedHash) throw new Error(`Checksum not found for ${rtkDownload}`);
    if (!verifySha256(assetPath, expectedHash)) throw new Error('RTK checksum verification failed!');
    console.log('  Checksum verified ✓');

    mkdirSync(extractDir, { recursive: true });

    if (rtkDownload.endsWith('.zip')) {
      if (process.platform === 'win32') {
        run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
          `Expand-Archive -LiteralPath '${assetPath}' -DestinationPath '${extractDir}' -Force`]);
      } else {
        run('unzip', ['-o', assetPath, '-d', extractDir], { quiet: true });
      }
    } else {
      run('tar', ['-xzf', assetPath, '-C', extractDir]);
    }

    const extractedRtk = findFileRecursive(extractDir, rtkBinaryName);
    if (!extractedRtk) throw new Error(`Unable to locate ${rtkBinaryName} in extracted archive`);

    copyFileSync(extractedRtk, targetPath);
    if (platform !== 'win32') {
      run('chmod', ['+x', targetPath], { quiet: true });
    }

    console.log(`  RTK installed to ${targetPath} ✓`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
