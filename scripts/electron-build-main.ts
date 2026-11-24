/**
 * Cross-platform main process build script
 * Loads .env and passes OAuth defines to esbuild
 */

import { spawn } from "bun";
import { existsSync, readFileSync, statSync, mkdirSync } from "fs";
import { join } from "path";
import { compileCraftyInput } from "./build/crafty-input";
import { buildPiAgentServer as bundlePiAgentServer } from "../packages/pi-agent-server/build.ts";

const ROOT_DIR = join(import.meta.dir, "..");
const DIST_DIR = join(ROOT_DIR, "apps/electron/dist");
const OUTPUT_FILE = join(DIST_DIR, "main.cjs");
const INTERCEPTOR_SOURCE = join(ROOT_DIR, "packages/shared/src/unified-network-interceptor.ts");
const INTERCEPTOR_OUTPUT = join(DIST_DIR, "interceptor.cjs");
const SESSION_TOOLS_CORE_DIR = join(ROOT_DIR, "packages/session-tools-core");
const WA_WORKER_DIR = join(ROOT_DIR, "packages/messaging-whatsapp-worker");
const WA_WORKER_SOURCE = join(WA_WORKER_DIR, "src/worker.ts");
const WA_WORKER_OUTPUT = join(WA_WORKER_DIR, "dist/worker.cjs");
const CRAFTY_NATIVE_SOURCE = join(ROOT_DIR, "apps/electron/src/crafty-native/host.ts");
const CRAFTY_NATIVE_OUTPUT = join(DIST_DIR, "crafty-native.cjs");

// Load .env file if it exists
function loadEnvFile(): void {
  const envPath = join(ROOT_DIR, ".env");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex).trim();
          let value = trimmed.slice(eqIndex + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          process.env[key] = value;
        }
      }
    }
  }
}

// Get build-time defines for esbuild (OAuth, Sentry DSN, etc.)
// NOTE: Sentry source map upload is intentionally disabled for the main process.
// To enable in the future, add @sentry/esbuild-plugin. See apps/electron/CLAUDE.md.
// NOTE: Google OAuth credentials are NOT baked into the build - users provide their own
// via source config. See README_FOR_OSS.md for setup instructions.
function getBuildDefines(): string[] {
  const definedVars = [
    "SLACK_OAUTH_CLIENT_ID",
    "SLACK_OAUTH_CLIENT_SECRET",
    "MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_SECRET",
    "SENTRY_ELECTRON_INGEST_URL",
    "CRAFT_DEV_RUNTIME",
  ];

  return definedVars.map((varName) => {
    const value = process.env[varName] || "";
    return `--define:process.env.${varName}="${value}"`;
  });
}

// Wait for file to stabilize (no size changes)
async function waitForFileStable(filePath: string, timeoutMs = 10000): Promise<boolean> {
  const startTime = Date.now();
  let lastSize = -1;
  let stableCount = 0;

  while (Date.now() - startTime < timeoutMs) {
    if (!existsSync(filePath)) {
      await Bun.sleep(100);
      continue;
    }

    const stats = statSync(filePath);
    if (stats.size === lastSize) {
      stableCount++;
      if (stableCount >= 3) {
        return true;
      }
    } else {
      stableCount = 0;
      lastSize = stats.size;
    }

    await Bun.sleep(100);
  }

  return false;
}

