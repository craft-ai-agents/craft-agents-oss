/**
 * Shared Utilities for Automations System
 *
 * Common helper functions used by both the legacy functional API (index.ts)
 * and the new Event Bus handlers (command-handler.ts, prompt-handler.ts).
 */

import { join } from 'node:path';
import type { BaseEventPayload } from './event-bus.ts';
import type { AutomationEvent, AutomationMatcher, PromptReferences, AgentEvent, SdkAutomationInput } from './types.ts';
import { matchesCron } from './cron-matcher.ts';
import { sanitizeForShell } from './security.ts';
import { evaluateConditions } from './conditions.ts';

// ============================================================================
// String Utilities
// ============================================================================

/**
 * Convert camelCase to SNAKE_CASE.
 *
 * @example
 * toSnakeCase('newStatus') // 'new_status'
 * toSnakeCase('toolName')  // 'tool_name'
 */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Expand environment variables in a string.
 * Supports both $VAR and ${VAR} syntax.
 *
 * @example
 * expandEnvVars('Hello $NAME', { NAME: 'World' }) // 'Hello World'
 * expandEnvVars('${GREETING} World', { GREETING: 'Hi' }) // 'Hi World'
 */
export function expandEnvVars(str: string, env: Record<string, string>): string {
  return str
    // Replace ${VAR} syntax
    .replace(/\$\{([^}]+)\}/g, (_, varName) => env[varName] ?? '')
    // Replace $VAR syntax (word boundary)
    .replace(/\$([A-Z_][A-Z0-9_]*)/gi, (_, varName) => env[varName] ?? '');
}

// ============================================================================
// Prompt Utilities
// ============================================================================

/**
 * Parse @mentions from a prompt (sources and skills both use @name syntax).
 *
 * Syntax:
 * - @name - references a source or skill (e.g., @linear, @github, @commit, @review-pr)
 *
 * References are case-insensitive and support hyphens (e.g., @my-source, @my-skill).
 * The caller should resolve which mentions are sources vs skills based on available configurations.
 */
export function parsePromptReferences(prompt: string): PromptReferences {
  const mentions: string[] = [];

  // Match @name (word characters and hyphens)
  // Avoid matching email addresses by requiring whitespace or start of string before @
  const matches = prompt.matchAll(/(?:^|[\s(])@([a-zA-Z][a-zA-Z0-9-]*)/g);
  for (const match of matches) {
    const captured = match[1];
    if (captured) {
      const mention = captured.toLowerCase();
      if (!mentions.includes(mention)) {
        mentions.push(mention);
      }
    }
  }

  return { mentions };
}

// ============================================================================
// Event Matching Utilities
// ============================================================================

/**
 * Get the match value for regex matching based on event type.
 * Uses the most complete version with data.data?.tool_name fallback for tool events.
 *
 * Accepts both plain data objects (legacy API) and BaseEventPayload (handler API).
 */
export function getMatchValue(event: AutomationEvent, data: Record<string, unknown>): string {
  switch (event) {
    case 'LabelAdd':
    case 'LabelRemove':
      return String(data.label ?? '');
    case 'LabelConfigChange':
      return ''; // Always matches
    case 'PermissionModeChange':
      return String(data.newMode ?? '');
    case 'FlagChange':
      return String(data.isFlagged ?? false);
    case 'SessionStatusChange':
      return String(data.newStatus ?? data.newState ?? '');
    case 'PreToolUse':
    case 'PostToolUse':
      return String(data.toolName ?? (data.data as Record<string, unknown>)?.tool_name ?? '');
    case 'SchedulerTick':
      // SchedulerTick uses cron matching, not regex
      return '';
    default:
      return JSON.stringify(data);
  }
}

/**
 * Get the match value for SDK agent events.
 * Mirrors the Claude SDK's `fieldToMatch` per event — each event type matches
 * against a specific field from the input.
 */
export function getMatchValueForSdkInput(event: AgentEvent, input: SdkAutomationInput): string {
  switch (event) {
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionRequest':
      return input.tool_name ?? '';
    case 'Notification':
      return input.message ?? '';
    case 'SessionStart':
      return input.source ?? '';
    case 'SubagentStart':
    case 'SubagentStop':
      return input.agent_type ?? '';
    default:
      // UserPromptSubmit, Stop, SessionEnd — no meaningful match field
      return '';
  }
}

export interface MatcherContext {
  /** Precomputed value used for regex matching */
  matchValue: string;
  /** Payload used for condition evaluation */
  payload: Record<string, unknown>;
  /** Fallback timezone source for time conditions */
  matcherTimezone?: string;
}

/**
 * Base matcher predicate (enabled flag + regex/cron). Intentionally internal.
 *
 * Do not call directly from feature code. Use matcherMatchesWithContext()/adapters
 * so condition gating is never bypassed.
 */
function matchesBasePredicate(matcher: AutomationMatcher, event: AutomationEvent, matchValue: string): boolean {
  if (matcher.enabled === false) return false;
  if (event === 'SchedulerTick') {
    return !!matcher.cron && matchesCron(matcher.cron, matcher.timezone);
  }
  if (!matcher.matcher) return true; // No matcher means match all
  try {
    return new RegExp(matcher.matcher).test(matchValue);
  } catch {
    return false; // Invalid regex — skip
  }
}

/**
 * Canonical matcher evaluation pipeline used by all automation entry points.
 */
export function matcherMatchesWithContext(
  matcher: AutomationMatcher,
  event: AutomationEvent,
  context: MatcherContext,
): boolean {
  if (!matchesBasePredicate(matcher, event, context.matchValue)) return false;

  if (matcher.conditions?.length) {
    return evaluateConditions(matcher.conditions, {
      payload: context.payload,
      matcherTimezone: context.matcherTimezone ?? matcher.timezone,
    });
  }

  return true;
}

/**
 * App-event adapter for canonical matcher evaluation.
 */
export function matcherMatches(matcher: AutomationMatcher, event: AutomationEvent, data: Record<string, unknown>): boolean {
  return matcherMatchesWithContext(matcher, event, {
    matchValue: getMatchValue(event, data),
    payload: data,
    matcherTimezone: matcher.timezone,
  });
}

/**
 * SDK agent-event adapter for canonical matcher evaluation.
 */
export function matcherMatchesSdk(matcher: AutomationMatcher, event: AgentEvent, input: SdkAutomationInput): boolean {
  return matcherMatchesWithContext(matcher, event, {
    matchValue: getMatchValueForSdkInput(event, input),
    payload: input as unknown as Record<string, unknown>,
    matcherTimezone: matcher.timezone,
  });
}

// ============================================================================
// Environment Variable Utilities
// ============================================================================

/**
 * Get process.env as a clean Record<string, string> with undefined values filtered out.
 * Avoids the unsafe `process.env as Record<string, string>` cast that turns undefined
 * values into the string "undefined".
 */
export function cleanEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
  );
}

