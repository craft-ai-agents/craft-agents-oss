/**
 * Stage the Session MCP server and Pi agent server into
 * apps/electron/resources/ before electron-builder packages the app.
 *
 * Unlike the committed bridge-mcp-server (which lives in git under
 * resources/), these two servers are gitignored and produced at build time.
 * The copy logic already exists in ./common.ts; this thin entrypoint wires it
 * into build-dmg.sh, which predates those copy steps and otherwise leaves
 * resources/{pi-agent-server,session-mcp-server}/ empty — causing the packaged
 * app to fail at runtime with "piServerPath not configured".
 *
 * Run AFTER `electron:build` (which produces packages/<server>/dist/index.js)
 * and BEFORE electron-builder.
 *
 * Usage: bun run scripts/build/stage-servers.ts <platform> <arch>
 *   platform: darwin | win32 | linux   (default: darwin)
 *   arch:     arm64 | x64              (default: arm64)
 */
import { join } from "path";
import {
  copySessionServer,
  copyCloudRunner,
  copyPiAgentServer,
  type Arch,
  type BuildConfig,
  type Platform,
} from "./common";

const platform = (process.argv[2] as Platform) || "darwin";
const arch = (process.argv[3] as Arch) || "arm64";

if (!["darwin", "win32", "linux"].includes(platform)) {
  console.error(`Invalid platform: ${platform} (expected darwin | win32 | linux)`);
  process.exit(1);
}
if (!["arm64", "x64"].includes(arch)) {
  console.error(`Invalid arch: ${arch} (expected arm64 | x64)`);
  process.exit(1);
}

const rootDir = join(import.meta.dir, "..", "..");
const electronDir = join(rootDir, "apps", "electron");

const config: BuildConfig = {
  platform,
  arch,
  upload: false,
  uploadLatest: false,
  uploadScript: false,
  rootDir,
  electronDir,
};

console.log(`Staging MCP/Pi servers into resources/ (${platform}-${arch})...`);
copySessionServer(config);
copyPiAgentServer(config);
copyCloudRunner(config);
console.log("✅ Servers staged into apps/electron/resources/");
