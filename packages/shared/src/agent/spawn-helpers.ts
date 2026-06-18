/**
 * Helpers for the Claude SDK subprocess spawn site.
 *
 * Extracted to its own module so the directory probe, ENOENT detection,
 * and SDK wrapper-string regex can be unit-tested without spinning up a
 * full ClaudeAgent.
 */

import { lstatSync } from 'node:fs';

/**
 * Returns true iff `p` is an existing directory.
 *
 * Uses `lstatSync` so a symlink pointing at a missing target returns false
 * — broken symlinks must count as "missing" because spawn() will fail on them
 * anyway. Wrapped in try/catch so EACCES/ENOTDIR/etc. fall through cleanly.
 */
export function isExistingDirectory(p: string | null | undefined): boolean {
  if (!p) return false;
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Match the SDK's `ReferenceError("Claude Code native binary not found at <path>")`
 * (and the older `executable not found at <path>` variant) and return the
 * captured path. Greedy capture to end-of-line to preserve macOS bundle paths
 * like `/Applications/Craft Agents.app/...`. A single trailing sentence period
 * is stripped only when present (the SDK historically appends one).
 */
const SDK_BINARY_NOT_FOUND_RE = /Claude Code (?:native binary|executable) not found at\s+(.+)$/m;

export function extractSdkReportedBinaryPath(rawErrorMsg: string | null | undefined): string | undefined {
  if (!rawErrorMsg) return undefined;
  const match = SDK_BINARY_NOT_FOUND_RE.exec(rawErrorMsg);
  if (!match || !match[1]) return undefined;
  return match[1].replace(/\.\s*$/, '');
}

/**
 * Detect spawn ENOENT from any of the channels Node and the SDK use to surface it:
 * - structured fields on the thrown error (`code === 'ENOENT'`, `syscall === 'spawn …'`)
 * - stringified `spawn … ENOENT` in either the raw error or captured stderr
 * - the SDK's own wrapper string (`Claude Code native binary not found at …`)
 */
export function isSpawnEnoent(input: {
  errorCode?: string;
  errorSyscall?: string;
  rawErrorMsg?: string | null;
  stderr?: string | null;
}): boolean {
  const { errorCode, errorSyscall, rawErrorMsg, stderr } = input;
  if (errorCode === 'ENOENT' && errorSyscall && errorSyscall.startsWith('spawn')) return true;
  if (rawErrorMsg && /\bspawn\b[\s\S]*\bENOENT\b/.test(rawErrorMsg)) return true;
  if (stderr && /\bspawn\b[\s\S]*\bENOENT\b/.test(stderr)) return true;
  if (rawErrorMsg && SDK_BINARY_NOT_FOUND_RE.test(rawErrorMsg)) return true;
  return false;
}
