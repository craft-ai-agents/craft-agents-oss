#!/usr/bin/env bun
/**
 * Unified build script for Craft Agent
 *
 * Usage:
 *   bun run scripts/build.ts --platform=darwin --arch=arm64
 *   bun run scripts/build.ts --platform=win32 --arch=x64
 *   bun run scripts/build.ts --platform=linux --arch=x64 --upload --latest
 *
 * Options:
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
  downloadUv,
  copySDK,
  copyInterceptor,
  copyInterceptorBundle,
  buildMcpServers,
  copySessionServer,
  copyPiAgentServer,
  verifyMcpServersExist,
  buildElectronApp,
  createManifest,
  uploadToS3,
} from './build/common';
import { packageDarwin } from './build/darwin';
import { packageLinux } from './build/linux';
import { packageWindows, buildElectronAppWindows } from './build/win32';

function showHelp(): void {
  console.log(`
Unified build script for Craft Agent

Usage:
  bun run scripts/build.ts [options]

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
  # Build macOS arm64
  bun run scripts/build.ts --platform=darwin --arch=arm64

  # Build Windows x64 and upload
  bun run scripts/build.ts --platform=win32 --arch=x64 --upload --latest

  # Build Linux x64
  bun run scripts/build.ts --platform=linux --arch=x64
`);
}

async function main(): Promise<void> {
  // Parse command-line arguments
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
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
  };

  console.log(`=== Building Craft Agents for ${platform}-${arch} ===`);
  if (config.upload) {
    console.log('Will upload to S3 after build');
  }

  try {
    // Load environment variables
    console.log('\n[1/9] Loading environment...');
    await loadEnvFile(config);

    // Common build steps
    console.log('\n[2/9] Cleaning previous builds...');
    cleanBuildArtifacts(config);

    console.log('\n[3/9] Installing dependencies...');
    await installDependencies(config);

    console.log('\n[4/9] Downloading Bun runtime...');
    await downloadBun(config);

    console.log('\n[5/9] Downloading uv runtime...');
    await downloadUv(config);

    console.log('\n[6/9] Copying SDK and interceptors...');
    copySDK(config);
    copyInterceptor(config);
    copyInterceptorBundle(config);

    // Build MCP servers (session + Pi agent)
    console.log('\n[7/9] Building MCP servers...');
    buildMcpServers(config);

    // Build Electron app (Windows has special OAuth injection)
    console.log('\n[8/9] Building Electron app...');
    if (platform === 'win32') {
      await buildElectronAppWindows(config);
    } else {
      await buildElectronApp(config);
    }

    // Copy MCP servers to packaged app resources
    copySessionServer(config);
    copyPiAgentServer(config);
    verifyMcpServersExist(config);

    // Package for the target platform
    console.log('\n[9/9] Packaging for platform...');
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
