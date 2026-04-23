#!/usr/bin/env bun
/**
 * Build and stage the subprocess servers that the Electron app spawns at
 * runtime for non-Anthropic sessions:
 *   - session-mcp-server  (MCP server that exposes session tools)
 *   - pi-agent-server     (Pi SDK session host — drives every pi_compat/pi
 *                          connection, including Cursor, ChatGPT Plus,
 *                          GitHub Copilot, OpenRouter, Ollama, etc.)
 *
 * Without these, the runtime resolver (packages/shared/src/agent/backend/
 * internal/runtime-resolver.ts → resolveServerPath) returns undefined and
 * PiAgent.spawnSubprocess() throws
 *   "piServerPath not configured. Cannot spawn Pi subprocess."
 * the first time the user sends a message through any pi_compat connection.
 *
 * Must run before `electron-builder` packages the .app — electron-builder's
 * files-glob picks up `apps/electron/resources/<server>/**` per the
 * electron-builder.yml config, so we write the bundled servers into
 * `apps/electron/resources/<server>/` to match.
 *
 * Invocation:
 *   bun run scripts/build-electron-servers.ts            # defaults to host arch
 *   bun run scripts/build-electron-servers.ts --arch=arm64 --platform=darwin
 *
 * Reuses the shared helpers from scripts/build/common.ts so the logic is
 * identical to `build-server.ts`, which is what the Docker server image
 * already uses. We just couldn't call build-server.ts directly because it's
 * designed for a fully standalone server distribution, not the Electron
 * staging step.
 */
import { buildMcpServers, copyPiAgentServer } from './build/common.ts';
import type { BuildConfig, Platform, Arch } from './build/common.ts';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  rmSync,
} from 'node:fs';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON_DIR = join(ROOT_DIR, 'apps', 'electron');

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  return raw?.slice(prefix.length);
}

function detectPlatform(): Platform {
  const raw = parseArg('platform') || process.platform;
  if (raw === 'darwin' || raw === 'linux' || raw === 'win32') return raw;
  throw new Error(`Unsupported platform: ${raw}`);
}

function detectArch(): Arch {
  const raw = parseArg('arch') || process.arch;
  if (raw === 'arm64' || raw === 'x64') return raw;
  throw new Error(`Unsupported arch: ${raw}`);
}

const config: BuildConfig = {
  rootDir: ROOT_DIR,
  electronDir: ELECTRON_DIR,
  platform: detectPlatform(),
  arch: detectArch(),
  // Upload-related fields are only consulted by build-server.ts's upload path.
  // The two helpers we call here (buildMcpServers / copyPiAgentServer) never
  // read them; BuildConfig just happens to be a single shared shape.
  upload: false,
  uploadLatest: false,
  uploadScript: false,
};

console.log(`Staging Electron subprocess servers for ${config.platform}-${config.arch}...`);

// 1. Build session-mcp-server + pi-agent-server from source
//    (writes packages/<name>/dist/index.js)
buildMcpServers(config);

// 2. Copy session-mcp-server output → apps/electron/resources/session-mcp-server/
{
  const srcIndex = join(ROOT_DIR, 'packages', 'session-mcp-server', 'dist', 'index.js');
  const destDir = join(ELECTRON_DIR, 'resources', 'session-mcp-server');
  if (!existsSync(srcIndex)) {
    throw new Error(`session-mcp-server output missing at ${srcIndex}`);
  }
  // Clean then re-create so stale files from a previous build never leak in
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  copyFileSync(srcIndex, join(destDir, 'index.js'));
  console.log(`Copied session-mcp-server → ${destDir}/index.js`);
}

// 3. Copy pi-agent-server + koffi native binary via the shared helper.
//    copyPiAgentServer handles the platform-specific koffi native module
//    pruning so we ship ~4MB instead of ~80MB of cross-platform binaries.
//    The destination dir is apps/electron/resources/pi-agent-server/
//    which matches electron-builder.yml's files glob.
{
  const destDir = join(ELECTRON_DIR, 'resources', 'pi-agent-server');
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
  copyPiAgentServer(config);
  if (!existsSync(join(destDir, 'index.js'))) {
    throw new Error(
      `pi-agent-server did not land at ${destDir}/index.js — check ` +
      `packages/pi-agent-server/dist/ was produced by buildMcpServers(). ` +
      `Pi-compat connections (Cursor, ChatGPT Plus, Copilot, …) will fail ` +
      `at session spawn with "piServerPath not configured".`,
    );
  }
}

console.log('✓ Electron subprocess servers staged');
