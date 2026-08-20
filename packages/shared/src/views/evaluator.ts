/**
 * View Evaluator
 *
 * Compiles Filtrex expressions into native JS functions (once, on config load)
 * and evaluates them against session or knowledge context (per render).
 *
 * Architecture:
 *   config load → compileAllViews() → CompiledView[]  (cached)
 *   per render  → evaluateViews(context, compiled) → matching ViewConfig[]
 *
 * Performance: Compilation is one-time overhead; evaluation runs at native JS speed.
 */

import { compileExpression, useDotAccessOperatorAndOptionalChaining } from 'filtrex';
import type {
  ViewConfig,
  CompiledView,
  ViewEvaluationContext,
  KnowledgeViewEvaluationContext,
} from './types.ts';
import { VIEW_FUNCTIONS } from './functions.ts';
import { debug } from '../utils/debug.ts';

/**
 * Compile a single view expression into a native JS function.
 * Uses dot notation (tokenUsage.costUsd) and optional chaining (null-safe).
 * Returns null if compilation fails (invalid expression).
 */
export function compileView(config: ViewConfig): CompiledView | null {
  try {
    const fn = compileExpression(config.expression, {
      // Enable dot.notation for nested fields (e.g. tokenUsage.costUsd)
      // and optional chaining so accessing props of undefined doesn't throw
      customProp: useDotAccessOperatorAndOptionalChaining,
      extraFunctions: VIEW_FUNCTIONS,
      // Filtrex has no native boolean type — without this, `true`/`false` in
      // expressions are parsed as property name lookups (returning undefined).
      constants: { true: true, false: false },
    });

    return {
      config,
      evaluate: fn as (context: object) => unknown,
    };
  } catch (error) {
    debug(`[views] Failed to compile expression for "${config.id}": ${config.expression}`, error);
    return null;
  }
}

/**
 * Compile all view configs. Skips invalid expressions with a warning.
 * Call once on config load, then cache the result.
 */
export function compileAllViews(configs: ViewConfig[]): CompiledView[] {
  const compiled: CompiledView[] = [];

  for (const config of configs) {
    const result = compileView(config);
    if (result) {
      compiled.push(result);
    }
    // Invalid expressions are logged in compileView and silently skipped
  }

  return compiled;
}

/**
 * Evaluate all compiled views against a context object.
 * Returns the configs of matching views (expression returned truthy).
 *
 * Accepts session ViewEvaluationContext or KnowledgeViewEvaluationContext
 * (filtrex takes plain objects).
 *
 * Each evaluation is a native JS function call — very fast.
 * Errors during evaluation (e.g. runtime type issues) are caught per-view
 * so one broken expression doesn't prevent others from matching.
 */
export function evaluateViews(
  context: object,
  compiled: CompiledView[]
): ViewConfig[] {
  const matches: ViewConfig[] = [];

  for (const { config, evaluate } of compiled) {
    try {
      const result = evaluate(context);
      if (result) {
        matches.push(config);
      }
    } catch {
      // Silently skip — runtime errors in individual expressions
      // shouldn't break the entire view evaluation pipeline
    }
  }

  return matches;
}

/**
 * Evaluate a single compiled view against a context (truthy match).
 */
export function evaluateView(context: object, compiled: CompiledView): boolean {
  try {
    return Boolean(compiled.evaluate(context));
  } catch {
    return false;
  }
}

/**
 * Build an evaluation context from session metadata.
 * Maps the SessionMeta-shaped object to the flat context expected by expressions.
 *
 * This is called once per session per render cycle.
 * The context includes computed fields (hasPendingPlan) derived from raw session data.
 */
