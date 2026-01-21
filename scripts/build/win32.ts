/**
 * Windows-specific build logic
 *
 * Note: This contains extensive workarounds for Windows Defender and file locking issues.
 * These are necessary for reliable CI builds on Windows.
 */

import { $ } from 'bun';
import { existsSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import type { BuildConfig } from './common';

/**
 * Kill processes that might lock files
 */
async function killLockingProcesses(): Promise<void> {
  const processesToKill = ['node', 'npm', 'electron', 'electron-builder'];

  for (const procName of processesToKill) {
    try {
      // This is Windows-specific, use taskkill
      await $`taskkill /F /IM ${procName}.exe 2>nul`.quiet().nothrow();
    } catch {
      // Process might not exist, that's fine
    }
  }

  // Give processes time to fully terminate
  await Bun.sleep(2000);
}

/**
 * Safely remove a directory with exponential backoff retry
 * Windows file locking can cause transient failures
 */
async function safeRmDir(dir: string, maxRetries = 5): Promise<void> {
  if (!existsSync(dir)) return;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      // Verify it's actually gone
      if (!existsSync(dir)) {
        return;
      }
    } catch (error) {
      lastError = error as Error;
    }

    // Exponential backoff: 500ms, 1s, 2s, 4s, 8s
    const delay = 500 * Math.pow(2, attempt);
    console.log(`    Directory still locked, retrying in ${delay}ms...`);
    await Bun.sleep(delay);
  }

  if (existsSync(dir)) {
    throw new Error(`Failed to remove ${dir} after ${maxRetries} attempts: ${lastError?.message}`);
  }
}

/**
 * Build main process with OAuth defines (Windows-specific inline build)
 */
async function buildMainProcess(config: BuildConfig): Promise<void> {
  const { rootDir, electronDir } = config;

  console.log('  Building main process...');

  const mainArgs = [
    'apps/electron/src/main/index.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--outfile=apps/electron/dist/main.cjs',
    '--external:electron',
  ];

  // Add OAuth defines if env vars are set
  const oauthDefines = [
    ['GOOGLE_OAUTH_CLIENT_ID', process.env.GOOGLE_OAUTH_CLIENT_ID],
    ['GOOGLE_OAUTH_CLIENT_SECRET', process.env.GOOGLE_OAUTH_CLIENT_SECRET],
    ['SLACK_OAUTH_CLIENT_ID', process.env.SLACK_OAUTH_CLIENT_ID],
    ['SLACK_OAUTH_CLIENT_SECRET', process.env.SLACK_OAUTH_CLIENT_SECRET],
    ['MICROSOFT_OAUTH_CLIENT_ID', process.env.MICROSOFT_OAUTH_CLIENT_ID],
  ];

  for (const [key, value] of oauthDefines) {
    if (value) {
      mainArgs.push(`--define:process.env.${key}="'${value}'"`);
    }
  }

  await $`cd ${rootDir} && npx esbuild ${mainArgs}`;
}

/**
 * Build Electron app for Windows (with OAuth injection)
 */
export async function buildElectronAppWindows(config: BuildConfig): Promise<void> {
  const { rootDir, electronDir } = config;

  console.log('Building Electron app...');

  // Build main process with OAuth defines
  await buildMainProcess(config);

  // Build preload
  console.log('  Building preload...');
  await $`cd ${rootDir} && bun run electron:build:preload`;

  // Build renderer
  console.log('  Building renderer...');
  const rendererDir = join(electronDir, 'dist', 'renderer');
  if (existsSync(rendererDir)) {
    rmSync(rendererDir, { recursive: true, force: true });
  }
  await $`cd ${rootDir} && npx vite build --config apps/electron/vite.config.ts`;

  // Verify renderer was built
  if (!existsSync(join(rendererDir, 'index.html'))) {
    throw new Error('Renderer build verification failed: index.html not found');
  }
  console.log('  Renderer build verified ✓');

  // Copy resources
  console.log('  Copying resources...');
  const resourcesSrc = join(electronDir, 'resources');
  const resourcesDst = join(electronDir, 'dist', 'resources');
  if (existsSync(resourcesDst)) {
    rmSync(resourcesDst, { recursive: true, force: true });
  }

  // Use Bun's file copying
  const { cpSync } = await import('fs');
  cpSync(resourcesSrc, resourcesDst, { recursive: true });
}

/**
 * Package the Windows app with electron-builder (with retry logic)
 */
export async function packageWindows(config: BuildConfig): Promise<string> {
  const { electronDir } = config;

  console.log('Packaging app with electron-builder...');

  // Kill any lingering processes first
  await killLockingProcesses();

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`  electron-builder attempt ${attempt} of ${maxRetries}...`);

    // Clean release directory before each attempt
    const releaseDir = join(electronDir, 'release');
    if (existsSync(releaseDir)) {
      console.log('  Cleaning release directory...');
      await safeRmDir(releaseDir);
    }

    try {
      await $`cd ${electronDir} && npx electron-builder --win --x64`;
      console.log(`  electron-builder succeeded on attempt ${attempt} ✓`);
      lastError = null;
      break;
    } catch (error) {
      lastError = error as Error;
      console.log(`  electron-builder failed on attempt ${attempt}`);

      if (attempt < maxRetries) {
        console.log('  Waiting 10 seconds before retry...');
        await killLockingProcesses();
        await Bun.sleep(10000);
      }
    }
  }

  if (lastError) {
    throw new Error(`electron-builder failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  // Find the built installer
  const releaseDir = join(electronDir, 'release');
  const files = readdirSync(releaseDir);
  const exeFile = files.find((f) => f.endsWith('.exe') && !f.includes('blockmap'));

  if (!exeFile) {
    console.error('Contents of release directory:');
    console.error(files.join('\n'));
    throw new Error('Installer not found in release directory');
  }

  const exePath = join(releaseDir, exeFile);

  // Get file size
  const file = Bun.file(exePath);
  const sizeMB = ((await file.size) / 1024 / 1024).toFixed(2);

  console.log(`\n=== Build Complete ===`);
  console.log(`Installer: ${exePath}`);
  console.log(`Size: ${sizeMB} MB`);

  return exePath;
}
