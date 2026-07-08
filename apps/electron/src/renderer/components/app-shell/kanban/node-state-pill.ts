// Renderer-local mapping for per-node run-state pills in the Results panel.
// Kept out of @craft-agent/shared (Node-only) — the renderer can't import it.
// Keys are 1:1 with the NodeRunState literals the runner emits
// (packages/shared/src/tasks/storage.ts): pending | running | done | failed | cancelled | skipped.

const NEUTRAL_PILL = 'border-border bg-foreground/[0.06] text-foreground/55'

const NODE_STATE_PILL: Record<string, string> = {
  done: 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-300',
  failed: 'border-red-500/30 bg-red-500/[0.06] text-red-600 dark:text-red-300',
  running: 'border-amber-500/30 bg-amber-500/[0.06] text-amber-600 dark:text-amber-300',
  // cancelled is a user/system stop, not a failure — keep it neutral so it never reads as red/error.
  cancelled: NEUTRAL_PILL,
  skipped: NEUTRAL_PILL,
  pending: NEUTRAL_PILL,
}

const NODE_STATE_LABEL_KEY: Record<string, string> = {
  done: 'tasks.nodeStateDone',
  failed: 'tasks.nodeStateFailed',
  running: 'tasks.nodeStateRunning',
  cancelled: 'tasks.nodeStateCancelled',
  skipped: 'tasks.nodeStateSkipped',
  pending: 'tasks.nodeStatePending',
}

/**
 * Resolve a node-state string to its pill classes + i18n label key.
 * Unknown/unexpected states fall back to a neutral pill with `labelKey: null`;
 * the caller renders the raw state string as the label in that case.
 */
export function resolveNodeStatePill(state: string): { className: string; labelKey: string | null } {
  return {
    className: NODE_STATE_PILL[state] ?? NEUTRAL_PILL,
    labelKey: NODE_STATE_LABEL_KEY[state] ?? null,
  }
}
