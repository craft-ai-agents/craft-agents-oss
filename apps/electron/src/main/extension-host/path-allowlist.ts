/**
 * Allowlist for craft-sandbox extension entry paths.
 *
 * Loadable roots:
 *   - {configDir}/extensions/sandbox/
 *   - optional CRAFT_EXTENSION_SANDBOX_ROOT
 *
 * SiYuan plugin paths are never special-cased as loadable.
 * Containment uses realpath when the path exists so symlink escapes are rejected.
 */

import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export function resolveSandboxRoots(options?: {
  configDir?: string
  sandboxRootEnv?: string | undefined
}): string[] {
  const roots: string[] = []
  const configDir = options?.configDir
  if (configDir) {
    roots.push(resolve(configDir, 'extensions', 'sandbox'))
  }
  const envRoot = options?.sandboxRootEnv ?? process.env.CRAFT_EXTENSION_SANDBOX_ROOT
  if (envRoot && envRoot.trim()) {
    roots.push(resolve(envRoot.trim()))
  }
  return roots
}

/**
 * realpath when the path exists; otherwise return resolved absolute path.
 * Missing roots still participate via lexical resolve so checks work before mkdir.
 */
function realpathIfExists(path: string): string {
  const absolute = resolve(path)
  try {
    if (existsSync(absolute)) {
      return realpathSync(absolute)
    }
  } catch {
    // fall through to lexical path
  }
  return absolute
}

/**
 * Returns true when `entryPath` resolves inside one of the allowlisted roots
 * and does not escape via `..` traversal or symlinks.
 */
export function isPathAllowlisted(
  entryPath: string,
  roots: string[],
): { ok: true; resolved: string } | { ok: false; reason: string } {
  if (!entryPath || typeof entryPath !== 'string') {
    return { ok: false, reason: 'entryPath is required' }
  }
  if (entryPath.includes('\0')) {
    return { ok: false, reason: 'entryPath contains NUL' }
  }

  // Reject any `..` segment in the provided path (posix or windows separators).
  const segments = entryPath.split(/[/\\]+/)
  if (segments.includes('..')) {
    return { ok: false, reason: 'path traversal rejected' }
  }

  if (roots.length === 0) {
    return { ok: false, reason: 'no sandbox roots configured' }
  }

  let resolved: string
  try {
    resolved = resolve(entryPath)
  } catch {
    return { ok: false, reason: 'invalid entryPath' }
  }

  if (resolved.split(/[/\\]/).includes('..')) {
    return { ok: false, reason: 'path traversal rejected' }
  }

  // If the candidate exists, realpath it so symlink escapes cannot pass.
  try {
    if (existsSync(resolved)) {
      resolved = realpathSync(resolved)
    }
  } catch {
    return { ok: false, reason: 'entryPath realpath failed' }
  }

  for (const root of roots) {
    const rootResolved = realpathIfExists(root)
    if (isInsideRoot(resolved, rootResolved)) {
      return { ok: true, resolved }
    }
  }

  return { ok: false, reason: 'entryPath outside allowlisted sandbox roots' }
}

function isInsideRoot(candidate: string, root: string): boolean {
  if (candidate === root) return true
  const rel = relative(root, candidate)
  if (!rel) return true
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false
  return true
}

/** Assert path is allowlisted; throws Error with reason otherwise. */
export function assertPathAllowlisted(
  entryPath: string,
  roots: string[],
): string {
  const result = isPathAllowlisted(entryPath, roots)
  if (!result.ok) {
    throw new Error(`Extension load rejected: ${result.reason}`)
  }
  return result.resolved
}
