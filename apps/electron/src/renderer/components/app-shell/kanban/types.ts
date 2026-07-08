/**
 * View-models for the Kanban board.
 *
 * `column` (where a tile physically sits) is intentionally separate from
 * `statusId` (what the badge shows). The board has 3 columns but a workspace
 * can have more statuses, so a tile may sit in "In Progress" while showing a
 * "Needs Review" badge. `statusToColumn` (see ./status-column) provides only the
 * default placement; tiles may override it.
 *
 * These are presentational view-models. The wiring phase maps real
 * `SessionConfig` / `ProjectConfig` / status data onto these shapes.
 */

/**
 * Board column id. Widened from the original 3-literal union to `string` so a
 * project can define its own columns (see `KanbanColumnDef` in shared). The
 * built-in set still uses these three ids; `BuiltInKanbanColumnId` names them
 * where the default placement / color maps need exhaustiveness.
 */
export type KanbanColumnId = string

export type BuiltInKanbanColumnId = 'todo' | 'in-progress' | 'done'

export type SubtaskRunState = 'done' | 'running' | 'pending' | 'failed'

/**
 * What the Task editor points at. `create` authors a brand-new task; `edit` opens an
 * existing tile — either spec-backed (`taskSlug` present → prefill from its task.yaml)
 * or a plain quick-add tile (`taskSlug` absent → start from the title, bind the spec
 * on save). Lives here (not in TaskEditor) so the editor-target atom can reference it
 * without importing a component module.
 */
export type TaskEditorTarget =
  | { mode: 'create'; initialProjectId?: string }
  | { mode: 'edit'; sessionId: string; taskSlug?: string; initialTitle?: string }

export interface KanbanSubtask {
  /** Row key. A child session id, or `node:<nodeId>` for an authored-but-never-run spec node. */
  id: string
  /**
   * Backing child session, when one exists. Synthetic rows (spec nodes with no run yet)
   * have none — they are not clickable and don't count toward the Play button's pending set.
   */
  sessionId?: string
  title: string
  runState: SubtaskRunState
  /** Model id the orchestrator routed this subtask to (e.g. 'claude-haiku-4-5-20251001'). */
  model: string
}

export interface KanbanTask {
  id: string
  title: string
  /** Physical board column. Independent from `statusId`. */
  column: KanbanColumnId
  /** Workspace status id shown on the badge. Independent from `column`. */
  statusId: string
  /** Orchestrator model id for the parent task. */
  model: string
  /** Optional project binding; colors the tile. */
  projectId?: string
  /**
   * Slug of the backing task.yaml when this tile is a spec-authored Conductor task. Absent for
   * plain quick-add tiles. Drives edit-mode prefill (spec → editor) vs. start-empty in TaskEditor.
   */
  taskSlug?: string
  subtasks: KanbanSubtask[]
  /**
   * Total subtasks the Conductor run will produce (from the orchestrator's node count). Used as the
   * progress denominator so it stays stable while `subtasks` fills in as children spawn lazily.
   * Undefined for non-Conductor tasks (fall back to `subtasks.length`).
   */
  subtaskTotal?: number
  /** Flagged for attention (drives the flag star). */
  isFlagged?: boolean
  /** A turn is in flight — drives the live-pulse treatment when enabled. */
  isProcessing?: boolean
  /** Creation time (ms timestamp); newest tiles sort to the top of their column. */
  createdAt?: number
  /** Last activity (ms timestamp) for the relative-time footer. */
  lastMessageAt?: number
  /** Total messages exchanged, shown in the footer when > 0. */
  messageCount?: number
  /** Accrued cost in USD, shown in the footer when available. */
  costUsd?: number
}

export interface KanbanProject {
  id: string
  name: string
  /** Hex accent color (e.g. "#6366f1"). */
  color: string
}

export interface KanbanColumnMeta {
  id: KanbanColumnId
  /**
   * i18n key for a built-in column header (resolved with `t()` at render).
   * Mutually exclusive with `name`: built-ins carry `labelKey`, user-authored
   * project columns carry a verbatim `name`.
   */
  labelKey?: string
  /** Verbatim header label for a custom (per-project) column — never translated. */
  name?: string
  /** Optional header accent (hex). Built-ins resolve color from the global atom instead. */
  color?: string
  /** Status auto-applied when a card is dropped here (per-project columns). */
  dropStatusId?: string
}

/** One selectable model in the subtask composer's provider→model picker. */
export interface KanbanModelOption {
  id: string
  /** Display name shown in the picker (e.g. "Sonnet 4.6", "GPT-5"). */
  name: string
}

/**
 * A provider's group of selectable models, used by the "Add subtask" composer
 * to let the user route a spawned subtask to any provider's model. The wiring
 * phase builds these from the workspace's LLM connections; the playground feeds
 * a static catalog.
 */
export interface KanbanModelProviderGroup {
  /** Provider key for the brand icon (e.g. 'anthropic', 'openai', 'xai'). */
  provider: string
  /** Section-header label (e.g. "Anthropic", "OpenAI"). */
  label: string
  models: KanbanModelOption[]
}
