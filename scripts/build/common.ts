/**
 * Common build utilities shared across all platforms
 */

import { $ } from 'bun';
import { execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  cpSync,
  lstatSync,
  readdirSync,
} from 'fs';
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
export const BUN_VERSION = 'bun-v1.3.9';

/**
 * uv version to bundle with the app.
 * Update this when upgrading uv. Check latest at: https://github.com/astral-sh/uv/releases
 */
export const UV_VERSION = '0.10.6';

/**
 * Get platform key for resources/bin folder naming.
 */
export function getPlatformKey(platform: Platform, arch: Arch): string {
  return `${platform}-${arch}`;
}

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

  // Windows and Linux x64 use baseline build for broader CPU compatibility (no AVX2 requirement)
  if ((platform === 'win32' || platform === 'linux') && arch === 'x64') {
    return `bun-${bunPlatform}-x64-baseline`;
  }

  return `bun-${bunPlatform}-${bunArch}`;
}

/**
 * Get uv release artifact filename for a platform/arch combination.
 */
export function getUvDownloadName(platform: Platform, arch: Arch): string {
  if (platform === 'darwin' && arch === 'arm64') return 'uv-aarch64-apple-darwin.tar.gz';
  if (platform === 'darwin' && arch === 'x64') return 'uv-x86_64-apple-darwin.tar.gz';
  if (platform === 'linux' && arch === 'arm64') return 'uv-aarch64-unknown-linux-gnu.tar.gz';
  if (platform === 'linux' && arch === 'x64') return 'uv-x86_64-unknown-linux-gnu.tar.gz';
  if (platform === 'win32' && arch === 'arm64') return 'uv-aarch64-pc-windows-msvc.zip';
  if (platform === 'win32' && arch === 'x64') return 'uv-x86_64-pc-windows-msvc.zip';

  throw new Error(`Unsupported uv target: ${platform}-${arch}`);
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
 * Uses curl for downloads (more reliable in CI than fetch + Bun.write)
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

    // Download files using curl (more reliable in CI than fetch + Bun.write)
    const zipPath = join(tempDir, `${bunDownload}.zip`);
    const checksumPath = join(tempDir, 'SHASUMS256.txt');

    console.log(`  Downloading ${zipUrl}...`);
    await $`curl -fsSL --retry 3 --retry-delay 2 -o ${zipPath} ${zipUrl}`;
    console.log('  Download complete');

    console.log('  Downloading checksums...');
    await $`curl -fsSL --retry 3 --retry-delay 2 -o ${checksumPath} ${checksumUrl}`;

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
 * Find the first matching file recursively under a directory.
 */
function findFileRecursive(root: string, fileName: string): string | null {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const nested = findFileRecursive(fullPath, fileName);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Download and verify uv binary, then install it to resources/bin/<platform-arch>/uv(.exe).
 */
export async function downloadUv(config: BuildConfig): Promise<void> {
  const { platform, arch, electronDir } = config;
  const uvDownload = getUvDownloadName(platform, arch);
  const uvBinaryName = platform === 'win32' ? 'uv.exe' : 'uv';
  const platformKey = getPlatformKey(platform, arch);

  const targetDir = join(electronDir, 'resources', 'bin', platformKey);
  const targetPath = join(targetDir, uvBinaryName);

  // Skip when already provisioned
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
    await $`curl -fsSL --retry 3 --retry-delay 2 -o ${assetPath} ${assetUrl}`;

    console.log('  Downloading checksum...');
    await $`curl -fsSL --retry 3 --retry-delay 2 -o ${checksumPath} ${checksumUrl}`;

    console.log('  Verifying checksum...');
    const checksumContent = await Bun.file(checksumPath).text();
    const hashMatch = checksumContent.match(/[a-fA-F0-9]{64}/);
    if (!hashMatch) {
      throw new Error(`Unable to parse checksum from ${checksumPath}`);
    }

    const isValid = await verifySha256(assetPath, hashMatch[0]);
    if (!isValid) {
      throw new Error('uv checksum verification failed');
    }
    console.log('  Checksum verified ✓');

    mkdirSync(extractDir, { recursive: true });

    if (uvDownload.endsWith('.zip')) {
      // Use PowerShell on Windows for consistent extraction support.
      await $`powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '${assetPath}' -DestinationPath '${extractDir}' -Force"`;
    } else {
      await $`tar -xzf ${assetPath} -C ${extractDir}`;
    }

    const extractedUv = findFileRecursive(extractDir, uvBinaryName);
    if (!extractedUv) {
      throw new Error(`Unable to locate ${uvBinaryName} in extracted archive`);
    }

    copyFileSync(extractedUv, targetPath);
    if (platform !== 'win32') {
      await $`chmod +x ${targetPath}`.quiet();
    }

    console.log(`  uv installed to ${targetPath} ✓`);
  } finally {
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
 * On Windows, uses hoisted linker to avoid .bun symlink directory
 */
export async function installDependencies(config: BuildConfig): Promise<void> {
  const { rootDir, platform } = config;

  if (platform === 'win32') {
    // Use hoisted linker on Windows - Bun's default isolated mode creates
    // node_modules/.bun/ with symlinks that esbuild can't traverse on Windows
    // ("Access is denied" errors with junction points)
    // Hoisted mode creates flat npm-style node_modules without .bun
    console.log('Installing dependencies (Windows hoisted mode)...');
    await $`cd ${rootDir} && bun install --linker=hoisted`.quiet();
  } else {
    console.log('Installing dependencies...');
    await $`cd ${rootDir} && bun install`.quiet();
  }
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
  // Remove existing symlink/directory if present (bun uses symlinks)
  if (existsSync(sdkDest)) {
    rmSync(sdkDest, { recursive: true, force: true });
  }
  // Use dereference to follow symlinks and copy actual files (bun uses symlinked node_modules)
  cpSync(sdkSource, sdkDest, { recursive: true, dereference: true });
}

/**
 * Verify SDK was copied correctly (not as symlinks, with expected size)
 */
export function verifySDKCopy(config: BuildConfig): void {
  const { electronDir } = config;
  const cliPath = join(electronDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js');

  if (!existsSync(cliPath)) {
    throw new Error(`SDK verification failed: cli.js not found at ${cliPath}`);
  }

  const stats = lstatSync(cliPath);
  if (stats.isSymbolicLink()) {
    throw new Error('SDK verification failed: cli.js is a symlink (should be real file)');
  }

  const size = stats.size;
  if (size < 1_000_000) {
    // cli.js should be ~11MB
    throw new Error(`SDK verification failed: cli.js too small (${size} bytes, expected ~11MB)`);
  }

  console.log(`  SDK copy verified: cli.js is ${(size / 1024 / 1024).toFixed(1)} MB`);
}

/**
 * Copy network interceptor source files (Anthropic — runs under Bun via --preload)
 */
export function copyInterceptor(config: BuildConfig): void {
  const { rootDir, electronDir } = config;

  const sharedSrcDir = join('packages', 'shared', 'src');
  const sourceDir = join(rootDir, sharedSrcDir);
  const destDir = join(electronDir, sharedSrcDir);

  const interceptorSource = join(sourceDir, 'unified-network-interceptor.ts');
  if (!existsSync(interceptorSource)) {
    throw new Error(`Interceptor not found at ${interceptorSource}`);
  }

  console.log('Copying interceptor...');
  mkdirSync(destDir, { recursive: true });
  copyFileSync(interceptorSource, join(destDir, 'unified-network-interceptor.ts'));

  // Also copy shared infrastructure (imported by unified-network-interceptor.ts at runtime)
  const commonSource = join(sourceDir, 'interceptor-common.ts');
  if (existsSync(commonSource)) {
    copyFileSync(commonSource, join(destDir, 'interceptor-common.ts'));
  }

  // Copy request utilities (imported by unified-network-interceptor.ts)
  const requestUtilsSource = join(sourceDir, 'interceptor-request-utils.ts');
  if (existsSync(requestUtilsSource)) {
    copyFileSync(requestUtilsSource, join(destDir, 'interceptor-request-utils.ts'));
  }

  // Copy feature flags (imported by unified-network-interceptor.ts for fast mode / source templates)
  const featureFlagsSource = join(sourceDir, 'feature-flags.ts');
  if (existsSync(featureFlagsSource)) {
    copyFileSync(featureFlagsSource, join(destDir, 'feature-flags.ts'));
  }
}

/**
 * Verify the unified interceptor CJS bundle exists (runs under Node.js via --require)
 * Built by `bun run build:interceptor` into apps/electron/dist/
 */
export function copyInterceptorBundle(config: BuildConfig): void {
  const { electronDir } = config;

  const source = join(electronDir, 'dist', 'interceptor.cjs');
  if (!existsSync(source)) {
    console.warn('Warning: Interceptor bundle not found at', source, '— tool metadata will be unavailable for Pi sessions');
    return;
  }

  // Already in dist/ which is included in the packaged app — just verify it exists
  console.log('Interceptor bundle verified at:', source);
}

/**
 * Copy Session MCP Server to packaged app resources.
 * The session server provides session-scoped tools (SubmitPlan, config_validate, etc.) for agent sessions.
 */
export function copySessionServer(config: BuildConfig): void {
  const { rootDir, electronDir } = config;

  const sessionSource = join(rootDir, 'packages', 'session-mcp-server', 'dist', 'index.js');
  const sessionDest = join(electronDir, 'resources', 'session-mcp-server', 'index.js');

  if (!existsSync(sessionSource)) {
    console.warn(`Warning: Session server not found at ${sessionSource}. Session-scoped tools will not work.`);
    return;
  }

  console.log('Copying Session MCP Server...');
  mkdirSync(dirname(sessionDest), { recursive: true });
  copyFileSync(sessionSource, sessionDest);
}

/**
 * Map our Platform type to koffi's directory naming convention.
 * koffi uses: darwin_arm64, darwin_x64, linux_x64, win32_x64, etc.
 */
function koffiPlatformDir(platform: Platform, arch: Arch): string {
  return `${platform}_${arch}`;
}

/**
 * Copy Pi Agent Server to packaged app resources.
 *
 * The bun build uses --external koffi so the bare import resolves through
 * node_modules at runtime. We copy the koffi npm package next to index.js
 * with only the target platform's native binary (~4MB instead of ~80MB).
 */
export function copyPiAgentServer(config: BuildConfig): void {
  const { rootDir, electronDir, platform, arch } = config;

  const piSourceDir = join(rootDir, 'packages', 'pi-agent-server', 'dist');
  const piDestDir = join(electronDir, 'resources', 'pi-agent-server');

  if (!existsSync(join(piSourceDir, 'index.js'))) {
    console.warn(`Warning: Pi agent server not found at ${piSourceDir}/index.js. Pi SDK sessions will not work.`);
    return;
  }

  console.log('Copying Pi Agent Server...');
  mkdirSync(piDestDir, { recursive: true });

  // 1. Copy index.js
  copyFileSync(join(piSourceDir, 'index.js'), join(piDestDir, 'index.js'));

  // 2. Copy koffi npm package (external import, resolved via node_modules at runtime)
  const koffiSource = join(rootDir, 'node_modules', 'koffi');

  if (!existsSync(koffiSource)) {
    console.warn('  Warning: koffi not found in node_modules. Pi SDK sessions may not work.');
    return;
  }

  const koffiDest = join(piDestDir, 'node_modules', 'koffi');
  mkdirSync(koffiDest, { recursive: true });

  // Copy koffi JS files
  for (const entry of ['package.json', 'index.js', 'indirect.js', 'index.d.ts', 'lib']) {
    const src = join(koffiSource, entry);
    if (existsSync(src)) {
      cpSync(src, join(koffiDest, entry), { recursive: true });
    }
  }

  // Copy only the target platform's native binary
  const targetDir = koffiPlatformDir(platform, arch);
  const nativeSrc = join(koffiSource, 'build', 'koffi', targetDir);
  const nativeDest = join(koffiDest, 'build', 'koffi', targetDir);

  if (existsSync(nativeSrc)) {
    mkdirSync(nativeDest, { recursive: true });
    cpSync(nativeSrc, nativeDest, { recursive: true });
    const size = lstatSync(join(nativeSrc, readdirSync(nativeSrc)[0])).size;
    console.log(`  Copied index.js + koffi/${targetDir} (${(size / 1024 / 1024).toFixed(1)}MB)`);
  } else {
    console.warn(`  Warning: koffi native binary not found for ${targetDir}`);
    cpSync(join(koffiSource, 'build'), join(koffiDest, 'build'), { recursive: true });
    console.log('  Copied index.js + koffi (all platforms as fallback)');
  }
}

/**
 * Build MCP servers (session) and Pi agent server.
 * Shared across all platforms to avoid drift.
 */
export function buildMcpServers(config: BuildConfig): void {
  const { rootDir } = config;

  const sessionDir = join(rootDir, 'packages', 'session-mcp-server');
  const sessionOut = join(sessionDir, 'dist', 'index.js');
  const piDir = join(rootDir, 'packages', 'pi-agent-server');
  const piOut = join(piDir, 'dist', 'index.js');

  console.log('Building MCP servers...');

  mkdirSync(join(sessionDir, 'dist'), { recursive: true });

  execSync(
    `bun build ${join(sessionDir, 'src', 'index.ts')} --outfile ${sessionOut} --target node --format cjs`,
    { cwd: rootDir, stdio: 'inherit', shell: true }
  );

  if (!existsSync(sessionOut)) {
    throw new Error(`Session MCP server output not found at ${sessionOut}`);
  }

  // Pi agent server uses --target=bun --format=esm because its Pi SDK deps are ESM-only.
  // --target=node --format=cjs leaves ESM deps as external require() calls that fail at runtime.
  // koffi is marked external because it's a native N-API module — bun can't inline .node binaries
  // and inlining its JS breaks the native binary resolution paths.
  // Optional: skip if package directory is missing (e.g., not synced to OSS).
  if (existsSync(join(piDir, 'src'))) {
    mkdirSync(join(piDir, 'dist'), { recursive: true });
    execSync(
      `bun build ${join(piDir, 'src', 'index.ts')} --outdir ${join(piDir, 'dist')} --target bun --format esm --external koffi`,
      { cwd: rootDir, stdio: 'inherit', shell: true }
    );
    if (!existsSync(piOut)) {
      throw new Error(`Pi agent server output not found at ${piOut}`);
    }
  } else {
    console.warn('Warning: Pi agent server package not found. Pi SDK sessions will not work.');
  }
}

/**
 * Verify MCP helper servers and Pi agent server are present in packaged resources.
 */
export function verifyMcpServersExist(config: BuildConfig): void {
  const { electronDir } = config;

  const sessionPath = join(electronDir, 'resources', 'session-mcp-server', 'index.js');
  const piPath = join(electronDir, 'resources', 'pi-agent-server', 'index.js');

  if (!existsSync(sessionPath)) {
    throw new Error(`Session MCP server not found at ${sessionPath}`);
  }
  if (!existsSync(piPath)) {
    console.warn(`Warning: Pi agent server not found at ${piPath}. Pi SDK sessions will not work.`);
  }
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
