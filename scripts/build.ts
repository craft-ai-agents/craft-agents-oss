#!/usr/bin/env bun
/**
 * Unified build script for Craft Agent
 *
 * Usage:
 *   bun run scripts/build.ts --platform=darwin --arch=arm64 --codex-version=craft-v0.1.0
 *   bun run scripts/build.ts --platform=win32 --arch=x64 --codex-version=craft-v0.1.0
 *   bun run scripts/build.ts --platform=linux --arch=x64 --codex-version=craft-v0.1.0 --upload --latest
 *   bun run scripts/build.ts --platform=darwin --arch=arm64 --local-codex
 *
 * Options:
 *   --codex-version  Codex fork version to bundle (e.g., craft-v0.1.0)
 *                    Required unless --local-codex is specified
 *   --local-codex    Use local Codex binary from vendor/codex/{platform}-{arch}/
 *                    instead of downloading from GitHub
 *   --platform       Target platform: darwin, win32, linux (default: current platform)
 *   --arch           Target architecture: x64, arm64 (default: current arch)
 *   --upload         Upload to S3 after building
 *   --latest         Also update electron/latest (requires --upload)
 *   --script         Also upload install scripts (requires --upload)
 *   --help           Show this help message
 */

// Catch uncaught exceptions to ensure we always exit with error code
process.on('uncaughtException', (error) => {
  console.error('\n✗ Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('\n✗ Unhandled rejection:', reason);
  process.exit(1);
});

import { parseArgs } from 'util';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import {
  type BuildConfig,
  type Platform,
  type Arch,
  loadEnvFile,
  cleanBuildArtifacts,
  installDependencies,
  downloadBun,
  downloadCodex,
  verifyLocalCodex,
  copySDK,
  copyInterceptor,
  copyCopilotInterceptor,
  buildMcpServers,
  copyBridgeServer,
  copySessionServer,
  verifyMcpServersExist,
  buildElectronApp,
  createManifest,
  uploadToS3,
  CODEX_REPO,
} from './build/common';
import { packageDarwin } from './build/darwin';
import { packageLinux } from './build/linux';
import { packageWindows, buildElectronAppWindows } from './build/win32';

function showHelp(): void {
  console.log(`
Unified build script for Craft Agent

Usage:
  bun run scripts/build.ts --codex-version=<version> [options]
  bun run scripts/build.ts --local-codex [options]

Codex binary (one required):
  --codex-version=<version>  Download Codex fork version (e.g., craft-v0.1.0)
                             Releases: https://github.com/${CODEX_REPO}/releases
  --local-codex              Use local Codex binary from vendor/codex/{platform}-{arch}/
                             Pre-copy your binary before running the build.

Options:
  --platform=<platform>  Target platform: darwin, win32, linux
                         (default: ${process.platform})
  --arch=<arch>          Target architecture: x64, arm64
                         (default: ${process.arch === 'arm64' ? 'arm64' : 'x64'})
  --upload               Upload to S3 after building
  --latest               Also update electron/latest (requires --upload)
  --script               Also upload install scripts (requires --upload)
  --help                 Show this help message

Environment variables (from .env or environment):
  APPLE_SIGNING_IDENTITY          Code signing identity (macOS)
  APPLE_ID                        Apple ID for notarization (macOS)
  APPLE_TEAM_ID                   Apple Team ID (macOS)
  APPLE_APP_SPECIFIC_PASSWORD     App-specific password (macOS)
  GOOGLE_OAUTH_CLIENT_ID          Google OAuth client ID
  GOOGLE_OAUTH_CLIENT_SECRET      Google OAuth client secret
  SLACK_OAUTH_CLIENT_ID           Slack OAuth client ID
  SLACK_OAUTH_CLIENT_SECRET       Slack OAuth client secret
  MICROSOFT_OAUTH_CLIENT_ID       Microsoft OAuth client ID
  S3_VERSIONS_BUCKET_*            S3 credentials (for --upload)

Examples:
  # Build macOS arm64 with downloaded Codex
  bun run scripts/build.ts --codex-version=craft-v0.1.0 --platform=darwin --arch=arm64

  # Build macOS arm64 with local Codex binary
  bun run scripts/build.ts --local-codex --platform=darwin --arch=arm64

  # Build Windows x64 and upload
  bun run scripts/build.ts --codex-version=craft-v0.1.0 --platform=win32 --arch=x64 --upload --latest

  # Build Linux x64
  bun run scripts/build.ts --codex-version=craft-v0.1.0 --platform=linux --arch=x64
`);
}

async function main(): Promise<void> {
  // Parse command-line arguments
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'codex-version': { type: 'string' },
      'local-codex': { type: 'boolean', default: false },
      platform: { type: 'string', default: process.platform },
      arch: { type: 'string', default: process.arch === 'arm64' ? 'arm64' : 'x64' },
      upload: { type: 'boolean', default: false },
      latest: { type: 'boolean', default: false },
      script: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  // Validate codex source (either --codex-version or --local-codex required)
  const codexVersion = values['codex-version'];
  const localCodex = values['local-codex'] ?? false;

  if (!codexVersion && !localCodex) {
    console.error('ERROR: Either --codex-version or --local-codex is required.\n');
    console.error('The Codex fork binary is bundled with the app and must be explicitly specified.');
    console.error(`Available releases: https://github.com/${CODEX_REPO}/releases\n`);
    console.error('Examples:');
    console.error('  bun run scripts/build.ts --codex-version=craft-v0.1.0 --platform=darwin --arch=arm64');
    console.error('  bun run scripts/build.ts --local-codex --platform=darwin --arch=arm64');
    process.exit(1);
  }

  if (codexVersion && localCodex) {
    console.error('ERROR: Cannot use both --codex-version and --local-codex.\n');
    console.error('Use --codex-version to download from GitHub, or --local-codex to use a pre-placed binary.');
    process.exit(1);
  }

  // Validate codex-version format (should be craft-vX.Y.Z) if provided
  if (codexVersion && !codexVersion.match(/^craft-v\d+\.\d+\.\d+/)) {
    console.error(`ERROR: Invalid --codex-version format: ${codexVersion}\n`);
    console.error('Expected format: craft-vX.Y.Z (e.g., craft-v0.1.0)');
    process.exit(1);
  }

  // Validate platform
  const validPlatforms: Platform[] = ['darwin', 'win32', 'linux'];
  const platform = values.platform as Platform;
  if (!validPlatforms.includes(platform)) {
    console.error(`Invalid platform: ${platform}. Must be one of: ${validPlatforms.join(', ')}`);
    process.exit(1);
  }

  // Validate arch
  const validArchs: Arch[] = ['x64', 'arm64'];
  const arch = values.arch as Arch;
  if (!validArchs.includes(arch)) {
    console.error(`Invalid arch: ${arch}. Must be one of: ${validArchs.join(', ')}`);
    process.exit(1);
  }

  // Determine paths (use fileURLToPath for Windows compatibility)
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const rootDir = dirname(scriptDir);
  const electronDir = join(rootDir, 'apps', 'electron');

  // Verify we're in the right directory
  if (!existsSync(join(rootDir, 'package.json'))) {
    console.error('ERROR: Must run from the repository root');
    process.exit(1);
  }

  const config: BuildConfig = {
    platform,
    arch,
    upload: values.upload ?? false,
    uploadLatest: values.latest ?? false,
    uploadScript: values.script ?? false,
    rootDir,
    electronDir,
    codexVersion: codexVersion ?? 'local',
    localCodex,
  };

  console.log(`=== Building Craft Agents for ${platform}-${arch} ===`);
  console.log(`Codex: ${localCodex ? 'local binary' : codexVersion}`);
  if (config.upload) {
    console.log('Will upload to S3 after build');
  }

  try {
    // Load environment variables
    console.log('\n[1/10] Loading environment...');
    await loadEnvFile(config);

    // Common build steps
    console.log('\n[2/10] Cleaning previous builds...');
    cleanBuildArtifacts(config);

    console.log('\n[3/10] Installing dependencies...');
    await installDependencies(config);

    console.log('\n[4/10] Downloading Bun runtime...');
    await downloadBun(config);

    if (localCodex) {
      console.log('\n[5/10] Verifying local Codex binary...');
      verifyLocalCodex(config);
    } else {
      console.log('\n[5/10] Downloading Codex binary...');
      await downloadCodex(config);
    }

    console.log('\n[6/10] Copying SDK...');
    copySDK(config);

    console.log('\n[7/10] Copying interceptors...');
    copyInterceptor(config);
    copyCopilotInterceptor(config);

    // Build MCP helper servers (bridge + session)
    console.log('\n[8/11] Building MCP helper servers...');
    buildMcpServers(config);

    // Build Electron app (Windows has special OAuth injection)
    console.log('\n[9/11] Building Electron app...');
    if (platform === 'win32') {
      await buildElectronAppWindows(config);
    } else {
      await buildElectronApp(config);
    }

    // Copy Bridge MCP Server to packaged app resources (after build creates it)
    console.log('\n[10/11] Copying Bridge MCP Server...');
    copyBridgeServer(config);

    // Copy Session MCP Server to packaged app resources (provides SubmitPlan, etc. for Codex)
    console.log('\n[10/11] Copying Session MCP Server...');
    copySessionServer(config);

    console.log('\n[10/11] Verifying MCP helper servers...');
    verifyMcpServersExist(config);

    // Package for the target platform
    console.log('\n[11/11] Packaging for platform...');
    let artifactPath: string;
    switch (platform) {
      case 'darwin':
        artifactPath = await packageDarwin(config);
        break;
      case 'linux':
        artifactPath = await packageLinux(config);
        break;
      case 'win32':
        artifactPath = await packageWindows(config);
        break;
    }

    // Create manifest and optionally upload
    await createManifest(config);
    await uploadToS3(config);

    console.log('\n✓ Build completed successfully!');
    console.log(`  Artifact: ${artifactPath}`);
  } catch (error) {
    console.error('\n✗ Build failed:', error);
    process.exit(1);
  }
}

main();
