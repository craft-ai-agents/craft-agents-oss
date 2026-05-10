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

import { join, resolve, sep } from 'node:path';
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
 * The set of writeable filesystem roots a sandboxed session is permitted to
 * modify. Returns an empty array when the session is not sandboxed.
 *
 * Used in two places that must agree:
 *   1. `buildClaudeSandboxOptions` → fed to the SDK's OS-level sandbox
 *      (`sandbox.filesystem.allowWrite`), which gates Bash and subprocesses.
 *   2. The `PreToolUse` hook in ClaudeAgent → gates the SDK's built-in
 *      Write / Edit / MultiEdit / NotebookEdit tools, which the OS sandbox
 *      doesn't see (per Anthropic's design — see the "What sandboxing does
 *      not cover" section of the public docs).
 *
 * Keeping the source of truth here ensures the two enforcement layers stay
 * aligned: a path the OS sandbox would block via Bash is also blocked when
 * an agent reaches for the built-in Write tool.
 */
export function getSandboxWriteRoots(args: BuildClaudeSandboxArgs): string[] {
  const { session, workspaceRootPath, sdkCwd } = args;
  if (!session?.sandboxed) return [];

  const sessionDir = getSessionPath(workspaceRootPath, session.id);
  const workspaceDataDir = join(workspaceRootPath, 'data');

  const roots = new Set<string>();
  if (session.workingDirectory) roots.add(session.workingDirectory);
  roots.add(sdkCwd);
  roots.add(sessionDir);
  roots.add(workspaceDataDir);
  return [...roots];
}

/**
 * Test whether `targetPath` falls inside any of the supplied root directories.
 * Both `targetPath` and roots are resolved to absolute paths before comparison.
 *
 * Subpath semantics use path separators as boundaries so that a root of
 * `/foo/bar` matches `/foo/bar/baz` but NOT `/foo/barn` — string-prefix
 * matching alone would be wrong.
 *
 * `cwd` is used to anchor relative `targetPath` inputs.
 */
export function isPathInsideAllowedRoots(
  targetPath: string,
  roots: readonly string[],
  cwd: string,
): boolean {
  const target = resolve(cwd, targetPath);
  for (const root of roots) {
    const absRoot = resolve(root);
    if (target === absRoot) return true;
    if (target.startsWith(absRoot + sep)) return true;
  }
  return false;
}

/**
 * Tools whose target path must be checked against the sandbox allow-list when
 * the session is sandboxed. Bash is intentionally absent — Bash and its
 * subprocess tree are already constrained by the OS-level sandbox; replicating
 * the check here would require parsing arbitrary shell commands and would
 * still be redundant with what Seatbelt/bubblewrap already enforce.
 */
export const SANDBOX_GATED_TOOLS = new Set<string>([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
]);

/**
 * Pull the file path from the input of a sandbox-gated tool. The SDK uses
 * `file_path` for Write/Edit/MultiEdit and `notebook_path` for NotebookEdit.
 * Returns null when the path is missing or not a string (defensive: the input
 * shape is provided by the model, not our code).
 */
export function extractSandboxGatedFilePath(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
): string | null {
  if (!toolInput) return null;
  if (toolName === 'NotebookEdit') {
    const v = toolInput.notebook_path;
    return typeof v === 'string' ? v : null;
  }
  if (SANDBOX_GATED_TOOLS.has(toolName)) {
    const v = toolInput.file_path;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/**
 * Build the `sandbox` field for the SDK's `Options`. Returns `undefined` when
 * sandboxing is disabled or the session is missing — callers can spread the
 * result into Options without conditionals at the call site.
 *
 * Allow-list strategy:
 *   - Filesystem writes are restricted to the user's working directory, the
 *     per-session storage dir, and the workspace's `data/` dir (which is
 *     Craft's documented home for shared cross-run state — caches, indexes,
 *     etc. — that automations need to update). Reads stay open by default
 *     (the SDK's baseline policy), so node_modules / dyld / source files
 *     all resolve. We deliberately do NOT add the whole workspace root:
 *     `automations.json`, `config.json`, `sources/`, and other sessions'
 *     transcripts must remain write-protected even from the agent itself.
 *   - Network rules are intentionally NOT preset; the SDK's default UX
 *     prompts for new domains the first time the agent contacts them.
 *     A future iteration can pre-fill domains from configured sources.
 *
 * Escape hatch is closed:
 *   - `allowUnsandboxedCommands: false` disables the SDK's
 *     `dangerouslyDisableSandbox` parameter. Without this, an agent
 *     hitting a sandbox-incompatible tool can retry with the parameter
 *     set, which under `allow-all` permission mode bypasses sandboxing
 *     silently. Craft's design exposes two explicit user-controlled
 *     escape hatches already (toggle `sandboxed` off, or unset it on
 *     the session); offering the LLM a third one undermines the
 *     property the user opted in for.
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
  const { session } = args;
  if (!session?.sandboxed) return undefined;

  // Single source of truth shared with the PreToolUse hook (see
  // getSandboxWriteRoots' docstring for why both layers must agree).
  const writeRoots = getSandboxWriteRoots(args);

  return {
    enabled: true,
    failIfUnavailable: session.sandboxFailHard ?? true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    filesystem: {
      allowWrite: writeRoots,
    },
  };
}