// Verify a JavaScript file is syntactically valid
async function verifyJsFile(filePath: string): Promise<{ valid: boolean; error?: string }> {
  if (!existsSync(filePath)) {
    return { valid: false, error: "File does not exist" };
  }

  const stats = statSync(filePath);
  if (stats.size === 0) {
    return { valid: false, error: "File is empty" };
  }

  const proc = spawn({
    cmd: ["node", "--check", filePath],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    return { valid: false, error: stderr || "Syntax error" };
  }

  return { valid: true };
}

// Verify Session Tools Core package exists (raw TypeScript, bundled by consumers)
// No build step needed - it exports TypeScript directly like other packages
function verifySessionToolsCore(): void {
  console.log("🔍 Verifying Session Tools Core...");

  // Verify source exists
  const sourceFile = join(SESSION_TOOLS_CORE_DIR, "src/index.ts");
  if (!existsSync(sourceFile)) {
    console.error("❌ Session tools core source not found at", sourceFile);
    process.exit(1);
  }

  console.log("✅ Session tools core verified");
}

// Build the unified network interceptor (bundled CJS loaded via --require into Node-based SDK subprocesses)
async function buildInterceptor(): Promise<void> {
  console.log("🔌 Building unified network interceptor...");

  const proc = spawn({
    cmd: [
      "bun", "run", "esbuild",
      INTERCEPTOR_SOURCE,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      `--outfile=${INTERCEPTOR_OUTPUT}`,
    ],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error("❌ Interceptor build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  if (!existsSync(INTERCEPTOR_OUTPUT)) {
    console.error("❌ Interceptor output not found at", INTERCEPTOR_OUTPUT);
    process.exit(1);
  }

  console.log("✅ Interceptor built successfully");
}

// Build the Pi Agent Server (subprocess for Pi SDK sessions)
async function buildPiAgentServer(): Promise<void> {
  console.log("🥧 Building Pi Agent Server...");
  try {
    await bundlePiAgentServer();
  } catch (err) {
    console.error("❌ Pi agent server build failed:", err);
    process.exit(1);
  }
  console.log("✅ Pi agent server built successfully");
}

// Build the WhatsApp worker (Baileys-backed subprocess spawned by WhatsAppAdapter)
async function buildWhatsAppWorker(): Promise<void> {
  if (!existsSync(WA_WORKER_SOURCE)) {
    console.log("⏭️  WhatsApp worker skipped (package not found)");
    return;
  }

  console.log("📨 Building WhatsApp worker...");

  const workerDistDir = join(WA_WORKER_DIR, "dist");
  if (!existsSync(workerDistDir)) {
    mkdirSync(workerDistDir, { recursive: true });
  }

  // Baileys is bundled INTO worker.cjs (not external) so the packaged app is
  // self-contained. Dynamic `import('@whiskeysockets/baileys')` is resolved
  // at bundle time because the specifier is a literal.
  const proc = spawn({
    cmd: [
      "bun", "run", "esbuild",
      WA_WORKER_SOURCE,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node20",
      `--outfile=${WA_WORKER_OUTPUT}`,
      "--external:electron",
      // Baileys' runtime-optional features — wrapped in try/catch at the
      // call site and not used by Craft Agent (we send text + documents, no
      // link previews, no inline image processing, no terminal QR).
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

  if (!existsSync(WA_WORKER_OUTPUT)) {
    console.error("❌ WhatsApp worker output not found at", WA_WORKER_OUTPUT);
    process.exit(1);
  }

  console.log("✅ WhatsApp worker built successfully");
}

// Build Crafty's native host (spike): a utility process that loads the selection-hook N-API
// module. The module stays external; electron-builder.yml ships it (and node-gyp-build, which
// loads its prebuild) from the root node_modules into app/node_modules on macOS. It's declared in
// the root package.json, not the app's, so @electron/rebuild never compiles it.
async function buildCraftyNative(): Promise<void> {
  console.log("🖱️  Building Crafty native host...");

  for (const pkg of ["selection-hook", "node-gyp-build"]) {
    if (!existsSync(join(ROOT_DIR, "node_modules", pkg, "package.json"))) {
      console.error(`❌ ${pkg} not found in the root node_modules, where electron-builder.yml ships it from. Run 'bun install'.`);
      process.exit(1);
    }
  }

  const proc = spawn({
    cmd: [
      "bun", "run", "esbuild",
      CRAFTY_NATIVE_SOURCE,
      "--bundle",
      "--platform=node",
      "--format=cjs",
      `--outfile=${CRAFTY_NATIVE_OUTPUT}`,
      "--external:electron",
      "--external:selection-hook",
    ],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("❌ Crafty native host build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  if (!existsSync(CRAFTY_NATIVE_OUTPUT)) {
    console.error("❌ Crafty native host output not found at", CRAFTY_NATIVE_OUTPUT);
    process.exit(1);
  }

  console.log("✅ Crafty native host built successfully");
}

// Crafty's native input addon (spike: the double-tap trigger), loaded by the native host. Without it
// the double-tap is gone, so a Mac build fails rather than ship without it.
async function buildCraftyInput(): Promise<void> {
  if (process.platform !== "darwin") return;
  console.log("⌘  Building Crafty native input addon...");
  try {
    await compileCraftyInput(ROOT_DIR);
  } catch (error) {
    console.error("❌ Crafty native input addon build failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
  console.log("✅ Crafty native input addon built successfully");
}

async function main(): Promise<void> {
  loadEnvFile();

  // Ensure dist directory exists
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  // Verify session tools core exists (shared utilities for session-scoped tools)
  verifySessionToolsCore();

  // Build Pi agent server (subprocess for Pi SDK sessions)
  await buildPiAgentServer();

  // Build unified network interceptor (CJS bundle for Node.js --require)
  await buildInterceptor();

  // Build WhatsApp worker (Baileys subprocess — optional package)
  await buildWhatsAppWorker();

  // Build Crafty's native host (utility process with the selection-hook module)
  await buildCraftyNative();
  await buildCraftyInput();

  const buildDefines = getBuildDefines();

  console.log("🔨 Building main process...");

  const proc = spawn({
    cmd: [
      "bun", "run", "esbuild",
      "apps/electron/src/main/index.ts",
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--outfile=apps/electron/dist/main.cjs",
      "--external:electron",
      // Claude Agent SDK is pure ESM (sdk.mjs) and calls `createRequire(import.meta.url)`
      // at module init. esbuild's CJS bundling leaves the synthesized `import_meta.url`
      // undefined for inner ESM modules, which throws ERR_INVALID_ARG_VALUE on load.
      // Externalize so Node loads the SDK natively as ESM (with a real import.meta.url).
      // Electron 39 ships Node 22.x which supports require() of ESM without TLA, so the
      // bundled main.cjs's `require('@anthropic-ai/claude-agent-sdk')` works.
      "--external:@anthropic-ai/claude-agent-sdk",
      // Replace grammY's bundled polyfills (node-fetch@2 + abort-controller@3)
      // with native Node globals. esbuild otherwise renames the polyfill's
      // `class AbortSignal` to `_AbortSignal` to dodge collision with the
      // global, which then breaks node-fetch@2's `constructor.name` check and
      // fails every Telegram API call with a TypeError.
      "--alias:node-fetch=./apps/electron/src/main/shims/node-fetch.cjs",
      "--alias:abort-controller=./apps/electron/src/main/shims/abort-controller.cjs",
      ...buildDefines,
    ],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error("❌ esbuild failed with exit code", exitCode);
    process.exit(exitCode);
  }

  // Wait for file to stabilize
  console.log("⏳ Waiting for file to stabilize...");
  const stable = await waitForFileStable(OUTPUT_FILE);

  if (!stable) {
    console.error("❌ Output file did not stabilize");
    process.exit(1);
  }

  // Verify the output
  console.log("🔍 Verifying build output...");
  const verification = await verifyJsFile(OUTPUT_FILE);

  if (!verification.valid) {
    console.error("❌ Build verification failed:", verification.error);
    process.exit(1);
  }

  console.log("✅ Build complete and verified");
  process.exit(0);
}

main();