export function buildViewContext(meta: {
  name?: string;
  preview?: string;
  sessionStatus?: string;
  permissionMode?: string;
  model?: string;
  lastMessageRole?: string;
  lastMessageAt?: number;
  createdAt?: number;
  messageCount?: number;
  isFlagged?: boolean;
  hasUnread?: boolean;
  isProcessing?: boolean;
  labels?: string[];
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
    contextTokens?: number;
  };
}): ViewEvaluationContext {
  return {
    // Strings (default to empty string for safe expression evaluation)
    name: meta.name ?? '',
    preview: meta.preview ?? '',
    sessionStatus: meta.sessionStatus ?? '',
    todoState: meta.sessionStatus ?? '',  // Deprecated alias — existing expressions using todoState still work
    permissionMode: meta.permissionMode ?? '',
    model: meta.model ?? '',
    lastMessageRole: meta.lastMessageRole ?? '',

    // Numbers
    lastUsedAt: meta.lastMessageAt ?? 0,
    createdAt: meta.createdAt ?? 0,
    messageCount: meta.messageCount ?? 0,
    labelCount: meta.labels?.length ?? 0,

    // Booleans
    isFlagged: meta.isFlagged ?? false,
    hasUnread: meta.hasUnread ?? false,
    isProcessing: meta.isProcessing ?? false,
    // Derived: hasPendingPlan is true when last message is a plan
    hasPendingPlan: meta.lastMessageRole === 'plan',

    // Nested objects (safe defaults for dot access)
    tokenUsage: {
      inputTokens: meta.tokenUsage?.inputTokens ?? 0,
      outputTokens: meta.tokenUsage?.outputTokens ?? 0,
      totalTokens: meta.tokenUsage?.totalTokens ?? 0,
      costUsd: meta.tokenUsage?.costUsd ?? 0,
      contextTokens: meta.tokenUsage?.contextTokens ?? 0,
    },

    // Arrays
    labels: meta.labels ?? [],
  };
}

/** Minimal hit/node/envelope shapes accepted by buildKnowledgeViewContext (no hard dep on core). */
export interface KnowledgeViewContextHit {
  title?: string;
  snippet?: string;
  notebookPath?: string;
  updatedAt?: number;
  ref?: { kind?: string; id?: string };
  path?: string;
  /** Optional — SearchHit does not carry attributes today */
  attributes?: Record<string, string> | Array<{ key: string; value: string }>;
}

export interface KnowledgeViewContextNode {
  title?: string;
  path?: string;
  updatedAt?: number;
  ref?: { kind?: string };
  attributes?: Array<{ key: string; value: string }> | Record<string, string>;
}

export interface KnowledgeViewContextEnvelope {
  status?: string;
  labels?: string[];
  flagged?: boolean;
  archived?: boolean;
}

function attributesToRecord(
  attrs?: Record<string, string> | Array<{ key: string; value: string }>,
): Record<string, string> {
  if (!attrs) return {};
  if (Array.isArray(attrs)) {
    const out: Record<string, string> = {};
    for (const a of attrs) {
      if (a && typeof a.key === 'string') out[a.key] = String(a.value ?? '');
    }
    return out;
  }
  return { ...attrs };
}

/**
 * Build a knowledge view evaluation context from a search hit and optional node/envelope.
 */
export function buildKnowledgeViewContext(
  hit: KnowledgeViewContextHit,
  node?: KnowledgeViewContextNode | null,
  envelope?: KnowledgeViewContextEnvelope | null,
): KnowledgeViewEvaluationContext {
  const attributes = {
    ...attributesToRecord(hit.attributes),
    ...attributesToRecord(node?.attributes),
  };
  const path = node?.path ?? hit.path ?? hit.notebookPath ?? '';
  const notebook =
    hit.notebookPath?.split('/').filter(Boolean)[0] ??
    path.split('/').filter(Boolean)[0] ??
    '';
  return {
    title: node?.title ?? hit.title ?? '',
    notebook,
    path,
    kind: node?.ref?.kind ?? hit.ref?.kind ?? '',
    updatedAt: node?.updatedAt ?? hit.updatedAt ?? 0,
    attributes,
    topic: attributes.topic ?? '',
    backlinkCount: 0,
    status: envelope?.status ?? '',
    labels: envelope?.labels ?? [],
    flagged: envelope?.flagged ?? false,
    archived: envelope?.archived ?? false,
  };
}
