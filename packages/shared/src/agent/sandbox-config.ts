/**
 * Sandbox configuration builder for the Claude Agent SDK.
 *
 * Maps Craft's per-session `sandboxed` flag onto the SDK's native `sandbox`
 * Options field, which uses Seatbelt on macOS and bubblewrap on Linux/WSL2 to
 * enforce filesystem and network isolation at the OS level.
 *
 * The Pi backend currently does not honor this — only ClaudeAgent reads the
 * output of `buildClaudeSandboxOptions` and feeds it into `query()`.
 */

import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { getSessionPath } from '../sessions/storage.ts';
import type { SessionConfig } from '../sessions/types.ts';

/**
 * Inputs to derive an SDK sandbox config from a session.
 */
export interface BuildClaudeSandboxArgs {
  session: SessionConfig | undefined;
  workspaceRootPath: string;
  /** Effective spawn cwd that ClaudeAgent passes to the SDK (sdkCwd or fallback). */
  sdkCwd: string;
}

/**
 * Build the `sandbox` field for the SDK's `Options`. Returns `undefined` when
 * sandboxing is disabled or the session is missing — callers can spread the
 * result into Options without conditionals at the call site.
 *
 * Allow-list strategy:
 *   - Filesystem writes are restricted to the user's working directory and
 *     Craft's per-session storage. Reads stay open by default (the SDK's
 *     baseline policy), so node_modules / dyld / source files all resolve.
 *   - Network rules are intentionally NOT preset; the SDK's default UX
 *     prompts for new domains the first time the agent contacts them.
 *     A future iteration can pre-fill domains from configured sources.
 *
 * Failure handling:
 *   - `failIfUnavailable` defaults to true (matches the SDK's own default
 *     when `enabled: true` is passed programmatically). Sessions opted into
 *     graceful degradation can set `sandboxFailHard: false` to fall back
 *     to unsandboxed execution with a warning instead.
 */
export function buildClaudeSandboxOptions(
  args: BuildClaudeSandboxArgs,
): Options['sandbox'] | undefined {
  const { session, workspaceRootPath, sdkCwd } = args;
  if (!session?.sandboxed) return undefined;

  const sessionDir = getSessionPath(workspaceRootPath, session.id);

  // De-duplicate write roots: workingDirectory often equals sdkCwd (set at
  // session creation), and sdkCwd may equal sessionDir for sessions without
  // a user-set working folder. Pass each unique path exactly once.
  const writeRoots = new Set<string>();
  if (session.workingDirectory) writeRoots.add(session.workingDirectory);
  writeRoots.add(sdkCwd);
  writeRoots.add(sessionDir);

  return {
    enabled: true,
    failIfUnavailable: session.sandboxFailHard ?? true,
    autoAllowBashIfSandboxed: true,
    filesystem: {
      allowWrite: [...writeRoots],
    },
  };
}
