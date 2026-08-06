import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import type { BackendHostRuntimeContext } from '../types.ts';
import { setPathToClaudeCodeExecutable } from '../../options.ts';

/**
 * When set, the resolver walks further up from the .app bundle to find SDK,
 * interceptor, and bun in the monorepo / on the system PATH.
 * Intended for local `electron:dist:mac` builds that skip `build-dmg.sh`.
 */
const IS_DEV_RUNTIME = !!process.env.CRAFT_DEV_RUNTIME;

export interface ResolvedBackendRuntimePaths {
  /**
   * Absolute path to the native `claude` binary (since SDK 0.2.113).
   * In packaged builds this is the per-platform binary copied out of
   * `node_modules/@anthropic-ai/claude-agent-sdk-{platform}-{arch}/`.
   * Field is named `claudeCliPath` for back-compat — semantically it is
   * the SDK executable, JS or native.
   */
  claudeCliPath?: string;
  /**
   * Source/bundle path for the network interceptor preloaded into the **Pi**
   * subprocess. Not used for Claude anymore — the new native SDK binary
   * doesn't accept `--preload`.
   */
  interceptorBundlePath?: string;
  sessionServerPath?: string;
  bridgeServerPath?: string;
  piServerPath?: string;
  nodeRuntimePath?: string;
  bundledRuntimePath?: string;
}

export interface ResolvedBackendHostTooling {
  ripgrepPath?: string;
}

function firstExistingPath(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Walk up from `base` checking `join(ancestor, relativePath)` at each level.
 * Stops after `maxLevels` ancestors or when hitting the filesystem root.
 */
function resolveUpwards(base: string, relativePath: string, maxLevels = 4): string | undefined {
  let dir = resolve(base);
  for (let i = 0; i <= maxLevels; i++) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return undefined;
}

function resolveBundledRuntimePath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  const bunBinary = process.platform === 'win32' ? 'bun.exe' : 'bun';
  const bunBasePath = process.platform === 'win32'
    ? (hostRuntime.resourcesPath || hostRuntime.appRootPath)
    : hostRuntime.appRootPath;
  const bunPath = join(bunBasePath, 'vendor', 'bun', bunBinary);
  if (existsSync(bunPath)) return bunPath;

  // Non-packaged (headless server, dev mode): fall back to system bun via PATH.
  // Packaged apps must ship their own bundled bun — never resolve from PATH
  // to avoid picking up an incompatible system install.
  if (!hostRuntime.isPackaged) {
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const systemBun = execFileSync(whichCmd, ['bun'], { encoding: 'utf-8' }).trim();
      if (systemBun && existsSync(systemBun)) return systemBun;
    } catch { /* system bun not found */ }
  }
  return undefined;
}

/**
 * Compute the per-platform optional-dependency package name shipped by the
 * Claude Agent SDK (since 0.2.113), e.g. `claude-agent-sdk-darwin-arm64`.
 *
 * NOTE on Linux musl: this returns the glibc variant. AppImage targets glibc
 * and that is the only Linux flavour we ship for the desktop app. The headless
 * server in Docker (which may run on Alpine/musl) is a separate concern —
 * track in Phase 2 when we look at server packaging.
 */
function platformBinaryPkg(): string | undefined {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'darwin') return `claude-agent-sdk-darwin-${arch}`;
  if (process.platform === 'win32') return `claude-agent-sdk-win32-${arch}`;
  if (process.platform === 'linux') return `claude-agent-sdk-linux-${arch}`;
  return undefined;
}

function nativeBinaryName(): string {
  return process.platform === 'win32' ? 'claude.exe' : 'claude';
}

/**
 * Resolve the per-platform native `claude` binary shipped by the SDK as an
 * optional dependency. Replaces the old `cli.js` lookup (SDK ≥ 0.2.113).
 *
 * Search order:
 *   1. Stable build alias `@anthropic-ai/claude-agent-sdk-binary` — this is
 *      what the platform build scripts (build-dmg.sh etc.) populate before
 *      electron-builder runs, so packaged builds always find the binary at a
 *      single, arch-agnostic path regardless of how it was sourced.
 *   2. Per-platform optional-dep package name (`-darwin-arm64`, etc.) —
 *      what plain `bun install` produces in dev / monorepo / CI.
 *   3. Dev-runtime walk-up across both lookups for ad-hoc local builds
 *      (`electron:dist:dev:mac`).
 */
function resolveClaudeBinaryPath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  const binaryName = nativeBinaryName();
  const aliasRel = join('node_modules', '@anthropic-ai', 'claude-agent-sdk-binary', binaryName);
  const pkg = platformBinaryPkg();
  const platformRel = pkg
    ? join('node_modules', '@anthropic-ai', pkg, binaryName)
    : undefined;

  const candidates: string[] = [
    join(hostRuntime.appRootPath, aliasRel),
    join(hostRuntime.appRootPath, '..', '..', aliasRel),
  ];
  if (platformRel) {
    candidates.push(
      join(hostRuntime.appRootPath, platformRel),
      join(hostRuntime.appRootPath, '..', '..', platformRel),
    );
  }

  const result = firstExistingPath(candidates);
  if (result) return result;

  // Dev runtime: walk further up from .app bundle to reach monorepo root
  if (IS_DEV_RUNTIME) {
    return resolveUpwards(hostRuntime.appRootPath, aliasRel, 10)
      ?? (platformRel ? resolveUpwards(hostRuntime.appRootPath, platformRel, 10) : undefined);
  }
  return undefined;
}

