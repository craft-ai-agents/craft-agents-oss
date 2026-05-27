/**
 * Node.js-compatible electron dev script (for Windows with tsx)
 * Use `pnpm electron:dev:win` to run this instead of the Bun version.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, rmSync, cpSync, readFileSync, statSync, mkdirSync } from "fs";
import { join, basename, dirname } from "path";
import * as esbuild from "esbuild";
import { downloadUv, downloadRtk, type Platform, type Arch } from "./build/common-node";

// ── Node.js shims replacing Bun-specific APIs ─────────────────────────────────

interface Subprocess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  exited: Promise<number>;
  kill: () => void;
}

function spawn(options: {
  cmd: string[];
  cwd?: string;
  stdin?: "pipe" | "ignore" | "inherit";
  stdout?: "pipe" | "ignore" | "inherit";
  stderr?: "pipe" | "ignore" | "inherit";
  env?: Record<string, string>;
}): Subprocess {
  const [cmd, ...args] = options.cmd;
  // .cmd files need shell:true to run on Windows; .exe files run directly
  const needsShell = process.platform === "win32" && cmd.endsWith(".cmd");
  const proc = nodeSpawn(cmd, args, {
    cwd: options.cwd,
    stdio: [options.stdin ?? "ignore", options.stdout ?? "pipe", options.stderr ?? "pipe"],
    env: options.env,
    shell: needsShell,
  });
  const exited = new Promise<number>((resolve) => {
    proc.on("close", (code) => resolve(code ?? 0));
    proc.on("error", (err) => {
      console.error(`❌ Failed to start process "${cmd}": ${err.message}`);
      resolve(1);
    });
  });
  return {
    stdout: proc.stdout as NodeJS.ReadableStream | null,
    stderr: proc.stderr as NodeJS.ReadableStream | null,
    exited,
    kill: () => proc.kill(),
  };
}

function streamToText(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = join(__dirname, "..");
const ELECTRON_DIR = join(ROOT_DIR, "apps/electron");
const DIST_DIR = join(ELECTRON_DIR, "dist");

// Replace grammY's bundled polyfills (node-fetch@2 + abort-controller@3) with
// native Node globals. esbuild otherwise renames the polyfill's `class
// AbortSignal` to `_AbortSignal` to dodge collision with the global, which
// breaks node-fetch@2's `constructor.name === 'AbortSignal'` check and fails
// every Telegram API call with a TypeError. Kept in sync with
// `apps/electron/package.json` build:main and `scripts/electron-build-main.ts`.
const MAIN_PROCESS_ALIAS: Record<string, string> = {
  "node-fetch": join(ROOT_DIR, "apps/electron/src/main/shims/node-fetch.cjs"),
  "abort-controller": join(ROOT_DIR, "apps/electron/src/main/shims/abort-controller.cjs"),
};

// MCP server paths
const SESSION_SERVER_DIR = join(ROOT_DIR, "packages/session-mcp-server");
const SESSION_SERVER_OUTPUT = join(SESSION_SERVER_DIR, "dist/index.js");
// Pi agent server path (subprocess for Pi SDK sessions)
const PI_AGENT_SERVER_DIR = join(ROOT_DIR, "packages/pi-agent-server");
const PI_AGENT_SERVER_OUTPUT = join(PI_AGENT_SERVER_DIR, "dist/index.js");

// Platform-specific binary paths
const IS_WINDOWS = process.platform === "win32";

// On Windows, pnpm may create either a .exe shim or a .cmd wrapper.
// Check .exe first (same as original electron-dev.ts), fall back to .cmd.
function resolveWinBin(name: string): string {
  const exePath = join(ROOT_DIR, `node_modules/.bin/${name}.exe`);
  if (existsSync(exePath)) return exePath;
  return join(ROOT_DIR, `node_modules/.bin/${name}.cmd`);
}

const VITE_BIN = IS_WINDOWS
  ? resolveWinBin("vite")
  : join(ROOT_DIR, "node_modules/.bin/vite");
const ELECTRON_BIN = IS_WINDOWS
  ? resolveWinBin("electron")
  : join(ROOT_DIR, "node_modules/.bin/electron");

function resolveBuildPlatform(): Platform {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  if (process.platform === "linux") return "linux";
  throw new Error(`Unsupported platform for uv bootstrap: ${process.platform}`);
}

function resolveBuildArch(): Arch {
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x64";
  throw new Error(`Unsupported architecture for uv bootstrap: ${process.arch}`);
}

async function ensureBundledUvForCurrentPlatform(): Promise<void> {
  const platform = resolveBuildPlatform();
  const arch = resolveBuildArch();
  const platformKey = `${platform}-${arch}`;
  const uvBinary = platform === "win32" ? "uv.exe" : "uv";
  const uvPath = join(ELECTRON_DIR, "resources", "bin", platformKey, uvBinary);

  if (existsSync(uvPath)) {
    console.log(`✅ Bundled uv present: ${uvPath}`);
    return;
  }

  console.log(`⬇️  Bundled uv missing, bootstrapping ${platformKey}...`);
  await downloadUv({
    platform,
    arch,
    upload: false,
    uploadLatest: false,
    uploadScript: false,
    rootDir: ROOT_DIR,
    electronDir: ELECTRON_DIR,
  });
}

async function ensureBundledRtkForCurrentPlatform(): Promise<void> {
  const platform = resolveBuildPlatform();
  const arch = resolveBuildArch();
  const platformKey = `${platform}-${arch}`;
  const rtkBinary = platform === "win32" ? "rtk.exe" : "rtk";
  const rtkPath = join(ELECTRON_DIR, "resources", "bin", platformKey, rtkBinary);

  if (existsSync(rtkPath)) {
    console.log(`✅ Bundled rtk present: ${rtkPath}`);
    return;
  }

  console.log(`⬇️  Bundled rtk missing, bootstrapping ${platformKey}...`);
  await downloadRtk({
    platform,
    arch,
    upload: false,
    uploadLatest: false,
    uploadScript: false,
    rootDir: ROOT_DIR,
    electronDir: ELECTRON_DIR,
  });
}

// Multi-instance detection (matches detect-instance.sh logic)
function detectInstance(): void {
  if (process.env.CRAFT_VITE_PORT) return;

  const folderName = basename(ROOT_DIR);
  const match = folderName.match(/-(\d+)$/);

  if (match) {
    const instanceNum = match[1];
    process.env.CRAFT_INSTANCE_NUMBER = instanceNum;
    process.env.CRAFT_VITE_PORT = `${instanceNum}173`;
    process.env.CRAFT_APP_NAME = `MDP [${instanceNum}]`;
    process.env.CRAFT_CONFIG_DIR = join(process.env.HOME || "", `.mdp-agent-${instanceNum}`);
    process.env.CRAFT_DEEPLINK_SCHEME = `mdp${instanceNum}`;
    console.log(`🔢 Instance ${instanceNum} detected: port=${process.env.CRAFT_VITE_PORT}, config=${process.env.CRAFT_CONFIG_DIR}`);
  }
}

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
          // Remove surrounding quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          process.env[key] = value;
        }
      }
    }
    console.log("📄 Loaded .env file");
  }
}

// Kill any process using the specified port
async function killProcessOnPort(port: string): Promise<void> {
  const isWindows = process.platform === "win32";

  try {
    if (isWindows) {
      const netstat = spawn({
        cmd: ["cmd", "/c", `netstat -ano | findstr :${port}`],
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await streamToText(netstat.stdout);
      await netstat.exited;

      const pids = new Set<string>();
      for (const line of output.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== "0") {
            pids.add(pid);
          }
        }
      }

      for (const pid of pids) {
        const kill = spawn({
          cmd: ["taskkill", "/PID", pid, "/F"],
          stdout: "pipe",
          stderr: "pipe",
        });
        await kill.exited;
      }

      if (pids.size > 0) {
        console.log(`🔪 Killed ${pids.size} process(es) on port ${port}`);
      }
    } else {
      const lsof = spawn({
        cmd: ["sh", "-c", `lsof -ti:${port} | xargs kill -9 2>/dev/null || true`],
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await streamToText(lsof.stdout);
      await lsof.exited;

      if (output.trim()) {
        console.log(`🔪 Killed process(es) on port ${port}`);
      }
    }
  } catch {
    // Ignore errors - port may not be in use
  }
}

async function readSubprocessOutput(proc: Subprocess): Promise<string> {
  if (!proc.stdout) return "";
  try {
    return await streamToText(proc.stdout);
  } catch {
    return "";
  }
}

async function findProcessIds(pattern: string): Promise<number[]> {
  if (process.platform === "win32") {
    return [];
  }

  try {
    const proc = spawn({
      cmd: ["pgrep", "-f", pattern],
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await readSubprocessOutput(proc);
    await proc.exited;
    return output
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function killProcessIds(pids: number[], label: string): Promise<void> {
  const uniquePids = [...new Set(pids)]
    .filter((pid) => pid !== process.pid && pid !== process.ppid);

  if (uniquePids.length === 0) return;

  for (const pid of uniquePids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may already be dead.
    }
  }

  await sleep(750);

  for (const pid of uniquePids) {
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
    } catch {
      // Process exited after SIGTERM.
    }
  }

  console.log(`🔪 Killed stale ${label}: ${uniquePids.join(", ")}`);
}

async function cleanupExistingElectronDevInstances(): Promise<void> {
  if (process.platform === "win32") {
    try {
      const kill = spawn({
        cmd: ["taskkill", "/F", "/IM", "electron.exe"],
        stdout: "pipe",
        stderr: "pipe",
      });
      await kill.exited;
      console.log("🔪 Killed stale electron.exe process(es)");
    } catch {
      // No electron.exe running — ignore.
    }
    return;
  }

  const escapedRoot = ROOT_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pids = await Promise.all([
    findProcessIds(`${escapedRoot}.*node_modules/.bin/electron apps/electron`),
    findProcessIds(`${escapedRoot}.*node_modules/electron/dist/Electron\\.app/Contents/MacOS/Electron apps/electron`),
  ]);

  await killProcessIds(pids.flat(), "Electron dev process(es)");
}

// Clean Vite cache directory
function cleanViteCache(): void {
  const viteCacheDir = join(ELECTRON_DIR, "node_modules/.vite");
  if (existsSync(viteCacheDir)) {
    rmSync(viteCacheDir, { recursive: true, force: true });
    console.log("🧹 Cleaned Vite cache");
  }
}

// Copy resources to dist
function copyResources(): void {
  const srcDir = join(ELECTRON_DIR, "resources");
  const destDir = join(ELECTRON_DIR, "dist/resources");
  if (existsSync(srcDir)) {
    cpSync(srcDir, destDir, { recursive: true, force: true });
    console.log("📦 Copied resources to dist");
  }
}

// Build MCP servers for Codex sessions and Pi agent server (one-time, no watch needed)
async function buildMcpServers(): Promise<void> {
  console.log("🌉 Building MCP servers and Pi agent server...");

  const sessionDistDir = join(SESSION_SERVER_DIR, "dist");
  const piDistDir = join(PI_AGENT_SERVER_DIR, "dist");
  if (!existsSync(sessionDistDir)) mkdirSync(sessionDistDir, { recursive: true });
  if (!existsSync(piDistDir)) mkdirSync(piDistDir, { recursive: true });

  const sessionResult = await runEsbuild(
    "packages/session-mcp-server/src/index.ts",
    "packages/session-mcp-server/dist/index.js",
    {},
    { packagesExternal: true }
  );

  if (!sessionResult.success) {
    console.error("❌ Session MCP server build failed:", sessionResult.error);
    process.exit(1);
  }
  console.log("✅ Session MCP server built");

  if (existsSync(join(PI_AGENT_SERVER_DIR, "src"))) {
    const piResult = await buildPiAgentServer();
    if (!piResult.success) {
      console.error("❌ Pi agent server build failed:", piResult.error);
      process.exit(1);
    }
    console.log("✅ Pi agent server built");
  } else {
    console.log("⏭️  Pi agent server skipped (package not found)");
  }
}

// Get OAuth defines for esbuild API
function getOAuthDefines(): Record<string, string> {
  const oauthVars = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "SLACK_OAUTH_CLIENT_ID",
    "SLACK_OAUTH_CLIENT_SECRET",
    "MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_SECRET",
  ];

  const defines: Record<string, string> = {};
  for (const varName of oauthVars) {
    const value = process.env[varName] || "";
    defines[`process.env.${varName}`] = JSON.stringify(value);
  }
  return defines;
}

// Get environment variables for electron process
function getElectronEnv(): Record<string, string> {
  const vitePort = process.env.CRAFT_VITE_PORT || "5173";

  return {
    ...process.env as Record<string, string>,
    VITE_DEV_SERVER_URL: `http://localhost:${vitePort}`,
    CRAFT_CONFIG_DIR: process.env.CRAFT_CONFIG_DIR || "",
    CRAFT_APP_NAME: process.env.CRAFT_APP_NAME || "MDP",
    CRAFT_DEEPLINK_SCHEME: process.env.CRAFT_DEEPLINK_SCHEME || "mdp",
    CRAFT_INSTANCE_NUMBER: process.env.CRAFT_INSTANCE_NUMBER || "",
  };
}

// Run a one-shot esbuild using the JavaScript API
async function runEsbuild(
  entryPoint: string,
  outfile: string,
  defines: Record<string, string> = {},
  options: { packagesExternal?: boolean; alias?: Record<string, string> } = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    await esbuild.build({
      entryPoints: [join(ROOT_DIR, entryPoint)],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: join(ROOT_DIR, outfile),
      external: ["electron"],
      ...(options.packagesExternal ? { packages: "external" as const } : {}),
      ...(options.alias ? { alias: options.alias } : {}),
      define: defines,
      logLevel: "warning",
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Build Pi agent server using bun (ESM-only Pi SDK requires bun bundler)
async function buildPiAgentServer(): Promise<{ success: boolean; error?: string }> {
  try {
    const proc = spawn({
      cmd: ["bun", "build", "src/index.ts", "--outdir=dist", "--target=bun", "--format=esm"],
      cwd: PI_AGENT_SERVER_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await streamToText(proc.stderr);
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return { success: false, error: stderr };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function verifyJsFile(filePath: string): Promise<{ valid: boolean; error?: string }> {
  if (!existsSync(filePath)) {
    return { valid: false, error: "File does not exist" };
  }

  const stats = statSync(filePath);
  if (stats.size === 0) {
    return { valid: false, error: "File is empty" };
  }

  try {
    const proc = spawn({
      cmd: ["node", "--check", filePath],
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await streamToText(proc.stderr);
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return { valid: false, error: stderr.trim() || `node --check exited ${exitCode}` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}

// Wait for file to stabilize (no size changes)
async function waitForFileStable(filePath: string, timeoutMs = 10000): Promise<boolean> {
  const startTime = Date.now();
  let lastSize = -1;
  let stableCount = 0;

  while (Date.now() - startTime < timeoutMs) {
    if (!existsSync(filePath)) {
      await sleep(100);
      continue;
    }

    const stats = statSync(filePath);
    if (stats.size === lastSize) {
      stableCount++;
      // File size unchanged for 3 checks (300ms) - consider it stable
      if (stableCount >= 3) {
        return true;
      }
    } else {
      stableCount = 0;
      lastSize = stats.size;
    }

    await sleep(100);
  }

  return false;
}

async function main(): Promise<void> {
  console.log("🚀 Starting Electron dev environment...\n");

  detectInstance();
  loadEnvFile();

  // Verify critical binaries exist before proceeding
  if (IS_WINDOWS) {
    if (!existsSync(VITE_BIN)) {
      console.error(`❌ Vite binary not found at: ${VITE_BIN}`);
      console.error("   Run: pnpm install");
      process.exit(1);
    }
    if (!existsSync(ELECTRON_BIN)) {
      console.error(`❌ Electron binary not found at: ${ELECTRON_BIN}`);
      console.error("   Run: pnpm install");
      process.exit(1);
    }
    console.log(`🔧 Vite:     ${VITE_BIN}`);
    console.log(`🔧 Electron: ${ELECTRON_BIN}`);
  }
  cleanViteCache();

  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  await ensureBundledUvForCurrentPlatform();
  await ensureBundledRtkForCurrentPlatform();

  copyResources();
  await buildMcpServers();

  const vitePort = process.env.CRAFT_VITE_PORT || "5173";
  const oauthDefines = getOAuthDefines();

  await cleanupExistingElectronDevInstances();
  await killProcessOnPort(vitePort);

  // =========================================================
  // PHASE 1: Initial build (one-shot, wait for completion)
  // =========================================================
  console.log("🔨 Building main process...");

  const mainCjsPath = join(DIST_DIR, "main.cjs");
  const preloadCjsPath = join(DIST_DIR, "bootstrap-preload.cjs");
  const toolbarPreloadCjsPath = join(DIST_DIR, "browser-toolbar-preload.cjs");

  if (existsSync(mainCjsPath)) rmSync(mainCjsPath);
  if (existsSync(preloadCjsPath)) rmSync(preloadCjsPath);
  if (existsSync(toolbarPreloadCjsPath)) rmSync(toolbarPreloadCjsPath);

  const [mainResult, preloadResult, toolbarPreloadResult] = await Promise.all([
    runEsbuild(
      "apps/electron/src/main/index.ts",
      "apps/electron/dist/main.cjs",
      oauthDefines,
      { alias: MAIN_PROCESS_ALIAS }
    ),
    runEsbuild(
      "apps/electron/src/preload/bootstrap.ts",
      "apps/electron/dist/bootstrap-preload.cjs"
    ),
    runEsbuild(
      "apps/electron/src/preload/browser-toolbar.ts",
      "apps/electron/dist/browser-toolbar-preload.cjs"
    ),
  ]);

  if (!mainResult.success) {
    console.error("❌ Main process build failed:", mainResult.error);
    process.exit(1);
  }
  if (!preloadResult.success) {
    console.error("❌ Preload build failed:", preloadResult.error);
    process.exit(1);
  }
  if (!toolbarPreloadResult.success) {
    console.error("❌ Browser toolbar preload build failed:", toolbarPreloadResult.error);
    process.exit(1);
  }

  console.log("⏳ Waiting for build files to stabilize...");
  const [mainStable, preloadStable, toolbarPreloadStable] = await Promise.all([
    waitForFileStable(mainCjsPath),
    waitForFileStable(preloadCjsPath),
    waitForFileStable(toolbarPreloadCjsPath),
  ]);

  if (!mainStable || !preloadStable || !toolbarPreloadStable) {
    console.error("❌ Build files did not stabilize");
    process.exit(1);
  }

  console.log("🔍 Verifying build output...");
  const [mainValid, preloadValid, toolbarPreloadValid] = await Promise.all([
    verifyJsFile(mainCjsPath),
    verifyJsFile(preloadCjsPath),
    verifyJsFile(toolbarPreloadCjsPath),
  ]);

  if (!mainValid.valid) {
    console.error("❌ main.cjs is invalid:", mainValid.error);
    process.exit(1);
  }
  if (!preloadValid.valid) {
    console.error("❌ bootstrap-preload.cjs is invalid:", preloadValid.error);
    process.exit(1);
  }
  if (!toolbarPreloadValid.valid) {
    console.error("❌ browser-toolbar-preload.cjs is invalid:", toolbarPreloadValid.error);
    process.exit(1);
  }

  console.log("✅ Initial build complete and verified\n");

  // =========================================================
  // PHASE 2: Start dev servers with watch mode
  // =========================================================
  console.log("📡 Starting dev servers...\n");

  const processes: Subprocess[] = [];
  const esbuildContexts: esbuild.BuildContext[] = [];

  // 1. Vite dev server
  const viteProc = spawn({
    cmd: [VITE_BIN, "dev", "--config", "apps/electron/vite.config.ts", "--port", vitePort, "--strictPort"],
    cwd: ROOT_DIR,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env as Record<string, string>,
  });
  processes.push(viteProc);

  // 2. Main process watcher
  const mainContext = await esbuild.context({
    entryPoints: [join(ROOT_DIR, "apps/electron/src/main/index.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(ROOT_DIR, "apps/electron/dist/main.cjs"),
    external: ["electron"],
    alias: MAIN_PROCESS_ALIAS,
    define: oauthDefines,
    logLevel: "info",
  });
  await mainContext.watch();
  esbuildContexts.push(mainContext);
  console.log("👀 Watching main process...");

  // 3. Preload watcher
  const preloadContext = await esbuild.context({
    entryPoints: [join(ROOT_DIR, "apps/electron/src/preload/bootstrap.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(ROOT_DIR, "apps/electron/dist/bootstrap-preload.cjs"),
    external: ["electron"],
    logLevel: "info",
  });
  await preloadContext.watch();
  esbuildContexts.push(preloadContext);
  console.log("👀 Watching preload...");

  // 4. Browser toolbar preload watcher
  const toolbarPreloadContext = await esbuild.context({
    entryPoints: [join(ROOT_DIR, "apps/electron/src/preload/browser-toolbar.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(ROOT_DIR, "apps/electron/dist/browser-toolbar-preload.cjs"),
    external: ["electron"],
    logLevel: "info",
  });
  await toolbarPreloadContext.watch();
  esbuildContexts.push(toolbarPreloadContext);
  console.log("👀 Watching browser toolbar preload...");

  // 5. Start Electron
  console.log("🚀 Starting Electron...\n");

  const electronProc = spawn({
    cmd: [ELECTRON_BIN, "apps/electron"],
    cwd: ROOT_DIR,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: getElectronEnv(),
  });
  processes.push(electronProc);

  const cleanup = async () => {
    console.log("\n🛑 Shutting down...");
    for (const ctx of esbuildContexts) {
      try { await ctx.dispose(); } catch { /* already disposed */ }
    }
    for (const proc of processes) {
      try { proc.kill(); } catch { /* already dead */ }
    }
    process.exit(0);
  };

  process.on("SIGINT", () => cleanup());
  process.on("SIGTERM", () => cleanup());
  if (process.platform === "win32") {
    process.on("SIGHUP", () => cleanup());
  }

  const exitedProcess = await Promise.race([
    electronProc.exited.then((exitCode) => ({ name: "Electron", exitCode })),
    viteProc.exited.then((exitCode) => ({ name: "Vite", exitCode })),
  ]);

  if (exitedProcess.name === "Vite") {
    console.error(`❌ Vite dev server exited unexpectedly (${exitedProcess.exitCode}); stopping Electron dev.`);
  }

  await cleanup();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
