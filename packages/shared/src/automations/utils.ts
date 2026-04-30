/**
 * Shared Utilities for Automations System
 *
 * Common helper functions used by both the legacy functional API (index.ts)
 * and the new Event Bus handlers (command-handler.ts, prompt-handler.ts).
 */

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
    case 'WebhookReceive':
      return String(data.slug ?? '');
    case 'FileWatch':
      return String(data.relativePath ?? '');
    case 'PollUrl':
      return String(data.url ?? '');
    case 'MessageReceive':
      return String(data.text ?? '');
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
  // WebhookReceive: slug is an exact-match URL identifier. The trigger server
  // already routes by slug, but matchers without a slug must NOT match (they'd
  // fire on every inbound webhook regardless of URL).
  if (event === 'WebhookReceive') {
    if (!matcher.slug) return false;
    if (matcher.slug !== matchValue) return false;
    // After slug match, the optional regex `matcher` provides extra filtering on slug
    if (!matcher.matcher) return true;
    try {
      return new RegExp(matcher.matcher).test(matchValue);
    } catch {
      return false;
    }
  }
  // FileWatch and PollUrl are per-matcher: the producing service has already
  // selected the target matcher and stamped its ID into the payload. The base
  // predicate's job here is to ensure no OTHER matcher of the same event type
  // accidentally fires. The `matcher` field of the event-bus iteration loop
  // is checked against the payload's matcherId via matcherMatchesWithContext
  // (see below). Without a matcher.id, fail closed to avoid cross-firing.
  if (event === 'FileWatch' || event === 'PollUrl') {
    if (!matcher.id) return false;
    // matchValue here is the relativePath (FileWatch) or url (PollUrl).
    // Optional regex `matcher` is an additional filter; matcherId equality
    // is enforced separately below.
    if (!matcher.matcher) return true;
    try {
      return new RegExp(matcher.matcher).test(matchValue);
    } catch {
      return false;
    }
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
  // Per-matcher events (FileWatch, PollUrl): the producing service has already
  // selected the target matcher and stamped its ID. Reject any other matcher
  // of the same event type so they don't cross-fire on shared payloads.
  if (event === 'FileWatch' || event === 'PollUrl') {
    const payloadMatcherId = context.payload.matcherId;
    if (typeof payloadMatcherId === 'string' && matcher.id !== payloadMatcherId) {
      return false;
    }
  }

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

const EXTERNAL_INPUT_EVENTS = new Set<AutomationEvent>([
  'WebhookReceive',
  'FileWatch',
  'PollUrl',
  'MessageReceive',
]);

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
 * Convert a single payload value to its env-var string form.
 * Strings/numbers/booleans pass through cleanly; objects/arrays become JSON;
 * null/undefined become an empty string (env-var convention).
 */
function payloadValueToEnvString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Objects, arrays — JSON-stringify so users can pipe through jq.
  // Avoid the legacy "[object Object]" footgun.
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/** Sanitize a string segment for use as an env-var name suffix. */
function envKeySanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
}

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
    env[envKey] = payloadValueToEnvString(value);
  }

  // External-input convenience vars: explode `headers` and `query` records into
  // CRAFT_HEADER_<KEY> / CRAFT_QUERY_<KEY> so users can `${CRAFT_HEADER_X_GITHUB_EVENT}`
  // in prompts without piping CRAFT_EVENT_DATA through jq.
  if (event === 'WebhookReceive') {
    const p = payload as unknown as Record<string, unknown>;
    expandRecord(env, 'CRAFT_HEADER_', p.headers);
    expandRecord(env, 'CRAFT_QUERY_', p.query);
  }

  return env;
}

function expandRecord(env: Record<string, string>, prefix: string, source: unknown): void {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return;
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
    if (!k) continue;
    const key = `${prefix}${envKeySanitize(k)}`;
    if (typeof v === 'string') env[key] = v;
    else if (v != null) env[key] = payloadValueToEnvString(v);
  }
}

/**
 * Build environment variables from an event payload for prompt/command actions.
 * Includes full process.env and sanitizes user-controlled values for shell safety.
 */
export function buildEnvFromPayload(event: AutomationEvent, payload: BaseEventPayload): Record<string, string> {
  const base = buildBaseEventEnv(event, payload);
  const env: Record<string, string> = { ...cleanEnv(), ...base };

  sanitizeEventEnvValues(env, payload);

  return env;
}

/**
 * Build environment variables for prompt actions.
 *
 * Internal app/session events keep the legacy process.env expansion behavior.
 * External-input events are intentionally constrained to event-derived CRAFT_*
 * vars plus explicit CRAFT_WH_* allowlisted process vars, so prompt templates
 * cannot accidentally leak arbitrary host secrets into model context.
 */
export function buildPromptEnvFromPayload(event: AutomationEvent, payload: BaseEventPayload): Record<string, string> {
  if (!EXTERNAL_INPUT_EVENTS.has(event)) {
    return buildEnvFromPayload(event, payload);
  }

  const env = buildBaseEventEnv(event, payload);
  addWebhookAllowlistedEnv(env);
  return env;
}

function sanitizeEventEnvValues(env: Record<string, string>, payload: BaseEventPayload): void {
  // Sanitize session name for shell context
  if (payload.sessionName) env.CRAFT_SESSION_NAME = sanitizeForShell(payload.sessionName);

  // Sanitize payload field values for shell context. Re-stringify objects
  // properly here too — base already did this, but the loop overwrites with
  // the sanitized string version.
  for (const [key, value] of Object.entries(payload)) {
    if (PAYLOAD_SKIP_KEYS.has(key)) continue;
    const envKey = `CRAFT_${toSnakeCase(key).toUpperCase()}`;
    if (typeof value === 'string') {
      env[envKey] = sanitizeForShell(value);
    } else {
      env[envKey] = payloadValueToEnvString(value);
    }
  }
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

  addWebhookAllowlistedEnv(env);

  return env;
}

function addWebhookAllowlistedEnv(env: Record<string, string>): void {
  // User-defined webhook/prompt external-event secrets: only CRAFT_WH_* from process.env
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CRAFT_WH_') && value !== undefined) {
      env[key] = value;
    }
  }
}
