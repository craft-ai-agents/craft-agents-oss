/**
 * Async git for server-side helpers (branch lookup, PR watcher): `execFile` without a shell, a short
 * timeout, and failures read as "unknown" instead of throwing.
 */

import { execFile } from 'node:child_process'

const GIT_TIMEOUT_MS = 5_000

/** stdout of `git -C dir …`, trimmed; null when git fails, times out or prints nothing. */
export function runGit(dir: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<string | null> {
  return new Promise((done) => {
    execFile('git', ['-C', dir, ...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) return done(null)
      const out = stdout.trim()
      done(out.length > 0 ? out : null)
    })
  })
}

export interface GitResult {
  ok: boolean
  stdout: string
  /** git's own message on failure (e.g. "fatal: a branch named 'x' already exists") */
  stderr: string
}

/** Like {@link runGit} but keeps git's error output, for operations whose failure the user must see. */
export function runGitResult(dir: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<GitResult> {
  return new Promise((done) => {
    execFile('git', ['-C', dir, ...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      done({ ok: !error, stdout: String(stdout).trim(), stderr: String(stderr).trim() || (error ? error.message : '') })
    })
  })
}
