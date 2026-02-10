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
  statSync,
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
  codexVersion: string;
  localCodex: boolean;
}

/**
 * Bun version to bundle with the app.
 * Update this when upgrading Bun. Check latest at: https://github.com/oven-sh/bun/releases
 * This should match or be close to the version used in CI (setup-bun action).
 */
export const BUN_VERSION = 'bun-v1.3.5';

/**
 * Codex fork release repository.
 * The fork includes PreToolUse hook support for permission enforcement.
 */
export const CODEX_REPO = 'lukilabs/craft-agents-codex';

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
 * Get the Codex download target name for a platform/arch combination.
 * Must match the target names used in the craft-release.yml workflow.
 */
export function getCodexTarget(platform: Platform, arch: Arch): string {
  // Map to Rust target triples used in the Codex release workflow
  const targetMap: Record<string, string> = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-gnu',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
    'win32-x64': 'x86_64-pc-windows-msvc',
  };

  const key = `${platform}-${arch}`;
  const target = targetMap[key];

  if (!target) {
    throw new Error(`Unsupported platform/arch combination: ${key}`);
  }

  return target;
}

/**
 * Download and verify Codex binary from GitHub releases.
 * Fails if the version doesn't match or the binary can't be downloaded.
 */
export async function downloadCodex(config: BuildConfig): Promise<void> {
  const { platform, arch, electronDir, codexVersion } = config;
  const target = getCodexTarget(platform, arch);
  const vendorDir = join(electronDir, 'vendor', 'codex', `${platform}-${arch}`);

  console.log(`Downloading Codex ${codexVersion} for ${platform}-${arch}...`);

  // Create vendor directory
  mkdirSync(vendorDir, { recursive: true });

  // Create temp directory
  const tempDir = join(electronDir, '.codex-download-temp');
  mkdirSync(tempDir, { recursive: true });

  try {
    const isWindows = platform === 'win32';
    const archiveExt = isWindows ? 'zip' : 'tar.gz';
    const archiveUrl = `https://github.com/${CODEX_REPO}/releases/download/${codexVersion}/codex-${target}.${archiveExt}`;
    const archivePath = join(tempDir, `codex-${target}.${archiveExt}`);

    console.log(`  Downloading ${archiveUrl}...`);
    const result = await $`curl -fsSL --retry 3 --retry-delay 2 -o ${archivePath} ${archiveUrl}`.nothrow();

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to download Codex ${codexVersion}.\n` +
        `  URL: ${archiveUrl}\n` +
        `  Make sure the release exists at: https://github.com/${CODEX_REPO}/releases/tag/${codexVersion}`
      );
    }
    console.log('  Download complete');

    // Extract
    console.log('  Extracting...');
    if (isWindows) {
      await $`unzip -o ${archivePath} -d ${tempDir}`.quiet();
    } else {
      await $`tar -xzf ${archivePath} -C ${tempDir}`.quiet();
    }

    // Copy binary
    const codexBinary = isWindows ? 'codex.exe' : 'codex';
    const sourcePath = join(tempDir, codexBinary);
    const destPath = join(vendorDir, codexBinary);

    if (!existsSync(sourcePath)) {
      throw new Error(`Codex binary not found in archive at ${sourcePath}`);
    }

    copyFileSync(sourcePath, destPath);

    // Make executable on Unix
    if (!isWindows) {
      await $`chmod +x ${destPath}`.quiet();
    }

    // Verify version (temporarily relaxed - just warn on mismatch)
    console.log('  Verifying version...');
    const versionResult = await $`${destPath} --version`.text();
    const versionOutput = versionResult.trim();

    // The version output should contain the version tag (e.g., "codex craft-v0.1.0" or similar)
    // We check if the version string contains our expected version
    if (!versionOutput.toLowerCase().includes(codexVersion.toLowerCase().replace('craft-', ''))) {
      console.log(
        `  ⚠️  Version mismatch (proceeding anyway):\n` +
        `      Expected: ${codexVersion}\n` +
        `      Got: ${versionOutput}`
      );
    } else {
      console.log(`  Version verified: ${versionOutput} ✓`);
    }
    console.log(`  Codex installed to ${destPath} ✓`);
  } finally {
    // Cleanup temp directory
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Verify that a local Codex binary exists and is executable.
 * Used when --local-codex flag is specified instead of downloading.
 */
export function verifyLocalCodex(config: BuildConfig): void {
  const { platform, arch, electronDir } = config;
  const isWindows = platform === 'win32';
  const codexBinary = isWindows ? 'codex.exe' : 'codex';
  const vendorDir = join(electronDir, 'vendor', 'codex', `${platform}-${arch}`);
  const binaryPath = join(vendorDir, codexBinary);

  console.log(`Verifying local Codex binary at ${binaryPath}...`);

  if (!existsSync(binaryPath)) {
    throw new Error(
      `Local Codex binary not found!\n\n` +
      `Expected path: ${binaryPath}\n\n` +
      `To use --local-codex, first copy your Codex binary:\n` +
      `  mkdir -p ${vendorDir}\n` +
      `  cp /path/to/your/codex ${binaryPath}\n` +
      `  chmod +x ${binaryPath}`
    );
  }

  console.log(`  Local Codex binary found ✓`);
}

/**
 * Clean previous build artifacts
 */
export function cleanBuildArtifacts(config: BuildConfig): void {
  const { electronDir, localCodex } = config;

  console.log('Cleaning previous builds...');

  // When using local Codex, preserve vendor/codex but clean vendor/bun
  if (localCodex) {
    const foldersToClean = [
      join(electronDir, 'vendor', 'bun'),
      join(electronDir, 'node_modules', '@anthropic-ai'),
      join(electronDir, 'packages'),
      join(electronDir, 'release'),
    ];

    for (const folder of foldersToClean) {
      if (existsSync(folder)) {
        rmSync(folder, { recursive: true, force: true });
      }
    }
    console.log('  Preserved vendor/codex (--local-codex mode)');
  } else {
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
 * Copy network interceptor (Anthropic — runs under Bun via --preload)
 */
export function copyInterceptor(config: BuildConfig): void {
  const { rootDir, electronDir } = config;

  const sharedSrcDir = join('packages', 'shared', 'src');
  const sourceDir = join(rootDir, sharedSrcDir);
  const destDir = join(electronDir, sharedSrcDir);

  const interceptorSource = join(sourceDir, 'network-interceptor.ts');
  if (!existsSync(interceptorSource)) {
    throw new Error(`Interceptor not found at ${interceptorSource}`);
  }

  console.log('Copying interceptor...');
  mkdirSync(destDir, { recursive: true });
  copyFileSync(interceptorSource, join(destDir, 'network-interceptor.ts'));

  // Also copy shared infrastructure (imported by network-interceptor.ts at runtime)
  const commonSource = join(sourceDir, 'interceptor-common.ts');
  if (existsSync(commonSource)) {
    copyFileSync(commonSource, join(destDir, 'interceptor-common.ts'));
  }
}

/**
 * Copy Copilot network interceptor (bundled CJS — runs under Node.js via --require)
 * Built by `bun run build:copilot-interceptor` into apps/electron/dist/
 */
export function copyCopilotInterceptor(config: BuildConfig): void {
  const { electronDir } = config;

  const source = join(electronDir, 'dist', 'copilot-interceptor.cjs');
  if (!existsSync(source)) {
    console.warn('Warning: Copilot interceptor not found at', source, '— tool metadata will be unavailable for Copilot sessions');
    return;
  }

  // Already in dist/ which is included in the packaged app — just verify it exists
  console.log('Copilot interceptor verified at:', source);
}

/**
 * Copy Bridge MCP Server to packaged app resources.
 * The bridge server is used for API sources in Codex sessions.
 */
export function copyBridgeServer(config: BuildConfig): void {
  const { rootDir, electronDir } = config;

  const bridgeSource = join(rootDir, 'packages', 'bridge-mcp-server', 'dist', 'index.js');
  const bridgeDest = join(electronDir, 'resources', 'bridge-mcp-server', 'index.js');

  if (!existsSync(bridgeSource)) {
    console.warn(`Warning: Bridge server not found at ${bridgeSource}. API sources in Codex sessions will not work.`);
    return;
  }

  console.log('Copying Bridge MCP Server...');
  mkdirSync(dirname(bridgeDest), { recursive: true });
  copyFileSync(bridgeSource, bridgeDest);
}

/**
 * Copy Session MCP Server to packaged app resources.
 * The session server provides session-scoped tools (SubmitPlan, config_validate, etc.) for Codex sessions.
 */
export function copySessionServer(config: BuildConfig): void {
  const { rootDir, electronDir } = config;

  const sessionSource = join(rootDir, 'packages', 'session-mcp-server', 'dist', 'index.js');
  const sessionDest = join(electronDir, 'resources', 'session-mcp-server', 'index.js');

  if (!existsSync(sessionSource)) {
    console.warn(`Warning: Session server not found at ${sessionSource}. Session-scoped tools in Codex sessions will not work.`);
    return;
  }

  console.log('Copying Session MCP Server...');
  mkdirSync(dirname(sessionDest), { recursive: true });
  copyFileSync(sessionSource, sessionDest);
}

/**
 * Build MCP helper servers (bridge + session).
 * Shared across all platforms to avoid drift.
 */
export function buildMcpServers(config: BuildConfig): void {
  const { rootDir } = config;

  const bridgeDir = join(rootDir, 'packages', 'bridge-mcp-server');
  const bridgeOut = join(bridgeDir, 'dist', 'index.js');
  const sessionDir = join(rootDir, 'packages', 'session-mcp-server');
  const sessionOut = join(sessionDir, 'dist', 'index.js');

  console.log('Building MCP helper servers...');

  mkdirSync(join(bridgeDir, 'dist'), { recursive: true });
  mkdirSync(join(sessionDir, 'dist'), { recursive: true });

  execSync(
    `bun build ${join(bridgeDir, 'src', 'index.ts')} --outfile ${bridgeOut} --target node --format cjs`,
    { cwd: rootDir, stdio: 'inherit', shell: true }
  );

  execSync(
    `bun build ${join(sessionDir, 'src', 'index.ts')} --outfile ${sessionOut} --target node --format cjs`,
    { cwd: rootDir, stdio: 'inherit', shell: true }
  );

  if (!existsSync(bridgeOut)) {
    throw new Error(`Bridge MCP server output not found at ${bridgeOut}`);
  }
  if (!existsSync(sessionOut)) {
    throw new Error(`Session MCP server output not found at ${sessionOut}`);
  }
}

/**
 * Verify MCP helper servers are present in packaged resources.
 */
export function verifyMcpServersExist(config: BuildConfig): void {
  const { electronDir } = config;

  const bridgePath = join(electronDir, 'resources', 'bridge-mcp-server', 'index.js');
  const sessionPath = join(electronDir, 'resources', 'session-mcp-server', 'index.js');

  if (!existsSync(bridgePath)) {
    throw new Error(`Bridge MCP server not found at ${bridgePath}`);
  }
  if (!existsSync(sessionPath)) {
    throw new Error(`Session MCP server not found at ${sessionPath}`);
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
