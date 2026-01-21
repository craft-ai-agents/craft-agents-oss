/**
 * Common build utilities shared across all platforms
 */

import { $ } from 'bun';
import { existsSync, mkdirSync, rmSync, copyFileSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

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

/**
 * Bun version to bundle with the app.
 * Update this when upgrading Bun. Check latest at: https://github.com/oven-sh/bun/releases
 * This should match or be close to the version used in CI (setup-bun action).
 */
export const BUN_VERSION = 'bun-v1.3.5';

/**
 * Get the Bun download filename for a platform/arch combination
 */
export function getBunDownloadName(platform: Platform, arch: Arch): string {
  const archMap: Record<Arch, string> = {
    x64: 'x64',
    arm64: 'aarch64',
  };

  const platformMap: Record<Platform, string> = {
    darwin: 'darwin',
    win32: 'windows',
    linux: 'linux',
  };

  const bunArch = archMap[arch];
  const bunPlatform = platformMap[platform];

  // Windows uses baseline build for broader CPU compatibility
  if (platform === 'win32') {
    return `bun-${bunPlatform}-x64-baseline`;
  }

  return `bun-${bunPlatform}-${bunArch}`;
}

/**
 * Verify SHA256 checksum of a file
 */
export async function verifySha256(filePath: string, expectedHash: string): Promise<boolean> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  const hash = createHash('sha256').update(Buffer.from(buffer)).digest('hex');
  return hash.toLowerCase() === expectedHash.toLowerCase();
}

/**
 * Download and verify Bun binary
 */
