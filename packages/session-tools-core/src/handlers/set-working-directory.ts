import * as path from 'node:path';
import * as os from 'node:os';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface SetWorkingDirectoryArgs {
  path: string;
}

/**
 * Expand `~`, `~/...`, `$HOME`, and `${HOME}` to the user's home directory.
 * Mirrors the expansion done by spawn_session so behaviour is consistent.
 *
 * Relative paths are intentionally NOT resolved here: `SessionToolContext`
 * does not reliably carry the session's live working directory in every
 * backend, and `process.cwd()` is the app/server launch directory rather
 * than the session cwd. Resolution is delegated to the injected backend
 * callback (`setWorkingDirectory`) which owns the authoritative cwd.
 */
function expandPath(input: string): string {
  const home = os.homedir();
  let p = input.trim();
  if (p === '~') return home;
  // Accept both POSIX (`~/foo`) and Windows (`~\foo`) home-relative paths
  // since users and models on Windows commonly produce the latter.
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    p = path.join(home, p.slice(2));
  }
  p = p.replace(/\$\{HOME\}/g, home).replace(/\$HOME(?![A-Za-z0-9_])/g, home);
  return p;
}

export async function handleSetWorkingDirectory(
  ctx: SessionToolContext,
  args: SetWorkingDirectoryArgs
): Promise<ToolResult> {
  if (!ctx.setWorkingDirectory) {
    return errorResponse('set_working_directory is not available in this context.');
  }

  const raw = (args.path ?? '').toString();
  if (!raw.trim()) {
    return errorResponse('path is required and must be a non-empty string.');
  }

  const expanded = expandPath(raw);

  try {
    const result = await ctx.setWorkingDirectory(expanded);
    if (!result.ok) {
      return errorResponse(
        `Failed to change working directory to "${result.path ?? expanded}": ${result.reason ?? 'unknown error'}`
      );
    }
    const applied = result.path ?? expanded;
    // The backend may set `reason` even on success to flag a partial apply
    // (e.g. the live SDK subprocess is still rooted at the original cwd).
    const note = result.reason ? ` (${result.reason})` : '';
    return successResponse(`Working directory changed to ${applied}.${note}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to change working directory: ${message}`);
  }
}
