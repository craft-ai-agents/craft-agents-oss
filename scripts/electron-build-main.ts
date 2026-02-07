/**
 * Cross-platform main process build script
 * Loads .env and passes OAuth defines to esbuild
 */

import { spawn } from "bun";
import { existsSync, readFileSync, statSync, mkdirSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");
const DIST_DIR = join(ROOT_DIR, "apps/electron/dist");
const OUTPUT_FILE = join(DIST_DIR, "main.cjs");
const BRIDGE_SERVER_DIR = join(ROOT_DIR, "packages/bridge-mcp-server");
const BRIDGE_SERVER_OUTPUT = join(BRIDGE_SERVER_DIR, "dist/index.js");
const SESSION_TOOLS_CORE_DIR = join(ROOT_DIR, "packages/session-tools-core");
const SESSION_SERVER_DIR = join(ROOT_DIR, "packages/session-mcp-server");
const SESSION_SERVER_OUTPUT = join(SESSION_SERVER_DIR, "dist/index.js");

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

// Build the Bridge MCP Server (used for API sources in Codex sessions)
async function buildBridgeServer(): Promise<void> {
  console.log("🌉 Building Bridge MCP Server...");

  // Ensure dist directory exists
  const distDir = join(BRIDGE_SERVER_DIR, "dist");
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  const proc = spawn({
    cmd: [
      "bun", "build",
      join(BRIDGE_SERVER_DIR, "src/index.ts"),
      "--outfile", BRIDGE_SERVER_OUTPUT,
      "--target", "node",
      "--format", "cjs",
    ],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error("❌ Bridge server build failed with exit code", exitCode);
    process.exit(exitCode);
  }

  // Verify output exists
  if (!existsSync(BRIDGE_SERVER_OUTPUT)) {
    console.error("❌ Bridge server output not found at", BRIDGE_SERVER_OUTPUT);
    process.exit(1);
  }

  console.log("✅ Bridge server built successfully");
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

async function main(): Promise<void> {
  loadEnvFile();

  // Ensure dist directory exists
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  // Verify session tools core exists (shared utilities for session-scoped tools)
  verifySessionToolsCore();

  // Build bridge server (needed for API sources in Codex sessions)
  await buildBridgeServer();

  // Build session server (provides session-scoped tools like SubmitPlan for Codex sessions)
  // Depends on session-tools-core being built first
  await buildSessionServer();

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
