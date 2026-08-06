/**
 * Pure spec ↔ editor-form conversion for the Tasks DAG authoring surface.
 *
 * Extracted from `TaskEditor.tsx` so the round-trip (generated spec → editable rows →
 * spec sent to `tasks:create`) can be unit-tested without the React component tree.
 *
 * The critical invariant lives here: a node id authored by the generator (and referenced
 * by sibling prompts via `${nodes.<id>.output}`) must survive the round-trip unchanged,
 * otherwise those references dangle and `tasks:create` rejects the spec.
 */

// Repair-attempt caps. The canonical source is `DEFAULT_REPAIR_ATTEMPTS` / `MAX_REPAIR_ATTEMPTS_CAP`
// in `packages/shared/src/tasks/schema.ts` (used by the runner + schema validation). The renderer
// can't import that module — its barrel pulls `storage.ts`, which uses `fs` — so these mirror the
// backend values for the editor's numeric control. Keep the two in sync if the backend caps change.
export const DEFAULT_REPAIR_ATTEMPTS = 3
export const MAX_REPAIR_ATTEMPTS_CAP = 10

let _uid = 0
/** Monotonic local row id (not the task node id). Shared so editor + conversions never collide. */
export const uid = (): string => `st-${++_uid}`

/**
 * Deterministic spec-node id for a quick-add child session adopted into a task's DAG:
 * `qa-<sessionId>`. The adoption linkage lives in the node id itself — no session
 * stamping, no title matching: the editor skips re-merging a child whose qa-id is
 * already a spec node, and the board binds that node row back to the original session
 * until a Conductor run supersedes it (a `taskNodeId` match wins). Session ids are
 * lowercase slug-safe (`260703-agile-moor`), so the result satisfies the schema's
 * node-id SLUG_RE.
 */
export const QUICK_ADD_NODE_PREFIX = 'qa-'
export const quickAddNodeId = (sessionId: string): string => `${QUICK_ADD_NODE_PREFIX}${sessionId}`
/** Inverse of {@link quickAddNodeId}: the adopted session id, or undefined for ordinary node ids. */
export const quickAddSessionId = (nodeId: string): string | undefined =>
  nodeId.startsWith(QUICK_ADD_NODE_PREFIX) ? nodeId.slice(QUICK_ADD_NODE_PREFIX.length) : undefined

/**
 * Map a quick-add child session onto an adopted DAG subtask row. Pure (the caller resolves `title`)
 * so the model/connection-preservation contract is unit-testable without the editor. Keeps
 * `model`/`llmConnection` only when the child had explicit ones (undefined → inherit the orchestrator
 * default), so adopting a custom-routed quick-add child doesn't silently drop its backend.
 */
export function quickAddChildToSubtask(child: {
  sessionId: string
  title: string
  model?: string
  llmConnection?: string
}): EditorSubtask {
  return {
    uid: uid(),
    nodeId: quickAddNodeId(child.sessionId),
    title: child.title,
    prompt: child.title,
    dependsOn: [],
    ...(child.model ? { model: child.model } : {}),
    ...(child.llmConnection ? { llmConnection: child.llmConnection } : {}),
  }
}

export const slugify = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)

/** Permission modes are fixed (safe|ask|allow-all); mirrored here to avoid a shared Node import in the renderer. */
export type TaskPermissionMode = 'safe' | 'ask' | 'allow-all'

export interface EditorSubtask {
  uid: string
  // Original node id from a generated/loaded spec, preserved across the editor round-trip so
  // AI-authored ${nodes.<id>.output} references embedded in sibling prompts keep resolving.
  // Undefined for subtasks added manually in the editor (their id is derived from the title).
  nodeId?: string
  title: string
  prompt: string
  // Explicit authored model. UNDEFINED = inherit the orchestrator default — buildSpec then emits no
  // `model`/`llmConnection` for the node, so a spec that inherited routing round-trips losslessly
  // instead of silently gaining a pinned model + recomputed connection.
  model?: string
  // Explicit connection serving `model`, preserved from the loaded spec. UNDEFINED = derive from an
  // explicit `model` (or inherit). Preserves a node whose authored connection ≠ the model's default.
  llmConnection?: string
  // All dependency edges of this node, as local uids (not node ids). Multi-dependency so a fan-in
  // node (depends_on: [A, B]) keeps every edge visible and editable. uids that no longer resolve to
  // a row (upstream deleted) are dropped by buildSpec, never emitted as a dangling ref.
  dependsOn: string[]
}

