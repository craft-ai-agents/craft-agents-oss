/**
 * Discord worker build script.
 *
 * Bundles the discord.js-backed Discord subprocess into a single CJS file at
 * packages/messaging-discord-worker/dist/worker.cjs.
 *
 * discord.js is bundled INTO the output (not marked external) so the packaged
 * app ships a self-contained worker — users don't have to install anything.
 *
 * The worker is spawned as a Node subprocess by the DiscordAdapter:
 *   - Electron: re-enters its embedded Node via ELECTRON_RUN_AS_NODE=1.
 *   - Headless/Bun server: spawns a system `node` binary.
 * That's why we emit CJS + platform=node — it must stay Node-compatible.
 */

import { spawn } from "bun";
import { execSync } from "child_process";
import { existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Resolve a short git SHA for the build, suffixed with `+dirty` when the
 * working tree has uncommitted changes. Returns `unknown` outside a git
 * checkout.
 */
function resolveGitSha(cwd: string): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd }).toString().trim();
    let dirty = false;
    try {
      const status = execSync("git status --porcelain", { cwd }).toString().trim();
      dirty = status.length > 0;
    } catch {
      // ignore — treat as clean
    }
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return "unknown";
  }
}

const ROOT_DIR = join(import.meta.dir, "..");
const WORKER_DIR = join(ROOT_DIR, "packages/messaging-discord-worker");
const SOURCE = join(WORKER_DIR, "src/worker.ts");
const DIST_DIR = join(WORKER_DIR, "dist");
const OUTPUT = join(DIST_DIR, "worker.cjs");

async function verifyJsFile(filePath: string): Promise<{ valid: boolean; error?: string }> {
  if (!existsSync(filePath)) return { valid: false, error: "File does not exist" };
  const stats = statSync(filePath);
  if (stats.size === 0) return { valid: false, error: "File is empty" };

  const proc = spawn({
    cmd: ["node", "--check", filePath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) return { valid: false, error: stderr || "Syntax error" };
  return { valid: true };
}

async function main(): Promise<void> {
  if (!existsSync(SOURCE)) {
    console.error("❌ Discord worker source not found at", SOURCE);
    process.exit(1);
  }

  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  const buildId = new Date().toISOString();
  const gitSha = resolveGitSha(ROOT_DIR);
  console.log(`🎮 Building Discord worker (bundling discord.js) — build ${buildId} (${gitSha})...`);

  const proc = spawn({
    cmd: [
      "bun", "run", "esbuild",
      SOURCE,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node20",
      `--outfile=${OUTPUT}`,
      // Inject build provenance. The worker logs these on startup so an
      // operator can confirm a rebuild actually propagated to the running
      // subprocess after `bun run build:discord-worker`.
      `--define:__DISCORD_WORKER_BUILD_ID__=${JSON.stringify(buildId)}`,
      `--define:__DISCORD_WORKER_GIT_SHA__=${JSON.stringify(gitSha)}`,
      // Only Electron is external — discord.js and all its transitive deps
      // get bundled so the worker is self-contained.
      "--external:electron",
      // zlib-sync is an optional native accel for discord.js' ws compression;
      // it falls back to no compression if absent. Leave it external so the
      // bundle doesn't try to embed a native addon.
      "--external:zlib-sync",
      "--external:bufferutil",
      "--external:utf-8-validate",
    ],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("❌ Discord worker build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  console.log("🔍 Verifying worker output...");
  const verification = await verifyJsFile(OUTPUT);
  if (!verification.valid) {
    console.error("❌ Worker build verification failed:", verification.error);
    process.exit(1);
  }

  const { size } = statSync(OUTPUT);
  console.log(`✅ Discord worker built (${(size / 1024 / 1024).toFixed(2)} MB) → ${OUTPUT}`);
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err);
  process.exit(1);
});
