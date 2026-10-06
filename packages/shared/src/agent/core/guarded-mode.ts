/**
 * Guarded permission mode: the risk check seam (decision model, feature `guardedMode`).
 *
 * Guarded mode runs tool calls like Execute. When the host installs an active
 * check, a call that is not read-only (a Bash command outside the read-only
 * allowlist, an MCP mutation including session tools Explore blocks, a non-GET
 * API call) is described to it first; if the check reports a risk, the call
 * becomes an ordinary permission prompt. A file write outside the working
 * directory and the session's plans/data folders always prompts, without asking
 * the model. File writes inside the project run as in Execute.
 * Execute mode itself is never checked: it always runs without prompts.
 *
 * Tighten-only by construction: the check can turn an allow into a prompt,
 * never a block or prompt into an allow. No check or an inactive check means the
 * call proceeds as it would in Execute mode; an active check that gives no answer
 * or fails turns the call into a prompt ("could not be checked"), as in Ask to
 * Edit. If the mode changes while the check thinks, the call is re-decided under
 * the new mode; if the turn stops, it is blocked instead of raising a late prompt.
 * Its prompts carry no `remember` key, so "Always Allow" cannot whitelist them.
 */

import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { getPermissionModeDiagnostics, isReadOnlyBashCommandWithConfig, shouldAllowToolInMode } from '../mode-manager.ts';
import { permissionsConfigCache, type PermissionsContext } from '../permissions-config.ts';
import { evaluateApiEndpointPolicy } from '../source-policy.ts';
import { runPreToolUseChecks, type PreToolUseCheckResult, type PreToolUseInput } from './pre-tool-use.ts';

/** `unchecked`: the check gave no usable answer, so the call asks rather than runs unjudged. */
export type GuardedModeRisk = 'irreversible' | 'outside_workspace' | 'external' | 'unchecked';

/** A tool call described for the check. */
export interface GuardedModeCall {
  toolName: string;
  promptType: 'bash' | 'mcp_mutation' | 'api_mutation' | 'file_write';
  /** Prompt description if the call is escalated. */
  description: string;
  /** Bash command, or the tool name for MCP/API calls (what the prompt shows). */
  command: string;
  /** Tool arguments for MCP/API calls. */
  arguments?: Record<string, unknown>;
  workingDirectory?: string;
  /** Escalate without asking the model (a write outside the project is always worth a prompt). */
  alwaysAsk?: GuardedModeRisk;
}

/** Risks the check found. An empty list means no prompt. */
export interface GuardedModeVerdict {
  risks: GuardedModeRisk[];
}

/** Host check. `isActive` is synchronous so an off toggle costs the tool path nothing. */
export interface GuardedModeCheck {
  /** Feature on and someone there to answer a prompt; checked on every call. */
  isActive(): boolean;
  /** Judge one call; `null` means no answer. `signal` aborts when the turn stops. */
  check(call: GuardedModeCall, signal?: AbortSignal): Promise<GuardedModeVerdict | null>;
}

export interface GuardedModeCheckOptions {
  /** The turn's abort signal: a stopped turn gets a block, never a late prompt. */
  signal?: AbortSignal;
}

const RISK_LABELS: Record<GuardedModeRisk, string> = {
  irreversible: 'hard to undo',
  outside_workspace: 'reaches outside the project',
  external: 'reaches other people or services',
  unchecked: 'could not be checked',
};

const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** Session bookkeeping the agent does constantly; not worth a model call in Guarded mode. */
const BOOKKEEPING_SESSION_TOOLS = new Set(['mcp__session__set_session_status', 'mcp__session__set_session_labels']);