/** Keys skipped when iterating payload fields for env vars */
const PAYLOAD_SKIP_KEYS = new Set(['sessionId', 'sessionName', 'workspaceId', 'timestamp']);

/**
 * Build the base CRAFT_* environment variables shared by both prompt and webhook actions.
 * Contains event info, session metadata, scheduler time, and payload fields (unsanitized).
 */
function buildBaseEventEnv(event: AutomationEvent, payload: BaseEventPayload): Record<string, string> {
  const env: Record<string, string> = {
    CRAFT_EVENT: event,
    CRAFT_EVENT_DATA: JSON.stringify(payload),
  };

  if (payload.sessionId) env.CRAFT_SESSION_ID = payload.sessionId;
  if (payload.sessionName) env.CRAFT_SESSION_NAME = payload.sessionName;
  if (payload.workspaceId) env.CRAFT_WORKSPACE_ID = payload.workspaceId;

  // Session metadata as JSON
  const sessionMetadata: Record<string, string> = {};
  if (payload.sessionId) sessionMetadata.id = payload.sessionId;
  if (payload.sessionName) sessionMetadata.name = payload.sessionName;
  if (Object.keys(sessionMetadata).length > 0) {
    env.CRAFT_SESSION_METADATA = JSON.stringify(sessionMetadata);
  }

  // Local time for scheduler events
  if (event === 'SchedulerTick') {
    const now = new Date();
    env.CRAFT_LOCAL_TIME = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    env.CRAFT_LOCAL_DATE = now.toISOString().split('T')[0]!;
  }

  // Payload fields as CRAFT_ vars (raw — callers apply sanitization if needed)
  for (const [key, value] of Object.entries(payload)) {
    if (PAYLOAD_SKIP_KEYS.has(key)) continue;
    const envKey = `CRAFT_${toSnakeCase(key).toUpperCase()}`;
    env[envKey] = typeof value === 'string' ? value : String(value);
  }

  return env;
}

/**
 * Build environment variables from an event payload for prompt/command actions.
 * Includes full process.env and sanitizes user-controlled values for shell safety.
 */
export function buildEnvFromPayload(event: AutomationEvent, payload: BaseEventPayload): Record<string, string> {
  const base = buildBaseEventEnv(event, payload);
  const env: Record<string, string> = { ...cleanEnv(), ...base };

  // Sanitize session name for shell context
  if (payload.sessionName) env.CRAFT_SESSION_NAME = sanitizeForShell(payload.sessionName);

  // Sanitize payload field values for shell context
  for (const [key, value] of Object.entries(payload)) {
    if (PAYLOAD_SKIP_KEYS.has(key)) continue;
    const envKey = `CRAFT_${toSnakeCase(key).toUpperCase()}`;
    env[envKey] = typeof value === 'string' ? sanitizeForShell(value) : String(value);
  }

  return env;
}

