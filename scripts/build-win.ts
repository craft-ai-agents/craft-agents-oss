/**
 * Windows build orchestration script.
 *
 * Handles all vendor downloads and copies before running electron-builder.
 * Run from the repo root on a Windows machine (or in a Windows CI runner):
 *
 *   bun run scripts/build-win.ts [--arch=x64|arm64] [--dev]
 *
 * --dev   Sets CRAFT_DEV_RUNTIME=1 (skips release-mode assertions, faster iteration)
 */

import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import {
  type BuildConfig,
  type Arch,
  downloadBun,
  downloadUv,
  installDependencies,
  copyRipgrep,
  copyInterceptor,
  copySessionServer,
  copyPiAgentServer,
  buildMcpServers,
  verifyMcpServersExist,
  loadEnvFile,
} from './build/common';
import {
  buildElectronAppWindows,
  packageWindows,
} from './build/win32';

const ROOT_DIR = join(import.meta.dir, '..');
const ELECTRON_DIR = join(ROOT_DIR, 'apps', 'electron');

function parseArgs(): { arch: Arch; dev: boolean } {
  const args = process.argv.slice(2);
  const archArg = args.find(a => a.startsWith('--arch='))?.split('=')[1];
  const arch: Arch = (archArg === 'arm64' ? 'arm64' : 'x64');
  const dev = args.includes('--dev');
  return { arch, dev };
}


function copyBridgeServer(config: BuildConfig): void {
  const { rootDir, electronDir } = config;
  const src = join(rootDir, 'packages', 'bridge-mcp-server', 'dist', 'index.js');
  const destDir = join(electronDir, 'resources', 'bridge-mcp-server');
  const dest = join(destDir, 'index.js');

  if (!existsSync(src)) {
    console.warn(`  Warning: Bridge MCP server not found at ${src}.`);
    return;
  }

  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
  console.log('  Bridge MCP server copied.');
}

async function main(): Promise<void> {
  const { arch, dev } = parseArgs();

  if (dev) process.env.CRAFT_DEV_RUNTIME = '1';

  const config: BuildConfig = {
    platform: 'win32',
    arch,
    upload: false,
    uploadLatest: false,
    uploadScript: false,
    rootDir: ROOT_DIR,
    electronDir: ELECTRON_DIR,
  };

  console.log(`\n=== MDP Windows Build (${arch}) ===\n`);

  await loadEnvFile(config);

  console.log('\n[1/7] Installing dependencies...');
  await installDependencies(config);

  console.log('\n[2/7] Building MCP servers and Pi agent...');
  buildMcpServers(config);

  console.log('\n[3/7] Copying subprocess servers into resources...');
  copySessionServer(config);
  copyBridgeServer(config);
  copyPiAgentServer(config);
  verifyMcpServersExist(config);

  console.log('\n[4/7] Downloading Bun runtime...');
  await downloadBun(config);

  console.log('\n[5/7] Downloading uv...');
  await downloadUv(config);

  console.log('\n[6/7] Staging ripgrep...');
  await copyRipgrep(config);
  copyInterceptor(config);

  console.log('\n[7/7] Building and packaging...');
  await buildElectronAppWindows(config);
  const artifactPath = await packageWindows(config);

  console.log(`\n=== Build Complete ===`);
  console.log(`Installer: ${artifactPath}`);
}

main().catch(err => {
  console.error('\nBuild failed:', err.message);
  process.exit(1);
});
