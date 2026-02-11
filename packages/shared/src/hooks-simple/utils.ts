/**
 * Hook Utilities
 *
 * Environment variable expansion, matcher logic, and references.
 */

import type {
  HookEventType,
  HookMatcher,
  BaseEventPayload,
  LabelAddPayload,
  LabelRemovePayload,
  PreToolUsePayload,
  PostToolUsePayload,
  PostToolUseFailurePayload,
  SubagentStartPayload,
  SubagentStopPayload,
  PermissionModeChangePayload,
  FlagChangePayload,
  TodoStateChangePayload,
  EventPayloadMap,
} from './types.ts';
import { sanitizeForShell } from './security.ts';

// ============================================================
// Environment Variable Expansion
// ============================================================

/**
 * Build environment variables from an event payload.
 * These are available to command hooks via process.env.
 */
export function buildEventEnv(
  event: HookEventType,
  payload: BaseEventPayload,
): Record<string, string> {
  const env: Record<string, string> = {
    G4OS_HOOK_EVENT: event,
    G4OS_WORKSPACE_ID: payload.workspaceId,
    G4OS_TIMESTAMP: String(payload.timestamp),
  };

  if (payload.sessionId) {
    env.G4OS_SESSION_ID = payload.sessionId;
  }

  // Event-specific variables
  switch (event) {
    case 'LabelAdd':
    case 'LabelRemove': {
      const labelPayload = payload as LabelAddPayload | LabelRemovePayload;
      env.G4OS_LABEL = sanitizeForShell(labelPayload.label);
      env.G4OS_ALL_LABELS = labelPayload.allLabels.map(l => sanitizeForShell(l)).join(',');
      break;
    }
    case 'PermissionModeChange': {
      const modePayload = payload as PermissionModeChangePayload;
      env.G4OS_OLD_MODE = modePayload.oldMode;
      env.G4OS_NEW_MODE = modePayload.newMode;
      break;
    }
    case 'FlagChange': {
      const flagPayload = payload as FlagChangePayload;
      env.G4OS_IS_FLAGGED = String(flagPayload.isFlagged);
      break;
    }
    case 'TodoStateChange': {
      const todoPayload = payload as TodoStateChangePayload;
      if (todoPayload.oldState) env.G4OS_OLD_TODO_STATE = sanitizeForShell(todoPayload.oldState);
      if (todoPayload.newState) env.G4OS_NEW_TODO_STATE = sanitizeForShell(todoPayload.newState);
      break;
    }
    case 'PreToolUse':
    case 'PostToolUse': {
      const toolPayload = payload as PreToolUsePayload | PostToolUsePayload;
      env.G4OS_TOOL_NAME = sanitizeForShell(toolPayload.toolName);
      break;
    }
    case 'PostToolUseFailure': {
      const failPayload = payload as PostToolUseFailurePayload;
      env.G4OS_TOOL_NAME = sanitizeForShell(failPayload.toolName);
      env.G4OS_ERROR = sanitizeForShell(failPayload.error.substring(0, 500));
      break;
    }
    case 'SubagentStart': {
      const startPayload = payload as SubagentStartPayload;
      if (startPayload.agentId) env.G4OS_AGENT_ID = sanitizeForShell(startPayload.agentId);
      if (startPayload.agentType) env.G4OS_AGENT_TYPE = sanitizeForShell(startPayload.agentType);
      break;
    }
    case 'SubagentStop': {
      const stopPayload = payload as SubagentStopPayload;
      if (stopPayload.agentId) env.G4OS_AGENT_ID = sanitizeForShell(stopPayload.agentId);
      break;
    }
  }

  return env;
}

// ============================================================
// Matcher Logic
// ============================================================

/**
 * Get the primary match value for an event.
 * This is the value tested against the matcher regex.
 */
export function getMatchValue(
  event: HookEventType,
  payload: BaseEventPayload,
): string | null {
  switch (event) {
    case 'LabelAdd':
    case 'LabelRemove':
      return (payload as LabelAddPayload | LabelRemovePayload).label;
    case 'PreToolUse':
    case 'PostToolUse':
      return (payload as PreToolUsePayload | PostToolUsePayload).toolName;
    case 'PostToolUseFailure':
      return (payload as PostToolUseFailurePayload).toolName;
    case 'PermissionModeChange':
      return (payload as PermissionModeChangePayload).newMode;
    case 'FlagChange':
      return String((payload as FlagChangePayload).isFlagged);
    case 'TodoStateChange':
      return (payload as TodoStateChangePayload).newState ?? '';
    case 'SubagentStart':
      return (payload as SubagentStartPayload).agentType ?? '';
    case 'SubagentStop':
      return (payload as SubagentStopPayload).agentId ?? '';
    default:
      return null;
  }
}

/**
 * Test if a matcher matches the given event and payload.
 */
export function matchesEvent(
  matcher: HookMatcher,
  event: HookEventType,
  payload: BaseEventPayload,
  sessionLabels?: string[],
): boolean {
  // Label filter: if specified, session must have one of these labels
  if (matcher.labels && matcher.labels.length > 0 && sessionLabels) {
    const hasMatchingLabel = matcher.labels.some(l => sessionLabels.includes(l));
    if (!hasMatchingLabel) {
      return false;
    }
  }

  // Regex matcher: test against the event's primary value
  if (matcher.matcher) {
    const value = getMatchValue(event, payload);
    if (value === null) {
      // Event type has no match value — matcher always matches
      return true;
    }
    try {
      const regex = new RegExp(matcher.matcher);
      return regex.test(value);
    } catch {
      // Invalid regex — skip
      return false;
    }
  }

  // No matcher specified = match all events of this type
  return true;
}

/**
 * Expand template variables in a string using event payload.
 * Supports {{variable}} syntax.
 */
export function expandTemplate(
  template: string,
  event: HookEventType,
  payload: BaseEventPayload,
): string {
  const env = buildEventEnv(event, payload);
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const envKey = `G4OS_${key.toUpperCase()}`;
    return env[envKey] ?? match;
  });
}
