/**
 * RTK Bash command rewriter.
 *
 * Calls `rtk rewrite "<command>"` and replaces the Bash command with rtk's
 * compressed equivalent, transparently to the LLM. The LLM still sees the
 * original `git status` in its conversation history; the SDK actually
 * executes `rtk git status`, returning compressed output.
 *
 * Contract (from rtk's own hooks/claude/rtk-rewrite.sh):
 *   exit 0 + stdout  Rewrite found, no permission rules — auto-allow
 *   exit 1           No RTK equivalent — passthrough unchanged
 *   exit 2           Deny rule — passthrough (our permission system handles)
 *   exit 3 + stdout  Ask rule — rewrite, but caller should still prompt
 *
 * On any error (timeout, spawn failure, parse failure, identical output)
 * we fall through unchanged. RTK telemetry is always disabled for our
 * spawns regardless of user's rtk-side opt-in state.
 */

import { spawnSync } from 'node:child_process';

const SPAWN_TIMEOUT_MS = 200;

const REWRITE_EXIT_OK = 0;
const REWRITE_EXIT_ASK = 3;

export interface RtkRewriteResult {
  modified: boolean;
  input: Record<string, unknown>;
}

export interface RtkContext {
  enabled: boolean;
  path: string | null;
  exclude: string[];
}

export function rewriteBashWithRtk(
  toolName: string,
  input: Record<string, unknown>,
  rtkPath: string | null,
  excludeCommands: string[],
  onDebug?: (msg: string) => void,
): RtkRewriteResult {
  if (toolName !== 'Bash' || !rtkPath) {
    return { modified: false, input };
  }

  const command = typeof input.command === 'string' ? input.command : '';
  if (!command) return { modified: false, input };

  const baseCommand = command.trim().split(/\s+/)[0] ?? '';
  if (baseCommand && excludeCommands.includes(baseCommand)) {
    return { modified: false, input };
  }

  try {
    const result = spawnSync(rtkPath, ['rewrite', command], {
      encoding: 'utf-8',
      timeout: SPAWN_TIMEOUT_MS,
      env: { ...process.env, RTK_TELEMETRY_DISABLED: '1' },
    });

    if (result.error) {
      onDebug?.(`[rtk] spawn failed: ${result.error.message}`);
      return { modified: false, input };
    }

    // Only exit 0 (auto-allow) and 3 (ask-with-rewrite) are rewrite signals.
    // Other codes (1=no-equivalent, 2=deny, anything else) → passthrough.
    if (result.status !== REWRITE_EXIT_OK && result.status !== REWRITE_EXIT_ASK) {
      return { modified: false, input };
    }

    const rewritten = (result.stdout || '').trim();
    if (!rewritten || rewritten === command) {
      return { modified: false, input };
    }

    onDebug?.(`[rtk] "${command}" → "${rewritten}"`);
    return { modified: true, input: { ...input, command: rewritten } };
  } catch (e) {
    onDebug?.(`[rtk] unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    return { modified: false, input };
  }
}
