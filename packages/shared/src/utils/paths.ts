/**
 * Path Portability Utilities
 *
 * Functions for making filesystem paths portable across machines.
 * Supports ~, ${HOME}, ${CRAFT_CONFIG_DIR}, and caller-provided variables
 * for cross-machine compatibility.
 */

import { homedir } from 'os';
import { resolve, join, normalize, isAbsolute } from 'path';
import { existsSync } from 'fs';
import { CONFIG_DIR } from '../config/paths';

/**
 * Extra path variables that callers can provide for context-aware expansion.
 * Values should be absolute paths.
 */
export interface PathVars {
  [key: string]: string;
}

/**
 * Expand ONLY variable references (~, ${HOME}, ${CRAFT_CONFIG_DIR}, caller vars)
 * without converting relative paths to absolute.
 *
 * Use this for values where bare strings like "true", "dart", or "production"
 * should pass through unchanged — e.g. env values, command names, args.
 *
 * For file/folder paths where relative paths should be resolved to absolute,
 * use `expandPath()` instead.
 *
 * @param input - String that may contain variables
 * @param extraVars - Additional named variables
 * @returns String with variables substituted; non-variable strings unchanged
 *
 * @example
 * expandVars('dart')                 // 'dart' (unchanged — bare command)
 * expandVars('true')                 // 'true' (unchanged — env flag)
 * expandVars('${HOME}/.venv/bin/python')  // '/Users/alice/.venv/bin/python'
 * expandVars('${SOURCE_DIR}/server.js', { SOURCE_DIR: '/app/foo' })  // '/app/foo/server.js'
 */
export function expandVars(input: string, extraVars?: PathVars): string {
  if (!input) return input;

  let result = input;
  const home = homedir();

  // Handle ~ alone
  if (result === '~') return home;

  // Handle ~/ prefix
  if (result.startsWith('~/')) {
    result = join(home, result.slice(2));
  }

  // Handle ${HOME} and $HOME variables
  result = result.replace(/\$\{HOME\}/g, home);
  result = result.replace(/\$HOME(?=\/|$)/g, home);

  // Handle ${CRAFT_CONFIG_DIR} — centralized config directory
  result = result.replace(/\$\{CRAFT_CONFIG_DIR\}/g, CONFIG_DIR);

  // Handle caller-provided extra variables
  if (extraVars) {
    for (const [key, value] of Object.entries(extraVars)) {
      if (!value) continue;
      result = result.replace(new RegExp(`\\$\{${key}\}`, 'g'), value);
      result = result.replace(new RegExp(`\\$${key}(?=/|$)`, 'g'), value);
    }
  }

  return result;
}

/**
 * Expand path variables (~, ${HOME}, $HOME, ${CRAFT_CONFIG_DIR}, and caller-provided vars)
 * to absolute paths. Relative paths are resolved against basePath (defaults to cwd).
 *
 * Use this for file/folder paths only — NOT for env values or command names.
 * For env values, command names, and args, use `expandVars()` instead.
 *
 * @param inputPath - Path that may contain variables
 * @param basePath - Base path for relative path resolution (defaults to cwd)
 * @param extraVars - Additional named variables (e.g. { WORKSPACE: '/path', SOURCE_DIR: '/path' })
 * @returns Absolute path with all variables expanded
 */
export function expandPath(inputPath: string, basePath?: string, extraVars?: PathVars): string {
  if (!inputPath) return inputPath;

  // First do variable-only expansion
  let expanded = expandVars(inputPath, extraVars);

  // Then resolve relative paths to absolute
  if (!isAbsolute(expanded)) {
    const base = basePath || process.cwd();
    expanded = resolve(base, expanded);
  }

  return normalize(expanded);
}

/**
 * Resolved stdio config after platform overrides and variable expansion.
 */
export interface ResolvedStdioConfig {
  command: string;
  args: string[];
  env: Record<string, string> | undefined;
}

/**
 * Resolve a stdio MCP config for the current platform.
 *
 * Applies platform overrides (command replaces, args replace, env merges),
 * then expands path variables (${HOME}, ${CRAFT_CONFIG_DIR}, ${WORKSPACE},
 * ${SOURCE_DIR}) at runtime — never mutating the original config.
 *
 * @param mcp - The raw MCP config from config.json
 * @param workspacePath - Workspace root path
 * @param sourceDir - This source's folder path
 * @returns Resolved command, args, and env with variables expanded
 */
export function resolveStdioConfig(
  mcp: { command?: string; args?: string[]; env?: Record<string, string>; platform?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> },
  workspacePath: string,
  sourceDir: string,
): ResolvedStdioConfig | null {
  if (!mcp.command) return null;

  const vars: PathVars = {
    WORKSPACE: workspacePath,
    SOURCE_DIR: sourceDir,
  };

  // Start with defaults
  let command = mcp.command;
  let args = mcp.args || [];
  let env = mcp.env ? { ...mcp.env } : undefined;

  // Apply platform override if present
  const platformKey = process.platform as string;
  const override = mcp.platform?.[platformKey];
  if (override) {
    if (override.command) command = override.command;
    if (override.args) args = override.args;
    if (override.env) env = { ...(env || {}), ...override.env };
  }

  return {
    command: expandVars(command, vars),
    args: args.map(a => expandVars(a, vars)),
    env: env
      ? Object.fromEntries(
          Object.entries(env).map(([k, v]) => [k, expandVars(v, vars)])
        )
      : undefined,
  };
}

