/**
 * Path Portability Utilities
 *
 * Functions for making filesystem paths portable across machines.
 * Supports ~ and ${HOME} path variables for cross-machine compatibility.
 */

import { homedir } from 'os';
import { resolve, join, normalize, isAbsolute } from 'path';

/**
 * Expand path variables (~, ${HOME}, $HOME) to absolute paths.
 *
 * @param inputPath - Path that may contain variables
 * @param basePath - Base path for relative path resolution (defaults to cwd)
 * @returns Absolute path with all variables expanded
 *
 * @example
 * expandPath('~')                    // '/Users/alice'
 * expandPath('~/Documents')          // '/Users/alice/Documents'
 * expandPath('${HOME}/projects')     // '/Users/alice/projects'
 * expandPath('/absolute/path')       // '/absolute/path' (unchanged)
 */
export function expandPath(inputPath: string, basePath?: string): string {
  if (!inputPath) return inputPath;

  let expanded = inputPath;
  const home = homedir();

  // Handle ~ alone
  if (expanded === '~') {
    return home;
  }

  // Handle ~/ prefix
  if (expanded.startsWith('~/')) {
    expanded = join(home, expanded.slice(2));
  }

  // Handle ${HOME} and $HOME variables
  expanded = expanded.replace(/\$\{HOME\}/g, home);
  expanded = expanded.replace(/\$HOME(?=\/|$)/g, home);

  // If still not absolute, resolve from base path
  if (!isAbsolute(expanded)) {
    const base = basePath || process.cwd();
    expanded = resolve(base, expanded);
  }

  return normalize(expanded);
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
 * Check if a file path starts with a directory path (cross-platform).
 * Handles both Windows backslashes and Unix forward slashes.
 *
 * @example
 * pathStartsWith('C:\\Users\\foo\\file.txt', 'C:\\Users\\foo') // true
 * pathStartsWith('/home/user/file.txt', '/home/user')          // true
 * pathStartsWith('/home/user2/file.txt', '/home/user')         // false
 */
export function pathStartsWith(filePath: string, dirPath: string): boolean {
  const normalizedFile = normalizePath(filePath);
  const normalizedDir = normalizePath(dirPath);
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
  const normalizedFile = normalizePath(filePath);
  const normalizedPrefix = normalizePath(prefix);
  if (normalizedFile.startsWith(normalizedPrefix + '/')) {
    return normalizedFile.slice(normalizedPrefix.length + 1);
  }
  return filePath;
}
