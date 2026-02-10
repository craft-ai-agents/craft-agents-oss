/**
 * Shared Utilities for Hooks System
 *
 * Common helper functions used by both the legacy functional API (index.ts)
 * and the new Event Bus handlers (command-handler.ts, prompt-handler.ts).
 */

import type { BaseEventPayload } from './event-bus.ts';
import type { HookEvent, HookMatcher, PromptReferences } from './types.ts';
import { matchesCron } from './cron-matcher.ts';
import { sanitizeForShell } from './security.ts';

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
export function getMatchValue(event: HookEvent, data: Record<string, unknown>): string {
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
    case 'TodoStateChange':
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
 * Check if a matcher matches the given event and data.
 */
export function matcherMatches(matcher: HookMatcher, event: HookEvent, data: Record<string, unknown>): boolean {
  if (matcher.enabled === false) return false;
  if (event === 'SchedulerTick') {
    // Use cron matching for SchedulerTick
    return !!matcher.cron && matchesCron(matcher.cron, matcher.timezone);
  }

  // Use regex matching for other events
  const matchValue = getMatchValue(event, data);
  if (!matcher.matcher) return true; // No matcher means match all
  return new RegExp(matcher.matcher).test(matchValue);
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

/**
 * Build environment variables from an event payload.
 * Sanitizes user-controlled values using sanitizeForShell.
 */
export function buildEnvFromPayload(event: HookEvent, payload: BaseEventPayload): Record<string, string> {
  const env: Record<string, string> = {
    ...cleanEnv(),
    CRAFT_EVENT: event,
    CRAFT_EVENT_DATA: JSON.stringify(payload),
  };

  if (payload.sessionId) env.CRAFT_SESSION_ID = payload.sessionId;
  if (payload.sessionName) env.CRAFT_SESSION_NAME = sanitizeForShell(payload.sessionName);
  if (payload.workspaceId) env.CRAFT_WORKSPACE_ID = payload.workspaceId;

  // Add session metadata as JSON (includes sessionId, sessionName if available)
  const sessionMetadata: Record<string, string> = {};
  if (payload.sessionId) sessionMetadata.id = payload.sessionId;
  if (payload.sessionName) sessionMetadata.name = payload.sessionName;
  if (Object.keys(sessionMetadata).length > 0) {
    env.CRAFT_SESSION_METADATA = JSON.stringify(sessionMetadata);
  }

  // Add local time for scheduler events
  if (event === 'SchedulerTick') {
    const now = new Date();
    env.CRAFT_LOCAL_TIME = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    env.CRAFT_LOCAL_DATE = now.toISOString().split('T')[0]!;
  }

  // Add payload fields as individual env vars
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'sessionId' || key === 'sessionName' || key === 'workspaceId' || key === 'timestamp') continue;
    const envKey = `CRAFT_${toSnakeCase(key).toUpperCase()}`;
    // Sanitize user-controlled values
    const sanitized = typeof value === 'string' ? sanitizeForShell(value) : String(value);
    env[envKey] = sanitized;
  }

  return env;
}
