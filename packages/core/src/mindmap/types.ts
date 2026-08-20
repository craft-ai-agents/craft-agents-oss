/**
 * Craft mind-map projection types (entity → MindMapGraph).
 * Spec: docs/superpowers/specs/2026-08-08-entity-mindmap-views-design.md
 */

import type { KnowledgeRef } from '../knowledge/refs.ts';

export type MindMapEntityRef =
  | { type: 'session'; sessionId: string }
  | { type: 'note'; noteId: string }
  | { type: 'knowledge'; ref: KnowledgeRef };

/** Stable id within one projection; source-addressable for click-through. */
export type MindMapNodeId = string;

export type MindMapNodeKind =
  | 'root'
  | 'turn'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'heading'
  | 'section'
  | 'backlink'
  | 'block'
  /** User-created node that exists only in a pinned map snapshot. */
  | 'custom';
export type MindMapEdgeKind = 'parent' | 'backlink' | 'ref';

export type MindMapDerivation =
  | 'session'
  | 'note'
  | 'knowledge'
  | 'pinned'
  | 'enriched';

export interface MindMapNodeSource {
  kind: string;
  id: string;
}

export interface MindMapNode {
  id: MindMapNodeId;
  label: string;
  kind: MindMapNodeKind;
  parentId?: MindMapNodeId;
  children: MindMapNodeId[];
  meta?: Record<string, string | number | boolean>;
  source?: MindMapNodeSource;
  collapsed?: boolean;
  /** Outline depth (0 = root); optional for non-heading trees. */
  level?: number;
}

export interface MindMapEdge {
  id: string;
  from: MindMapNodeId;
  to: MindMapNodeId;
  kind: MindMapEdgeKind;
}

export interface MindMapGraph {
  entity: MindMapEntityRef;
  rootId: MindMapNodeId;
  nodes: Record<MindMapNodeId, MindMapNode>;
  edges: MindMapEdge[];
  contentHash: string;
  derivedAt: number;
  derivation: MindMapDerivation;
}

export interface MindMapLayout {
  positions: Record<MindMapNodeId, { x: number; y: number }>;
  collapsed: MindMapNodeId[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface PinnedMap {
  id: string;
  entity: MindMapEntityRef;
  graph: MindMapGraph;
  layout: MindMapLayout;
  sourceContentHash: string;
  createdAt: number;
  updatedAt: number;
}

export const MIND_MAP_ROOT_ID: MindMapNodeId = 'root';
