/**
 * Script Action Executor
 *
 * Executes `script` automation actions: argv spawn of a workspace-local
 * script through resolveScriptRuntime (bun/node/python3) — never a shell.
 *
 * Guarantees (locked design):
 * - Script path is workspace-relative and must resolve inside the workspace
 *   (symlink-aware isPathWithinDirectory).
 * - Child env is CRAFT_*-only (see buildScriptEnv in utils.ts).
 * - SIGTERM on timeout with a SIGKILL fallback so trapped signals can't hang
 *   the host process.
 * - Page refreshes record their outcome on page.json LAST, making it the
 *   completion marker the config watcher turns into `pages:changed`.
 *
 * The per-matcher concurrency lock lives in the ScriptHandler — this module
 * executes exactly one action.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  resolveScriptRuntime,
  isPathWithinDirectory,
} from '@craft-agent/session-tools-core';
import { createLogger } from '../utils/debug.ts';
import { recordPageRefresh } from '../pages/storage.ts';
import { HISTORY_FIELD_MAX_LENGTH } from './constants.ts';
import type { ScriptAction, ScriptActionResult } from './types.ts';

const log = createLogger('script-executor');

/** Default per-run timeout (design: 60s default, 15min maximum) */
export const DEFAULT_SCRIPT_TIMEOUT_MS = 60_000;
/** Timeout clamp bounds */
export const MIN_SCRIPT_TIMEOUT_MS = 1_000;
export const MAX_SCRIPT_TIMEOUT_MS = 900_000;
/** Grace period between SIGTERM and SIGKILL */
const SIGKILL_GRACE_MS = 5_000;
/** Cap for captured stdout/stderr, each */
const OUTPUT_CAPTURE_MAX_BYTES = 16 * 1024;

export interface ScriptExecutionContext {
  /** Workspace root — scripts must live inside it and run with it as cwd */
  workspaceRootPath: string;
  /** CRAFT_*-only environment (build with buildScriptEnv) */
  env: Record<string, string>;
  /**
   * Optional cooperative-cancellation signal. When it aborts, the child gets
   * SIGTERM with a SIGKILL fallback — so a caller with its own deadline (e.g.
   * the pages action broker) can guarantee the process cannot outlive the
   * request. Scheduled refreshes pass none and are unaffected.
   */
  signal?: AbortSignal;
}

/** Clamp a configured timeout into the allowed window. */
export function clampScriptTimeout(timeoutMs: number | undefined): number {
  const requested = timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS;
  return Math.min(MAX_SCRIPT_TIMEOUT_MS, Math.max(MIN_SCRIPT_TIMEOUT_MS, requested));
}

function blockedResult(action: ScriptAction, reason: string): ScriptActionResult {
  return {
    type: 'script',
    script: action.script,
    success: false,
    exitCode: null,
    blocked: true,
    stdout: '',
    stderr: reason,
    durationMs: 0,
    page: action.page,
  };
}

/**
 * Execute a single script action.
 *
 * Never throws — every failure mode is folded into the result so callers
 * (handler, RPC test) get a uniform shape to record.
 */