function resolveInterceptorBundlePath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  if (hostRuntime.interceptorBundlePath && existsSync(hostRuntime.interceptorBundlePath)) {
    return hostRuntime.interceptorBundlePath;
  }

  // In dev / monorepo runs, prefer the TypeScript source so changes are
  // picked up without a manual `bun run build:interceptor`. Bun handles
  // `--require <file>.ts` natively. Packaged builds always go through the
  // pre-built `dist/interceptor.cjs` bundle.
  if (!hostRuntime.isPackaged) {
    const source = resolveUpwards(
      hostRuntime.appRootPath,
      join('packages', 'shared', 'src', 'unified-network-interceptor.ts'),
      10,
    );
    if (source) return source;
  }

  return resolveUpwards(hostRuntime.appRootPath, join('dist', 'interceptor.cjs'))
    ?? resolveUpwards(hostRuntime.appRootPath, join('apps', 'electron', 'dist', 'interceptor.cjs'));
}

function resolveServerPath(hostRuntime: BackendHostRuntimeContext, serverName: string): string | undefined {
  if (hostRuntime.isPackaged) {
    return firstExistingPath([
      join(hostRuntime.appRootPath, 'resources', serverName, 'index.js'),
      join(hostRuntime.appRootPath, 'dist', 'resources', serverName, 'index.js'),
    ]);
  }
  return resolveUpwards(
    hostRuntime.appRootPath,
    join('packages', serverName, 'dist', 'index.js'),
  );
}

/**
 * Locate ripgrep. Sourced from `@vscode/ripgrep` since SDK 0.2.113 stopped
 * shipping `vendor/ripgrep/<platform>/rg` (the binary is now compiled into
 * the native `claude` executable, but our search service in
 * `packages/server-core/src/services/search.ts` still calls it directly).
 */
function resolveRipgrepPath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const ripgrepRelative = join('node_modules', '@vscode', 'ripgrep', 'bin', binaryName);

  if (hostRuntime.isPackaged) {
    const packaged = join(hostRuntime.appRootPath, ripgrepRelative);
    if (existsSync(packaged)) return packaged;
  }

  const fromHostRoot = resolveUpwards(hostRuntime.appRootPath, ripgrepRelative, 10);
  if (fromHostRoot) return fromHostRoot;

  const cwdFallback = join(process.cwd(), ripgrepRelative);
  if (existsSync(cwdFallback)) return cwdFallback;

  // Non-packaged (headless server, dev mode): fall back to system rg via PATH.
  // Packaged apps must use vendored binary only — never resolve from PATH
  // to avoid picking up an incompatible system install.
  if (!hostRuntime.isPackaged) {
    try {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const systemRg = execFileSync(whichCmd, ['rg'], { encoding: 'utf-8' }).trim();
      if (systemRg && existsSync(systemRg)) return systemRg;
    } catch { /* system rg not found */ }
  }

  return undefined;
}

export function resolveBackendRuntimePaths(hostRuntime: BackendHostRuntimeContext): ResolvedBackendRuntimePaths {
  const bundledRuntimePath = hostRuntime.nodeRuntimePath || resolveBundledRuntimePath(hostRuntime);

  return {
    claudeCliPath: resolveClaudeBinaryPath(hostRuntime),
    interceptorBundlePath: resolveInterceptorBundlePath(hostRuntime),
    sessionServerPath: resolveServerPath(hostRuntime, 'session-mcp-server'),
    bridgeServerPath: resolveServerPath(hostRuntime, 'bridge-mcp-server'),
    piServerPath: resolveServerPath(hostRuntime, 'pi-agent-server'),
    nodeRuntimePath: hostRuntime.nodeRuntimePath || bundledRuntimePath || process.execPath,
    bundledRuntimePath,
  };
}

export function resolveBackendHostTooling(hostRuntime: BackendHostRuntimeContext): ResolvedBackendHostTooling {
  return {
    ripgrepPath: resolveRipgrepPath(hostRuntime),
  };
}

/**
 * Configure SDK globals from host runtime context.
 *
 * Since SDK 0.2.113 the SDK spawns a native binary; the only override we
 * need is `pathToClaudeCodeExecutable`. The Bun executable / `--preload`
 * interceptor mechanism that used to live here no longer applies — the
 * binary doesn't accept Bun-specific flags.
 *
 * When `strict` is true (default), throws if the SDK binary can't be found.
 * When `strict` is false, missing paths are silently skipped (the SDK will
 * try its own auto-discovery via optional-dep node_modules resolution).
 */
export function applyAnthropicRuntimeBootstrap(
  hostRuntime: BackendHostRuntimeContext,
  paths: ResolvedBackendRuntimePaths,
  options?: { strict?: boolean },
): void {
  const strict = options?.strict ?? true;

  if (paths.claudeCliPath) {
    setPathToClaudeCodeExecutable(paths.claudeCliPath);
  } else if (strict) {
    throw new Error('Claude Agent SDK native binary not found. The app package may be corrupted.');
  }
}