function isInside(base: string | undefined, target: string): boolean {
  if (!base) return false;
  const rel = relative(resolve(base), target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Absolute target of a file write (`~` expanded, relative to the working directory). */
function writeTarget(input: Record<string, unknown>, workingDirectory: string): string | null {
  const raw = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : '';
  if (!raw.trim()) return null;
  const expanded = raw === '~' || raw.startsWith('~/') ? `${homedir()}${raw.slice(1)}` : raw;
  return resolve(workingDirectory, expanded);
}

/**
 * Describe a call for the check, or `null` when it is read-only (nothing to
 * check) or of a kind the check does not judge.
 */
export function getGuardedModeCall(
  toolName: string,
  input: Record<string, unknown>,
  ctx: Pick<PreToolUseInput, 'workspaceRootPath' | 'activeSourceSlugs' | 'plansFolderPath' | 'dataFolderPath' | 'workingDirectory'>,
): GuardedModeCall | null {
  const permissionsContext: PermissionsContext = { workspaceRootPath: ctx.workspaceRootPath, activeSourceSlugs: ctx.activeSourceSlugs };
  // Without a session working directory the agent runs in the workspace root.
  const workingDirectory = ctx.workingDirectory ?? ctx.workspaceRootPath;

  if (FILE_WRITE_TOOLS.has(toolName)) {
    const target = writeTarget(input, workingDirectory);
    if (!target) return null;
    if (isInside(workingDirectory, target) || isInside(ctx.plansFolderPath, target) || isInside(ctx.dataFolderPath, target)) return null;
    return { toolName, promptType: 'file_write', description: `${toolName}: ${target}`, command: target, workingDirectory, alwaysAsk: 'outside_workspace' };
  }

  if (toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : '';
    if (!command.trim()) return null;
    if (isReadOnlyBashCommandWithConfig(command, permissionsConfigCache.getMergedConfig(permissionsContext))) return null;
    return { toolName, promptType: 'bash', description: `Execute: ${command}`, command, workingDirectory };
  }

  if (toolName.startsWith('mcp__') && !BOOKKEEPING_SESSION_TOOLS.has(toolName)) {
    // Read-only by the same rules as Explore mode, including the workspace and source patterns
    // (built-in session tools too: pages, agent messages and the like are what Explore blocks).
    if (shouldAllowToolInMode(toolName, input, 'safe', { plansFolderPath: ctx.plansFolderPath, dataFolderPath: ctx.dataFolderPath, permissionsContext }).allowed) return null;
    const serverAndTool = toolName.replace('mcp__', '').replace(/__/g, '/');
    return { toolName, promptType: 'mcp_mutation', description: `MCP: ${serverAndTool}`, command: toolName, arguments: input, workingDirectory };
  }

  if (toolName.startsWith('api_')) {
    const method = ((input.method as string) || 'GET').toUpperCase();
    const path = input.path as string | undefined;
    const policy = evaluateApiEndpointPolicy(method, path, permissionsContext);
    if (policy.decision === 'allow') return null;
    return { toolName, promptType: 'api_mutation', description: `API: ${policy.description}`, command: policy.description, arguments: input, workingDirectory };
  }

  return null;
}

/** Tools the check can judge at all (cheap name check before anything else). */
function isGuardableTool(toolName: string): boolean {
  return toolName === 'Bash'
    || FILE_WRITE_TOOLS.has(toolName)
    || toolName.startsWith('mcp__')
    || toolName.startsWith('api_');
}

/**
 * Whether a pre-tool-use result goes to the check at all: an allow for a
 * guardable tool in Guarded mode with an active check. Synchronous, so call sites
 * skip `applyGuardedModeCheck` (and its await) entirely otherwise; Execute mode
 * never gets here.
 */
export function needsGuardedModeCheck(
  result: PreToolUseCheckResult,
  ctx: Pick<PreToolUseInput, 'sessionId' | 'toolName'>,
  check: GuardedModeCheck | null | undefined,
): check is GuardedModeCheck {
  if (!check || (result.type !== 'allow' && result.type !== 'modify') || !isGuardableTool(ctx.toolName)) return false;
  if (getPermissionModeDiagnostics(ctx.sessionId).permissionMode !== 'guarded') return false;
  try {
    return check.isActive();
  } catch {
    return false;
  }
}

/**
 * Consult the check for an allowed call in Guarded mode. Returns the original
 * result unless the check reports a risk, in which case the call becomes a
 * permission prompt. Never throws.
 */
export async function applyGuardedModeCheck(
  result: PreToolUseCheckResult,
  ctx: PreToolUseInput,
  check: GuardedModeCheck | null | undefined,
  options: GuardedModeCheckOptions = {},
): Promise<PreToolUseCheckResult> {
  if (!needsGuardedModeCheck(result, ctx, check)) return result;

  // Judge what the agent asked for: a rewrite (e.g. rtk) only changes how it runs.
  let call: GuardedModeCall | null;
  try {
    call = getGuardedModeCall(ctx.toolName, ctx.input, ctx);
  } catch {
    return result;
  }
  if (!call) return result;

  let risks: GuardedModeRisk[] = [];
  if (call.alwaysAsk) {
    risks = [call.alwaysAsk];
  } else {
    try {
      const verdict = await check.check(call, options.signal);
      risks = Array.isArray(verdict?.risks) ? verdict.risks.filter(risk => Object.hasOwn(RISK_LABELS, risk)) : ['unchecked'];
    } catch {
      risks = ['unchecked'];
    }
  }

  // The turn stopped while the check thought: nothing should run, and a prompt now would be a ghost.
  if (options.signal?.aborted) return { type: 'block', reason: 'The turn was stopped.' };
  // The mode changed meanwhile: decide under the current mode instead of returning a Guarded-mode allow.
  if (getPermissionModeDiagnostics(ctx.sessionId).permissionMode !== 'guarded') return runPreToolUseChecks(ctx);
  if (risks.length === 0) return result;

  const reason = risks.map(risk => RISK_LABELS[risk]).join(', ');
  ctx.onDebug?.(`Guarded mode: ${ctx.toolName} flagged (${reason})`);
  return {
    type: 'prompt',
    promptType: call.promptType,
    description: `Guarded mode (${reason}) · ${call.description}`,
    command: call.command,
    modifiedInput: result.type === 'modify' ? result.input : undefined,
  };
}
