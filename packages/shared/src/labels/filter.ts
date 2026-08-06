/**
 * Label Filter Matching
 *
 * THE single predicate for "does this session match a label filter". Both the
 * session list (useSessionSearch) and the AppShell filtered-set computation
 * route through it so the two can never diverge (they previously disagreed on
 * descendant handling). Browser-safe: pure tree/string operations, no Node APIs.
 */

import { getDescendantIds } from './tree.ts';
import { extractLabelId } from './values.ts';
import type { LabelConfig } from './types.ts';

/** Minimal structural session shape — the renderer's SessionMeta satisfies this. */
export interface LabelFilterableSession {
  labels?: string[];
  projectId?: string;
}

export interface LabelFilterInput {
  /** Label id to match, or '__all__' for "any labeled session". */
  labelId: string;
  /** When set, the session must additionally belong to this project. */
  projectId?: string;
}

/**
 * Resolve the reserved "Task" ROOT label from a label tree: a root label matching
 * id `task` or case-insensitive name. THE single resolution predicate — the
 * server's ensureTaskLabel creates through it, and the board's tile-click
 * navigation resolves through it, so the two can never disagree. Plain label
 * (valueType is irrelevant; legacy roots created as `valueType: 'number'` still
 * match and are converged by ensureTaskLabel). Each individual task is a CHILD
 * label under this root (`TASK-<slug>-<N>` — see ensureTaskItemLabel), so one
 * label filters one task's whole family. Returns undefined when the workspace
 * has no such label yet.
 */
export function findTaskLabel(labels: LabelConfig[]): LabelConfig | undefined {
  return labels.find(l => l.id === 'task' || l.name.trim().toLowerCase() === 'task');
}

/**
 * The per-task ITEM label a session carries: its first label entry that is a
 * DESCENDANT of the reserved Task root (never the root itself). This is the id
 * task flows filter by and inherit across parent → subtask. Undefined when the
 * session isn't item-labeled (plain chats, legacy `task::N`-only sessions).
 */
export function findTaskItemLabelId(
  sessionLabels: string[] | undefined,
  labelConfigs: LabelConfig[],
): string | undefined {
  if (!sessionLabels?.length) return undefined;
  const root = findTaskLabel(labelConfigs);
  if (!root) return undefined;
  const itemIds = new Set(getDescendantIds(labelConfigs, root.id));
  return sessionLabels.map(extractLabelId).find(id => itemIds.has(id));
}

/**
 * The label id a task click should FILTER by for a given session: its per-task
 * item label when it has one, else the Task root when the session is tagged with
 * it (legacy `task::N` sessions — filtering by root still shows every task), else
 * undefined (not a task at all → callers fall back to plain navigation).
 */
export function resolveTaskScopeLabelId(
  sessionLabels: string[] | undefined,
  labelConfigs: LabelConfig[],
): string | undefined {
  const item = findTaskItemLabelId(sessionLabels, labelConfigs);
  if (item) return item;
  const root = findTaskLabel(labelConfigs);
  if (root && sessionLabels?.some(entry => extractLabelId(entry) === root.id)) return root.id;
  return undefined;
}

/**
 * True when the session matches the label filter:
 * - `projectId`, when present, must equal the session's project (applies to '__all__' too)
 * - '__all__' → any session with at least one label
 * - specific id → tagged with the label or any of its descendants; valued entries
 *   like `task::3` match by base id
 *
 * Archived-ness is deliberately NOT considered here — callers own that policy.
 */
export function matchesLabelFilter(
  session: LabelFilterableSession,
  filter: LabelFilterInput,
  labelConfigs: LabelConfig[],
): boolean {
  if (filter.projectId && session.projectId !== filter.projectId) return false;
  if (!session.labels?.length) return false;
  if (filter.labelId === '__all__') return true;
  const matchIds = new Set([filter.labelId, ...getDescendantIds(labelConfigs, filter.labelId)]);
  return session.labels.some(entry => matchIds.has(extractLabelId(entry)));
}
