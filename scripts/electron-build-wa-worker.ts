/**
 * WhatsApp worker build script.
 *
 * Bundles the Baileys-backed WhatsApp subprocess into a single CJS file at
 * packages/messaging-whatsapp-worker/dist/worker.cjs.
 *
 * Baileys is bundled INTO the output (not marked external) so the packaged
 * app ships a self-contained worker — users don't have to install anything.
 * The dynamic import at runtime still works because esbuild resolves literal
 * dynamic-import strings at bundle time.
 *
 * The worker is spawned under Electron's embedded Node (ELECTRON_RUN_AS_NODE=1)
 * by the WhatsAppAdapter, which is why we emit CJS + platform=node.
 */

import { spawn } from "bun";
import { existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");
const WORKER_DIR = join(ROOT_DIR, "packages/messaging-whatsapp-worker");
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
    console.error("❌ WhatsApp worker source not found at", SOURCE);
    process.exit(1);
  }

  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  console.log("📨 Building WhatsApp worker (bundling Baileys)...");

  const proc = spawn({
    cmd: [
      "bun", "run", "esbuild",
      SOURCE,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node20",
      `--outfile=${OUTPUT}`,
      // Mark only Electron + Baileys' runtime-optional peers external.
      // Baileys itself and all its required transitive deps get bundled.
      //
      // The three optional deps below are unused by Craft Agent (no link
      // previews, no terminal QR, no inline image transforms). Baileys
      // guards them with try/catch so they fail silently at runtime.
      "--external:electron",
      "--external:link-preview-js",
      "--external:qrcode-terminal",
      "--external:jimp",
    ],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("❌ WhatsApp worker build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  console.log("🔍 Verifying worker output...");
  const verification = await verifyJsFile(OUTPUT);
  if (!verification.valid) {
    console.error("❌ Worker build verification failed:", verification.error);
    process.exit(1);
  }

  const { size } = statSync(OUTPUT);
  console.log(`✅ WhatsApp worker built (${(size / 1024 / 1024).toFixed(2)} MB) → ${OUTPUT}`);
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err);
  process.exit(1);
});