export interface SpecForm {
  title: string
  goal: string
  /** Checkable rubric the orchestrator grades the finished run against. Persisted to `acceptance_criteria`. */
  acceptanceCriteria?: string
  /** Max repair attempts on a FAIL verdict. Persisted to the spec's `max_iterations`. */
  maxRepairs?: number
  projectId: string
  orchModel: string
  /** Connection serving the orchestrator model; preserved from the loaded spec's `defaults` unless the
   *  user changes the model. Emitted to `defaults.llmConnection`. */
  orchConnection?: string
  /** Permission mode for the whole task family (orchestrator + children). Emitted to
   *  `defaults.permissionMode` so subtask autonomy is explicit + persisted, never a hidden default. */
  permissionMode?: TaskPermissionMode
  /** The task's existing project binding (edit mode). Used as a floor so leaving the picker on
   *  "No Project" preserves the binding instead of silently dropping `project` from the spec — which
   *  would leave the still-bound orchestrator and its children (who read spec.project) disagreeing. */
  boundProjectId?: string
  subtasks: EditorSubtask[]
  /** Working directory for the orchestrator + children. Persisted to the spec's `cwd`. */
  cwd?: string
  /** Source slugs enabled on the orchestrator + every child session. Persisted to `sources`. */
  sourceSlugs?: string[]
  /** Skill slugs read as context before each child works. Persisted to `skills`. */
  skillSlugs?: string[]
  // Existing task slug to pin as the spec `id` (edit mode). buildSpec derives `id` from the title
  // by default; without this, editing an existing task's title would fork a new slug/folder and
  // orphan the bound orchestrator session. Undefined → create mode (id derived from title).
  fixedId?: string
}

/** A spec node as authored by the generator / loaded from disk (loose, renderer-facing shape). */
export interface SpecNode {
  id: string
  title?: string
  prompt?: string
  model?: string
  /** Connection serving `model`; read back into the row so an explicit connection round-trips. */
  llmConnection?: string
  depends_on?: string[]
}