/**
 * Build environment variables for webhook actions.
 *
 * Unlike buildEnvFromPayload (used by prompt actions), this:
 * - Does NOT spread process.env (no secret leakage)
 * - Does NOT apply shell sanitization (irrelevant for HTTP context)
 * - Only injects CRAFT_WH_* user-defined vars from process.env (webhook secrets)
 * - Includes CRAFT_* system vars derived from the event payload
 *
 * Users set webhook secrets in their shell profile:
 *   export CRAFT_WH_SLACK_URL="https://hooks.slack.com/services/T.../B.../xxx"
 *   export CRAFT_WH_DISCORD_TOKEN="abc123"
 *
 * Then reference them in automations.json:
 *   "url": "${CRAFT_WH_SLACK_URL}"
 *   "headers": { "Authorization": "Bearer ${CRAFT_WH_DISCORD_TOKEN}" }
 */
export function buildWebhookEnv(event: AutomationEvent, payload: BaseEventPayload): Record<string, string> {
  const env = buildBaseEventEnv(event, payload);

  // User-defined webhook secrets: only CRAFT_WH_* from process.env
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CRAFT_WH_') && value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}

/**
 * Env vars that are not CRAFT_* but that script runtimes cannot function
 * without. Paths and OS plumbing only — never credentials.
 * - HOME/USERPROFILE: bun/uv cache + python interpreter installs
 * - SYSTEMROOT/WINDIR/SYSTEMDRIVE/COMSPEC/PATHEXT/TEMP/TMP: Windows can't
 *   spawn or do DNS/socket work without these
 */
const SCRIPT_ENV_PLATFORM_ESSENTIALS = process.platform === 'win32'
  ? ['USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']
  : ['HOME'];

export interface ScriptEnvOptions {
  /** Workspace root, exposed as CRAFT_WORKSPACE_PATH */
  workspaceRootPath: string;
  /** Page slug when the script refreshes a page (adds CRAFT_PAGE_* vars) */
  page?: string;
}

/**
 * Build environment variables for script actions: CRAFT_*-only by design.
 *
 * Unlike buildEnvFromPayload (prompt actions), process.env is NOT spread —
 * a script's env is exactly:
 * - every CRAFT_* var from process.env (runtime hints like CRAFT_BUN/CRAFT_UV,
 *   user-defined CRAFT_* secrets, CRAFT_CONFIG_DIR, ...)
 * - CRAFT_* event context (same base as webhooks; no shell sanitization —
 *   values are argv/env payloads, never interpreted by a shell)
 * - CRAFT_WORKSPACE_PATH and, for page refreshes, CRAFT_PAGE_SLUG /
 *   CRAFT_PAGE_DIR / CRAFT_PAGE_DATA_DIR
 * - a documented minimal set of non-secret platform essentials (HOME etc.)
 *
 * Notably absent: PATH (runtimes are spawned by absolute path) and every
 * non-CRAFT credential (ANTHROPIC_API_KEY, GITHUB_TOKEN, ...).
 */
function applyPlatformAndCraftEnv(env: Record<string, string>): void {
  for (const key of SCRIPT_ENV_PLATFORM_ESSENTIALS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CRAFT_') && value !== undefined) {
      env[key] = value;
    }
  }
}

function applyWorkspaceAndPageEnv(env: Record<string, string>, options: ScriptEnvOptions): void {
  env.CRAFT_WORKSPACE_PATH = options.workspaceRootPath;

  if (options.page) {
    const pageDir = join(options.workspaceRootPath, 'pages', options.page);
    env.CRAFT_PAGE_SLUG = options.page;
    env.CRAFT_PAGE_DIR = pageDir;
    env.CRAFT_PAGE_DATA_DIR = join(pageDir, 'data');
  }
}

/**
 * Event-independent script env: the CRAFT_*-only base without any automation
 * event context. Used by callers that run a script outside the automations
 * pipeline (e.g. a page action a user triggers by hand) — there is no event to
 * describe, so injecting a synthetic CRAFT_EVENT would be a lie.
 *
 * See buildScriptEnv for the full contract; this is that minus buildBaseEventEnv.
 */
export function buildBaseScriptEnv(options: ScriptEnvOptions): Record<string, string> {
  const env: Record<string, string> = {};
  applyPlatformAndCraftEnv(env);
  applyWorkspaceAndPageEnv(env, options);
  return env;
}

export function buildScriptEnv(
  event: AutomationEvent,
  payload: BaseEventPayload,
  options: ScriptEnvOptions,
): Record<string, string> {
  const env: Record<string, string> = {};

  applyPlatformAndCraftEnv(env);

  // Event context wins over any same-named pass-through
  Object.assign(env, buildBaseEventEnv(event, payload));

  // Workspace/page context is applied last so an event payload can never
  // clobber CRAFT_WORKSPACE_PATH / CRAFT_PAGE_* (unchanged ordering).
  applyWorkspaceAndPageEnv(env, options);

  return env;
}