export async function executeScriptAction(
  action: ScriptAction,
  ctx: ScriptExecutionContext,
): Promise<ScriptActionResult> {
  // --- Path containment (workspace-scoped, symlink-aware) ---
  if (isAbsolute(action.script)) {
    return blockedResult(action, `Script path must be relative to the workspace root: ${action.script}`);
  }
  const scriptPath = join(ctx.workspaceRootPath, action.script);
  // Existence first: isPathWithinDirectory can only resolve symlinks for
  // paths that exist (a missing file under a symlinked workspace root, e.g.
  // /var → /private/var on macOS, would misreport as an escape).
  if (!existsSync(scriptPath)) {
    return blockedResult(action, `Script not found: ${action.script}`);
  }
  if (!isPathWithinDirectory(scriptPath, ctx.workspaceRootPath)) {
    return blockedResult(action, `Script path escapes the workspace: ${action.script}`);
  }

  // --- Runtime resolution (env override → bundled → PATH in dev) ---
  let command: string;
  let argsPrefix: string[];
  try {
    const runtime = resolveScriptRuntime(action.runtime ?? 'bun');
    command = runtime.command;
    argsPrefix = runtime.argsPrefix;
  } catch (e) {
    return blockedResult(action, e instanceof Error ? e.message : 'Script runtime unavailable');
  }

  // --- Spawn (argv, no shell) ---
  const timeoutMs = clampScriptTimeout(action.timeoutMs);
  const spawnArgs = [...argsPrefix, scriptPath, ...(action.args ?? [])];
  const startTime = Date.now();

  const result = await new Promise<ScriptActionResult>((resolvePromise) => {
    const child = spawn(command, spawnArgs, {
      cwd: ctx.workspaceRootPath,
      env: ctx.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let abortKillTimer: ReturnType<typeof setTimeout> | undefined;

    const capture = (current: string, chunk: Buffer): string =>
      current.length >= OUTPUT_CAPTURE_MAX_BYTES
        ? current
        : (current + chunk.toString('utf-8')).slice(0, OUTPUT_CAPTURE_MAX_BYTES);

    child.stdout?.on('data', (chunk: Buffer) => { stdout = capture(stdout, chunk); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = capture(stderr, chunk); });

    // SIGTERM at timeout; SIGKILL if the process traps it and lingers.
    const termTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    const killTimer = setTimeout(() => {
      if (!child.killed || child.exitCode === null) {
        log.warn(`[ScriptExecutor] ${action.script} ignored SIGTERM, sending SIGKILL`);
        child.kill('SIGKILL');
      }
    }, timeoutMs + SIGKILL_GRACE_MS);

    // Cooperative cancellation: SIGTERM now, SIGKILL after the same grace, so an
    // aborted run cannot outlive its caller's deadline.
    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
      abortKillTimer = setTimeout(() => {
        if (!child.killed || child.exitCode === null) child.kill('SIGKILL');
      }, SIGKILL_GRACE_MS);
    };
    if (ctx.signal) {
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener('abort', onAbort, { once: true });
    }

    const settle = (partial: Pick<ScriptActionResult, 'success' | 'exitCode'> & Partial<ScriptActionResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      if (abortKillTimer) clearTimeout(abortKillTimer);
      ctx.signal?.removeEventListener('abort', onAbort);
      resolvePromise({
        type: 'script',
        script: action.script,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startTime,
        page: action.page,
        ...partial,
      });
    };

    child.on('error', (error) => {
      settle({ success: false, exitCode: null, stderr: (stderr + '\n' + error.message).trim() });
    });

    child.on('close', (code) => {
      if (aborted) {
        settle({ success: false, exitCode: null, stderr: (stderr + '\nAborted').trim() });
      } else if (timedOut) {
        settle({
          success: false,
          exitCode: null,
          timedOut: true,
          stderr: (stderr + `\nTimed out after ${timeoutMs}ms`).trim(),
        });
      } else {
        settle({ success: code === 0, exitCode: code });
      }
    });
  });

  // --- Page refresh completion marker (must be the LAST write of the run) ---
  if (action.page) {
    try {
      recordPageRefresh(ctx.workspaceRootPath, action.page, {
        at: Date.now(),
        ok: result.success,
        durationMs: result.durationMs,
        error: result.success ? undefined : (result.stderr || undefined),
      });
    } catch (e) {
      log.debug(`[ScriptExecutor] Failed to record page refresh for ${action.page}: ${e}`);
    }
  }

  return result;
}

/**
 * Create a script-action history entry for automations-history.jsonl.
 * Mirrors createWebhookHistoryEntry / createPromptHistoryEntry in webhook-utils.ts.
 */
export function createScriptHistoryEntry(opts: {
  matcherId: string;
  result: ScriptActionResult;
}): Record<string, unknown> {
  const { result } = opts;
  return {
    id: opts.matcherId,
    ts: Date.now(),
    ok: result.success,
    script: {
      script: result.script,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      ...(result.page ? { page: result.page } : {}),
      ...(result.timedOut ? { timedOut: true } : {}),
      ...(result.blocked ? { blocked: true } : {}),
      ...(result.skipped ? { skipped: true } : {}),
      ...(result.success || !result.stderr ? {} : { error: result.stderr.slice(0, HISTORY_FIELD_MAX_LENGTH) }),
    },
  };
}
