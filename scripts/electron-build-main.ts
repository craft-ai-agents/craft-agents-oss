/**
 * Cross-platform main process build script
 * Loads .env and passes OAuth defines to esbuild
 */

import { spawn } from "bun";
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");
const DIST_DIR = join(ROOT_DIR, "apps/electron/dist");
const OUTPUT_FILE = join(DIST_DIR, "main.cjs");
const INTERCEPTOR_SOURCE = join(ROOT_DIR, "packages/shared/src/unified-network-interceptor.ts");
const INTERCEPTOR_OUTPUT = join(DIST_DIR, "interceptor.cjs");
const SESSION_TOOLS_CORE_DIR = join(ROOT_DIR, "packages/session-tools-core");
const SESSION_SERVER_DIR = join(ROOT_DIR, "packages/session-mcp-server");
const SESSION_SERVER_OUTPUT = join(SESSION_SERVER_DIR, "dist/index.js");
const PI_AGENT_SERVER_DIR = join(ROOT_DIR, "packages/pi-agent-server");
const PI_AGENT_SERVER_OUTPUT = join(PI_AGENT_SERVER_DIR, "dist/index.js");

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

// Build the Session MCP Server (provides session-scoped tools like SubmitPlan for Codex sessions)
async function buildSessionServer(): Promise<void> {
  console.log("📋 Building Session MCP Server...");

  // Ensure dist directory exists
  const distDir = join(SESSION_SERVER_DIR, "dist");
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  const proc = spawn({
    cmd: [
      "bun", "build",
      join(SESSION_SERVER_DIR, "src/index.ts"),
      "--outfile", SESSION_SERVER_OUTPUT,
      "--target", "node",
      "--format", "cjs",
    ],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error("❌ Session server build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  // Verify output exists
  if (!existsSync(SESSION_SERVER_OUTPUT)) {
    console.error("❌ Session server output not found at", SESSION_SERVER_OUTPUT);
    process.exit(1);
  }

  console.log("✅ Session server built successfully");
}

// Build the Pi Agent Server (subprocess for Pi SDK sessions)
// Optional: skips if package directory is missing (e.g., not synced to OSS).
async function buildPiAgentServer(): Promise<void> {
  if (!existsSync(join(PI_AGENT_SERVER_DIR, "src"))) {
    console.log("⏭️  Pi agent server skipped (package not found)");
    return;
  }

  console.log("🥧 Building Pi Agent Server...");

  const entryPoint = join(PI_AGENT_SERVER_DIR, "src/index.ts");

  // Some checkouts only include prebuilt pi-agent-server dist artifacts.
  // If source is missing, fall back to the existing dist output.
  if (!existsSync(entryPoint)) {
    if (existsSync(PI_AGENT_SERVER_OUTPUT)) {
      console.log("ℹ️  Pi agent server source missing, using prebuilt dist/index.js");
      return;
    }

    // Create a stub so non-Pi builds can proceed.
    const stub = [
      "#!/usr/bin/env bun",
      "console.error('[pi-agent-server] Source missing in this checkout. Pi provider is unavailable.');",
      "process.exit(1);",
      "",
    ].join("\n");
    writeFileSync(PI_AGENT_SERVER_OUTPUT, stub, "utf-8");
    console.warn("⚠️  Pi agent server source missing; wrote stub dist/index.js (Pi provider disabled)");
    return;
  }

  // Ensure dist directory exists
  const distDir = join(PI_AGENT_SERVER_DIR, "dist");
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  // Use --target=bun --format=esm because the Pi SDK (@mariozechner/pi-coding-agent)
  // is ESM-only. --target=node --format=cjs leaves ESM deps as external require()
  // calls that fail at runtime since there are no node_modules relative to dist/.
  const proc = spawn({
    cmd: [
      "bun", "build",
      entryPoint,
      "--outfile", PI_AGENT_SERVER_OUTPUT,
      "--target", "bun",
      "--format", "esm",
      "--external", "koffi",
    ],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error("❌ Pi agent server build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  // Verify output exists
  if (!existsSync(PI_AGENT_SERVER_OUTPUT)) {
    console.error("❌ Pi agent server output not found at", PI_AGENT_SERVER_OUTPUT);
    process.exit(1);
  }

  console.log("✅ Pi agent server built successfully");
}

async function main(): Promise<void> {
  loadEnvFile();

  // Ensure dist directory exists
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  // Verify session tools core exists (shared utilities for session-scoped tools)
  verifySessionToolsCore();

  // Build session server (provides session-scoped tools like SubmitPlan)
  // Depends on session-tools-core being built first
  await buildSessionServer();

  // Build Pi agent server (subprocess for Pi SDK sessions)
  await buildPiAgentServer();

  // Build unified network interceptor (CJS bundle for Node.js --require)
  await buildInterceptor();

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