/**
 * Convert absolute path to portable form.
 * If path is within home directory, converts to ~ prefix.
 *
 * @param absolutePath - Absolute path to convert
 * @returns Portable path (with ~ prefix if in home) or original if outside home
 *
 * @example
 * toPortablePath('/Users/alice')           // '~'
 * toPortablePath('/Users/alice/Documents') // '~/Documents'
 * toPortablePath('/var/log')               // '/var/log' (unchanged)
 */
export function toPortablePath(absolutePath: string): string {
  if (!absolutePath) return absolutePath;

  const home = homedir();
  const normalized = normalize(absolutePath);

  // Exact match with home directory
  if (normalized === home) {
    return '~';
  }

  // Path within home directory (handle both Unix and Windows separators)
  const homePrefix = home + '/';
  const homePrefixWin = home + '\\';

  if (normalized.startsWith(homePrefix)) {
    return '~/' + normalized.slice(homePrefix.length);
  }

  if (normalized.startsWith(homePrefixWin)) {
    return '~/' + normalized.slice(homePrefixWin.length);
  }

  // Path is outside home directory, keep as absolute
  return normalized;
}

/**
 * Check if a path contains unexpanded variables.
 */
export function hasPathVariables(path: string): boolean {
  if (!path) return false;
  return (
    path.startsWith('~') ||
    path.includes('${HOME}') ||
    path.includes('$HOME/')
  );
}

/**
 * Check if a path is already portable (has ~ prefix or is relative).
 */
export function isPortablePath(path: string): boolean {
  if (!path) return false;
  return path.startsWith('~') || path.startsWith('./') || !isAbsolute(path);
}

// ============================================================
// Cross-Platform Path Utilities
// ============================================================

/**
 * Normalize a path to use forward slashes for consistent cross-platform comparison.
 * Use this before comparing paths or using regex patterns on paths.
 *
 * @example
 * normalizePath('C:\\Users\\foo\\bar') // 'C:/Users/foo/bar'
 * normalizePath('/Users/foo/bar')      // '/Users/foo/bar' (unchanged)
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Normalize a path for cross-platform comparison.
 * - Resolve to absolute
 * - Convert backslashes to forward slashes
 * - Lowercase on Windows
 */
export function normalizePathForComparison(path: string): string {
  const normalized = normalizePath(resolve(path));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Check if a file path starts with a directory path (cross-platform).
 * Handles both Windows backslashes and Unix forward slashes.
 *
 * @example
 * pathStartsWith('C:\\Users\\foo\\file.txt', 'C:\\Users\\foo') // true
 * pathStartsWith('/home/user/file.txt', '/home/user')          // true
 * pathStartsWith('/home/user2/file.txt', '/home/user')         // false
 */
export function pathStartsWith(filePath: string, dirPath: string): boolean {
  const normalizedFile = normalizePathForComparison(filePath);
  const normalizedDir = normalizePathForComparison(dirPath);
  return normalizedFile.startsWith(normalizedDir + '/') || normalizedFile === normalizedDir;
}

/**
 * Strip a directory prefix from a path (cross-platform).
 * Returns the relative path portion after the prefix.
 *
 * @example
 * stripPathPrefix('/home/user/docs/file.txt', '/home/user') // 'docs/file.txt'
 * stripPathPrefix('C:\\foo\\bar\\baz.txt', 'C:\\foo')       // 'bar/baz.txt'
 */
export function stripPathPrefix(filePath: string, prefix: string): string {
  const normalizedFile = normalizePathForComparison(filePath);
  const normalizedPrefix = normalizePathForComparison(prefix);
  if (normalizedFile.startsWith(normalizedPrefix + '/')) {
    return normalizedFile.slice(normalizedPrefix.length + 1);
  }
  return filePath;
}

// ============================================================
// Bundled Assets Resolution
// ============================================================

/**
 * Module-level base directory for bundled assets.
 * Set once at Electron startup via setBundledAssetsRoot(__dirname).
 * In non-Electron contexts (tests, dev mode), process.cwd() candidates are used.
 */
let _assetsRoot: string | undefined;

/**
 * Register the Electron main process directory as the root for bundled assets.
 * Call this once at app startup: setBundledAssetsRoot(__dirname)
 *
 * After this, getBundledAssetsDir('docs') will resolve to `<__dirname>/resources/docs/`
 * in the packaged app, or fall back to dev paths if that doesn't exist.
 */
export function setBundledAssetsRoot(dir: string): void {
  _assetsRoot = dir;
}

/**
 * Resolve the path to a bundled assets subdirectory.
 *
 * All bundled assets now live in resources/ which electron-builder handles natively.
 * Tries candidates in order:
 * 1. Electron packaged app: <assetsRoot>/resources/<subfolder>
 * 2. Dev: electron app resources folder (when running from apps/electron)
 * 3. Dev: dist output (after build:copy)
 *
 * Returns the first candidate that exists on disk, or undefined if none found.
 *
 * @param subfolder - Name of the assets subdirectory (e.g. 'docs', 'tool-icons', 'themes', 'permissions')
 */
export function getBundledAssetsDir(subfolder: string): string | undefined {
  const candidates = [
    // Electron packaged app (set via setBundledAssetsRoot at startup)
    ...(_assetsRoot ? [join(_assetsRoot, 'resources', subfolder)] : []),
    // Dev: electron app resources folder (when cwd is apps/electron)
    join(process.cwd(), 'resources', subfolder),
    // Dev: dist output (after build:copy)
    join(process.cwd(), 'dist', 'resources', subfolder),
  ];
  return candidates.find(p => existsSync(p));
}
