/**
 * Pure helpers for deciding whether the live process holding a server-lock PID
 * is the same server that wrote the lock. Extracted from headless-start.ts so
 * the decision logic is unit-testable without real process inspection (#978).
 */

export interface LockIdentity {
  pid: number
  startedAt: number
  /** basename of process.execPath at acquire time. Absent in pre-0.11.3 locks. */
  execName?: string
}

/**
 * Parse `tasklist /FO CSV /NH` output into the image name of the first row.
 * Row format: "Image Name","PID","Session Name","Session#","Mem Usage".
 * Returns null for the "INFO: No tasks are running..." message or anything
 * that isn't a CSV data row (image names cannot contain `"` on Windows).
 */
export function parseTasklistImageName(output: string): string | null {
  const line = output.trim().split(/\r?\n/)[0] ?? ''
  if (!line.startsWith('"')) return null
  const end = line.indexOf('"', 1)
  if (end <= 1) return null
  return line.slice(1, end)
}

/**
 * Decide whether the live process holding the lock PID matches the lock writer.
 *
 * - Locks that record `execName` (0.11.3+) are compared name-to-name against the
 *   live process's executable name — exact, case-insensitive. This is the check
 *   Windows can actually answer (`tasklist` returns image names, not command
 *   lines), and it works for dev shapes (`bun`, `electron`) the old substring
 *   heuristic missed.
 * - Legacy locks without `execName` fall back to that heuristic: treat the holder
 *   as ours only when its command line references craft.
 * - An uninspectable process (both live inputs null) fails OPEN (not a match):
 *   PID reuse is the common case here, and a false "already running" silently
 *   and permanently bricks the app (#978). Single-instancing has independent
 *   backstops (Electron's requestSingleInstanceLock, the WS port bind).
 */
export function lockHolderMatchesLock(
  lock: LockIdentity,
  liveExecName: string | null,
  liveCommandLine: string | null
): boolean {
  if (lock.execName) {
    if (!liveExecName) return false
    return liveExecName.toLowerCase() === lock.execName.toLowerCase()
  }
  if (!liveCommandLine) return false
  return /craft/i.test(liveCommandLine)
}
