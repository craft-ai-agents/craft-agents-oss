/**
 * Pluggable mind-map engine contract (SVG v1).
 * Spec: docs/superpowers/specs/2026-08-08-entity-mindmap-views-design.md
 */

import type {
  MindMapGraph,
  MindMapLayout,
  MindMapNodeId,
  MindMapNodeSource,
} from '@craft-agent/core/mindmap'

export type MindMapEngineMode = 'map' | 'outline' | 'split'

export interface MindMapEngineProps {
  graph: MindMapGraph
  layout: MindMapLayout | 'auto'
  mode?: MindMapEngineMode
  zen?: boolean
  /** true for live graphs — no structural edits / reparent */
  readOnlyStructure?: boolean
  selectedId?: MindMapNodeId | null
  /** Label search — non-matches are dimmed, not removed */
  searchQuery?: string
  /** Host-owned collapse set (merged into autoLayout) */
  collapsed?: ReadonlySet<MindMapNodeId> | readonly MindMapNodeId[]
  className?: string
  onLayoutChange?: (layout: MindMapLayout) => void
  onGraphChange?: (graph: MindMapGraph) => void
  onNavigate?: (source: MindMapNodeSource) => void
  onSelect?: (nodeId: MindMapNodeId | null) => void
  onToggleCollapse?: (nodeId: MindMapNodeId) => void
}

export interface MindMapEngineHandle {
  update(props: Partial<MindMapEngineProps>): void
  destroy(): void
  fitView(): void
  getViewport?(): { x: number; y: number; zoom: number }
}

/**
 * Factory-style engine port. SVG v1 is a React view; future adapters may
 * mount imperatively and return a handle.
 */
export interface MindMapEngine {
  mount(el: HTMLElement, props: MindMapEngineProps): MindMapEngineHandle
}

/** Chip size used for edge anchors / fit padding. */
export const MIND_MAP_NODE_WIDTH = 172
export const MIND_MAP_NODE_HEIGHT = 36
export const MIND_MAP_MINIMAP_THRESHOLD = 12
