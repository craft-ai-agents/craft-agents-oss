/**
 * Merge a spec-backed task's DAG nodes with its live child sessions into the tile's
 * subtask rows.
 *
 * The tile and the editor historically showed disjoint data: the tile only child
 * SESSIONS (so authored-but-never-run nodes were invisible), the editor only spec
 * NODES (so quick-add children were invisible). This merge makes the tile show the
 * union — one row per DAG node, resolved as:
 *
 *   latest run child (`taskNodeId` match; newest `createdAt` wins across re-runs)
 *   → else the adopted quick-add session (node id `qa-<sessionId>`)
 *   → else a synthetic pending row (authored, not yet run — no session to open).
 *
 * Children that don't represent a spec node (unadopted quick-adds, children of
 * since-removed nodes) append after the node rows in creation order. Earlier-run
 * children of a merged node are superseded — collapsed into the node row instead of
 * duplicating it. Without a spec the rows are simply the children (legacy tiles).
 */
import type { KanbanSubtask, SubtaskRunState } from './types'
import { quickAddSessionId } from './task-spec-form'

/** A spec node reduced to what a tile row needs (model pre-defaulted from the spec). */
export interface SpecNodeSummary {
  id: string
  title: string
  model?: string
}

/** A child session reduced to what the merge needs (run state pre-derived by the caller). */
export interface SubtaskChildRow {
  id: string
  title: string
  runState: SubtaskRunState
  model: string
  taskNodeId?: string
  createdAt?: number
}

const toRow = (child: SubtaskChildRow): KanbanSubtask => ({
  id: child.id,
  sessionId: child.id,
  title: child.title,
  runState: child.runState,
  model: child.model,
})

export function mergeSubtaskRows(
  specNodes: readonly SpecNodeSummary[] | undefined,
  children: readonly SubtaskChildRow[],
  fallbackModel: string
): KanbanSubtask[] {
  const ordered = [...children].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  if (!specNodes?.length) return ordered.map(toRow)

  // Ascending order → the last write per node is the newest child (re-runs supersede).
  const latestByNode = new Map<string, SubtaskChildRow>()
  for (const child of ordered) {
    if (child.taskNodeId) latestByNode.set(child.taskNodeId, child)
  }
  const childById = new Map(ordered.map(c => [c.id, c]))
  const nodeIds = new Set(specNodes.map(n => n.id))

  const consumed = new Set<string>()
  const rows: KanbanSubtask[] = []
  for (const node of specNodes) {
    const adoptedId = quickAddSessionId(node.id)
    const adopted = adoptedId ? childById.get(adoptedId) : undefined
    // The adopted quick-add session is this node's pre-run execution: once a Conductor
    // run child exists it is superseded exactly like an earlier run attempt.
    if (adopted) consumed.add(adopted.id)
    const child = latestByNode.get(node.id) ?? adopted
    if (child) {
      consumed.add(child.id)
      rows.push(toRow(child))
    } else {
      rows.push({ id: `node:${node.id}`, title: node.title, runState: 'pending', model: node.model ?? fallbackModel })
    }
  }
  for (const child of ordered) {
    if (consumed.has(child.id)) continue
    // A run child of a merged node that lost latest-wins: superseded, not a separate row.
    if (child.taskNodeId && nodeIds.has(child.taskNodeId)) continue
    rows.push(toRow(child))
  }
  return rows
}
