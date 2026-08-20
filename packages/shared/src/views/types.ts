/**
 * View Types
 *
 * Views are dynamic, user-configurable filters computed from entity state
 * using Filtrex expressions. Session views are never persisted on sessions —
 * purely runtime. Knowledge views may also carry a structured knowledgeFilter
 * compiled to SearchInput (K-09 §3.5 / P5).
 *
 * Stored in views.json at the workspace root.
 */

import type { EntityColor } from '../colors/types.ts';

/** Domain a view applies to. Default 'sessions' for back-compat with views.json v1. */
export type ViewDomain = 'sessions' | 'knowledge';

/**
 * Knowledge-only structured filter compiled to SearchInput.
 * When set, expression may still post-filter evaluation context.
 */
export interface KnowledgeViewFilter {
  /** Notebook name or id hint → pathPrefix '/{notebook}' or notebookId if looks like id */
  notebook?: string;
  notebookId?: string;
  pathPrefix?: string;
  attributes?: Record<string, string>;
  kinds?: Array<'document' | 'block' | 'notebook' | 'database' | 'asset'>;
  /** Optional full-text seed */
  query?: string;
}

export type KnowledgeViewPresetAction =
  | { type: 'set_attribute'; name: string; value: string }
  | { type: 'open' }
  | { type: 'run_skill'; skill: string };

/**
 * View configuration as stored in views.json.
 * Each view defines a Filtrex expression evaluated against entity context.
 */
export interface ViewConfig {
  /** Unique ID slug */
  id: string;

  /** Display name (shown as badge text, e.g. "PLAN", "NEW") */
  name: string;

  /** Human-readable description of what this view detects */
  description?: string;

  /** Optional color for badge rendering */
  color?: EntityColor;

  /**
   * Filtrex expression evaluated against session/knowledge context.
   * Must return a truthy value for the view to match.
   * Supports dot notation for nested fields (e.g. tokenUsage.costUsd, attributes.workflow_status).
   * @example "hasUnread == true"
   * @example "tokenUsage.costUsd > 1"
   * @example "daysSince(lastUsedAt) > 7"
   */
  expression: string;

  /** default 'sessions' for back-compat with existing views.json */
  domain?: ViewDomain;

  /** Knowledge-only structured filter (compiled to SearchInput). */
  knowledgeFilter?: KnowledgeViewFilter;

  /** Optional display hints (not enforced by engine v1 beyond UI) */
  groupBy?: string; // e.g. 'topic' | 'notebook' | 'status'

  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;

  /** Preset bulk actions for knowledge views */
  presetActions?: KnowledgeViewPresetAction[];
}

/**
 * Compiled view — config paired with its compiled Filtrex function.
 * The compiled function is a native JS function (fast hot path).
 * Compilation happens once on config load; execution is O(1).
 */
export interface CompiledView {
  config: ViewConfig;
  /**
   * Compiled Filtrex function: takes a plain context object, returns truthy/falsy.
   * Accepts session ViewEvaluationContext or KnowledgeViewEvaluationContext.
   */
  evaluate: (context: object) => unknown;
}

/**
 * Evaluation context built from SessionMeta + runtime state.
 * These are all the fields available inside session view expressions.
 *
 * The evaluator builds this object once per session and passes it to
 * all compiled view functions.
 */
export interface ViewEvaluationContext {
  // === Strings ===
  /** Session name */
  name: string;
  /** Preview text (first 150 chars of first user message) */
  preview: string;
  /** Status ID (e.g. 'todo', 'in-progress', 'done') */
  sessionStatus: string;
  /** @deprecated Use `sessionStatus` instead. Kept for backward compatibility with existing view expressions. */
  todoState: string;
  /** Permission mode (canonical: 'explore'|'ask'|'execute'; internal: 'safe'|'ask'|'allow-all') */
  permissionMode: string;
  /** Model override string */
  model: string;
  /** Role of last message ('user', 'assistant', 'plan', 'tool', 'error') */
  lastMessageRole: string;

  // === Numbers ===
  /** Timestamp (ms) of last activity */
  lastUsedAt: number;
  /** Timestamp (ms) of session creation */
  createdAt: number;
  /** Total number of messages in the session */
  messageCount: number;
  /** Number of labels on the session */
  labelCount: number;

  // === Booleans ===
  /** Whether session is starred */
  isFlagged: boolean;
  /** Whether session has unread messages */
  hasUnread: boolean;
  /** Whether agent is currently running */
  isProcessing: boolean;
  /** Whether there's a pending plan to accept (lastMessageRole == 'plan') */
  hasPendingPlan: boolean;

  // === Nested Objects (accessed via dot notation) ===
  /** Token usage stats — access via tokenUsage.costUsd, tokenUsage.totalTokens, etc. */
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    contextTokens: number;
  };

  // === Arrays ===
  /** Labels array (bare IDs for contains() checks) */
  labels: string[];
}

/**
 * Evaluation context for knowledge views (K-09 / P5).
 * Built from SearchHit + optional KnowledgeNode + KnowledgeWorkEnvelope.
 */
export interface KnowledgeViewEvaluationContext {
  title: string;
  notebook: string;
  path: string;
  kind: string;
  updatedAt: number;
  /** Dot access attributes.workflow_status */
  attributes: Record<string, string>;
  /** attributes.topic || '' */
  topic: string;
  backlinkCount: number;
  /** envelope.status || '' */
  status: string;
  /** envelope.labels || [] */
  labels: string[];
  flagged: boolean;
  archived: boolean;
}