export function buildSpec(form: SpecForm, modelToConnection: Map<string, string>): Record<string, unknown> {
  // Stable, unique node ids (uid → nodeId) so both depends_on AND free-text
  // ${nodes.<id>.output} references in prompts resolve.
  const used = new Set<string>()
  const nodeIdByUid = new Map<string, string>()
  const claim = (base: string): string => {
    let id = base
    let n = 2
    while (used.has(id)) id = `${base}-${n++}`
    used.add(id)
    return id
  }
  // Phase 1 — subtasks carrying a preserved id (from a generated/loaded spec) keep it, so any
  // ${nodes.<id>.output} reference an AI embedded in a sibling prompt still points at a real node.
  for (const st of form.subtasks) {
    if (st.nodeId) nodeIdByUid.set(st.uid, claim(st.nodeId))
  }
  // Phase 2 — manually added subtasks derive an id from their title.
  form.subtasks.forEach((st, i) => {
    if (nodeIdByUid.has(st.uid)) return
    nodeIdByUid.set(st.uid, claim(slugify(st.title) || `node-${i + 1}`))
  })

  const finalIds = new Set(nodeIdByUid.values())
  const nodes = form.subtasks.map((st) => {
    const selfId = nodeIdByUid.get(st.uid)!
    // Explicit connection (preserved from the loaded spec) wins; else derive from an explicit model;
    // else inherit — emit neither model nor connection so the node follows the orchestrator default.
    const conn = st.llmConnection ?? (st.model ? modelToConnection.get(st.model) : undefined)
    // depends_on = every edge mapped uid → node id, restricted to nodes that still exist and never
    // self-referential. A uid whose row was deleted misses the map and is dropped (not a dangling
    // ref). Dedup keeps the array clean.
    const deps = st.dependsOn.map((u) => nodeIdByUid.get(u)).filter((d): d is string => d != null)
    const depends_on = [...new Set(deps)].filter((d) => d !== selfId && finalIds.has(d))
    return {
      id: selfId,
      ...(st.title.trim() ? { title: st.title.trim() } : {}),
      ...(st.model ? { model: st.model } : {}),
      // Pin the connection that serves the model so non-default (pi/*) models resolve a backend.
      ...(conn ? { llmConnection: conn } : {}),
      ...(depends_on.length ? { depends_on } : {}),
      prompt: st.prompt,
    }
  })

  const orchConn = form.orchConnection ?? (form.orchModel ? modelToConnection.get(form.orchModel) : undefined)
  const cwd = form.cwd?.trim()
  const acceptanceCriteria = form.acceptanceCriteria?.trim()
  // Task-family defaults: orchestrator model/connection + the explicit, persisted permission mode.
  const defaults: Record<string, unknown> = {}
  if (form.orchModel) defaults.model = form.orchModel
  if (orchConn) defaults.llmConnection = orchConn
  if (form.permissionMode) defaults.permissionMode = form.permissionMode
  // Leaving the picker on "No Project" for an already-bound task must NOT drop `project` (children read
  // spec.project) — fall back to the existing binding as a floor. A picked project overrides it.
  const project = form.projectId || form.boundProjectId
  return {
    id: form.fixedId || slugify(form.title) || 'untitled-task',
    title: form.title.trim() || 'Untitled task',
    goal: form.goal.trim() || form.title.trim() || 'Untitled task',
    ...(acceptanceCriteria ? { acceptance_criteria: acceptanceCriteria } : {}),
    // Persist max_iterations only when set to a non-default; omit lets the runner use its default.
    ...(form.maxRepairs !== undefined && Number.isFinite(form.maxRepairs)
      ? { max_iterations: Math.min(MAX_REPAIR_ATTEMPTS_CAP, Math.max(0, Math.floor(form.maxRepairs))) }
      : {}),
    ...(project ? { project } : {}),
    ...(cwd ? { cwd } : {}),
    // Empty selections are omitted (not persisted as []) so sessions keep workspace defaults.
    ...(form.sourceSlugs?.length ? { sources: form.sourceSlugs } : {}),
    ...(form.skillSlugs?.length ? { skills: form.skillSlugs } : {}),
    ...(Object.keys(defaults).length ? { defaults } : {}),
    nodes,
  }
}

/** Map authored TaskSpec nodes → the editor's multi-dependency subtask rows. */
export function specToSubtasks(nodes: SpecNode[], _fallbackModel?: string): EditorSubtask[] {
  const uidByNodeId = new Map<string, string>()
  for (const n of nodes) uidByNodeId.set(n.id, uid())
  return nodes.map((n) => ({
    uid: uidByNodeId.get(n.id)!,
    nodeId: n.id,
    title: n.title || n.id,
    prompt: n.prompt || '',
    // Keep model/connection OPTIONAL: a node that inherited the orchestrator default must round-trip
    // WITHOUT gaining an explicit model (which buildSpec would otherwise pin + re-route). The editor
    // computes an effective display model separately. `_fallbackModel` is kept for call-site compat.
    ...(n.model ? { model: n.model } : {}),
    ...(n.llmConnection ? { llmConnection: n.llmConnection } : {}),
    // Every edge mapped to a local uid. Edges pointing at ids absent from this spec are dangling
    // (the backend would reject them) so they're dropped rather than carried as raw ids.
    dependsOn: (n.depends_on ?? [])
      .map((id) => uidByNodeId.get(id))
      .filter((u): u is string => u != null),
  }))
}

/**
 * Whether `dependentUid` may add a dependency on `candidateUid` without forming a cycle.
 * False for self, and false when the candidate already (transitively) depends on the dependent —
 * adding the edge would close a loop. Row order is irrelevant: reachability is computed over the
 * actual dependsOn edges, so generator-authored forward edges are handled correctly.
 */
export function canDependOn(
  subtasks: EditorSubtask[],
  dependentUid: string,
  candidateUid: string,
): boolean {
  if (candidateUid === dependentUid) return false
  const byUid = new Map(subtasks.map((s) => [s.uid, s]))
  // Walk the candidate's dependency closure; if it reaches the dependent, the edge would cycle.
  const seen = new Set<string>()
  const stack = [candidateUid]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === dependentUid) return false
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const dep of byUid.get(cur)?.dependsOn ?? []) stack.push(dep)
  }
  return true
}