export async function downloadBun(config: BuildConfig): Promise<void> {
  const { platform, arch, electronDir } = config;
  const bunDownload = getBunDownloadName(platform, arch);
  const vendorDir = join(electronDir, 'vendor', 'bun');

  console.log(`Downloading Bun ${BUN_VERSION} for ${platform}-${arch}...`);

  // Create vendor directory
  mkdirSync(vendorDir, { recursive: true });

  // Create temp directory
  const tempDir = join(electronDir, '.bun-download-temp');
  mkdirSync(tempDir, { recursive: true });

  try {
    const zipUrl = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/${bunDownload}.zip`;
    const checksumUrl = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/SHASUMS256.txt`;

    // Download files
    const zipPath = join(tempDir, `${bunDownload}.zip`);
    const checksumPath = join(tempDir, 'SHASUMS256.txt');

    console.log(`  Downloading ${zipUrl}...`);
    const zipResponse = await fetch(zipUrl);
    if (!zipResponse.ok) throw new Error(`Failed to download Bun: ${zipResponse.statusText}`);
    await Bun.write(zipPath, zipResponse);

    const checksumResponse = await fetch(checksumUrl);
    if (!checksumResponse.ok) throw new Error(`Failed to download checksums: ${checksumResponse.statusText}`);
    await Bun.write(checksumPath, checksumResponse);

    // Verify checksum
    console.log('  Verifying checksum...');
    const checksumContent = await Bun.file(checksumPath).text();
    const expectedHash = checksumContent
      .split('\n')
      .find((line) => line.includes(`${bunDownload}.zip`))
      ?.split(' ')[0];

    if (!expectedHash) {
      throw new Error(`Checksum not found for ${bunDownload}.zip`);
    }

    const isValid = await verifySha256(zipPath, expectedHash);
    if (!isValid) {
      throw new Error('Checksum verification failed!');
    }
    console.log('  Checksum verified ✓');

    // Extract
    console.log('  Extracting...');
    await $`unzip -o ${zipPath} -d ${tempDir}`.quiet();

    // Copy binary
    const bunBinary = platform === 'win32' ? 'bun.exe' : 'bun';
    const sourcePath = join(tempDir, bunDownload, bunBinary);
    const destPath = join(vendorDir, bunBinary);

    copyFileSync(sourcePath, destPath);

    // Make executable on Unix
    if (platform !== 'win32') {
      await $`chmod +x ${destPath}`.quiet();
    }

    console.log(`  Bun installed to ${destPath} ✓`);
  } finally {
    // Cleanup temp directory
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Clean previous build artifacts
 */
export function cleanBuildArtifacts(config: BuildConfig): void {
  const { electronDir } = config;

  console.log('Cleaning previous builds...');

  const foldersToClean = [
    join(electronDir, 'vendor'),
    join(electronDir, 'node_modules', '@anthropic-ai'),
    join(electronDir, 'packages'),
    join(electronDir, 'release'),
  ];

  for (const folder of foldersToClean) {
    if (existsSync(folder)) {
      rmSync(folder, { recursive: true, force: true });
    }
  }
}

/**
 * Install dependencies
 */
export async function installDependencies(config: BuildConfig): Promise<void> {
  console.log('Installing dependencies...');
  await $`cd ${config.rootDir} && bun install`.quiet();
}

/**
 * Copy SDK from root node_modules
 */
export function copySDK(config: BuildConfig): void {
  const { rootDir, electronDir } = config;

  const sdkSource = join(rootDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
  const sdkDest = join(electronDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');

  if (!existsSync(sdkSource)) {
    throw new Error(`SDK not found at ${sdkSource}. Run 'bun install' first.`);
  }

  console.log('Copying SDK...');
  mkdirSync(dirname(sdkDest), { recursive: true });
  cpSync(sdkSource, sdkDest, { recursive: true });
}

/**
 * Copy network interceptor
 */
export function copyInterceptor(config: BuildConfig): void {
  const { rootDir, electronDir } = config;

  const interceptorSource = join(rootDir, 'packages', 'shared', 'src', 'network-interceptor.ts');
  const interceptorDest = join(electronDir, 'packages', 'shared', 'src', 'network-interceptor.ts');

  if (!existsSync(interceptorSource)) {
    throw new Error(`Interceptor not found at ${interceptorSource}`);
  }

  console.log('Copying interceptor...');
  mkdirSync(dirname(interceptorDest), { recursive: true });
  copyFileSync(interceptorSource, interceptorDest);
}

/**
 * Build the Electron app (main, preload, renderer)
 */
export async function buildElectronApp(config: BuildConfig): Promise<void> {
  const { rootDir } = config;

  console.log('Building Electron app...');
  await $`cd ${rootDir} && bun run electron:build`;
}

/**
 * Create manifest.json for upload
 */
export async function createManifest(config: BuildConfig): Promise<string> {
  const { rootDir, electronDir } = config;

  const packageJson = await Bun.file(join(electronDir, 'package.json')).json();
  const version = packageJson.version;

  const uploadDir = join(rootDir, '.build', 'upload');
  mkdirSync(uploadDir, { recursive: true });

  const manifestPath = join(uploadDir, 'manifest.json');
  await Bun.write(manifestPath, JSON.stringify({ version }, null, 2));

  console.log(`Created manifest.json (version: ${version})`);
  return version;
}

/**
 * Upload to S3
 */
export async function uploadToS3(config: BuildConfig): Promise<void> {
  const { rootDir, upload, uploadLatest, uploadScript } = config;

  if (!upload) return;

  // Check for required env vars
  const required = [
    'S3_VERSIONS_BUCKET_ENDPOINT',
    'S3_VERSIONS_BUCKET_ACCESS_KEY_ID',
    'S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing S3 credentials: ${missing.join(', ')}`);
  }

  console.log('\n=== Uploading to S3 ===');

  const flags = ['--electron'];
  if (uploadLatest) flags.push('--latest');
  if (uploadScript) flags.push('--script');

  await $`cd ${rootDir} && bun run scripts/upload.ts ${flags}`;

  console.log('Upload complete ✓');
}

/**
 * Load environment variables from .env file
 */
export async function loadEnvFile(config: BuildConfig): Promise<void> {
  const envPath = join(config.rootDir, '.env');

  if (existsSync(envPath)) {
    const content = await Bun.file(envPath).text();
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          process.env[key] = value;
        }
      }
    }
  }
}

/**
 * Get output artifact name for a platform/arch
 */
export function getArtifactName(platform: Platform, arch: Arch): string {
  switch (platform) {
    case 'darwin':
      return `Craft-Agent-${arch}.dmg`;
    case 'win32':
      return `Craft-Agent-${arch}.exe`;
    case 'linux':
      return `Craft-Agent-${arch}.AppImage`;
  }
}
