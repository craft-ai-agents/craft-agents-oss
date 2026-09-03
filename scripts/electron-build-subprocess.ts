#!/usr/bin/env bun
/**
 * Build the bundled subprocess servers (session MCP + Pi agent) and copy them
 * into `apps/electron/resources/` so electron-builder bundles them.
 *
 * The packaged runtime resolves these from
 * `<app>/Contents/Resources/app/resources/{session-mcp-server,pi-agent-server}/index.js`
 * (see packages/shared/src/agent/backend/internal/runtime-resolver.ts →
 * resolveServerPath). Without this step `piServerPath` resolves to nothing and
 * Pi SDK sessions fail with "piServerPath not configured. Cannot spawn Pi
 * subprocess."
 *
 * The full production build (build-dmg.sh / build.ts) runs this via the
 * buildMcpServers + copyPiAgentServer + copySessionServer helpers in
 * scripts/build/common.ts. This standalone script makes the same step
 * available to the OSS `electron:dist[:dev]:mac` commands, which otherwise
 * only run `electron:build` and never populate these resources.
 *
 * Usage:
 *   bun run scripts/electron-build-subprocess.ts                 # host platform/arch
 *   bun run scripts/electron-build-subprocess.ts --arch=arm64    # explicit arch
 *   bun run scripts/electron-build-subprocess.ts --platform=darwin --arch=arm64
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import {
  buildMcpServers,
  copyPiAgentServer,
  copySessionServer,
  type Arch,
  type BuildConfig,
  type Platform,
} from './build/common.ts';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    platform: { type: 'string', default: process.platform },
    arch: { type: 'string', default: process.arch === 'arm64' ? 'arm64' : 'x64' },
  },
  allowPositionals: true,
});

const platform = values.platform as Platform;
const arch = values.arch as Arch;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(scriptDir);
const electronDir = join(rootDir, 'apps', 'electron');

const config: BuildConfig = {
  platform,
  arch,
  upload: false,
  uploadLatest: false,
  uploadScript: false,
  rootDir,
  electronDir,
};

console.log(`Building bundled subprocess servers for ${platform}-${arch}...`);
buildMcpServers(config);
copySessionServer(config);
copyPiAgentServer(config);
console.log('Subprocess servers copied to apps/electron/resources/');
