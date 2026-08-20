import type { MindMapEntityRef, MindMapGraph, MindMapLayout, PinnedMap } from './types.ts';
import { cloneMindMapGraph } from './graph.ts';

function cloneMindMapLayout(layout: MindMapLayout): MindMapLayout {
  const positions: MindMapLayout['positions'] = {};
  for (const [id, position] of Object.entries(layout.positions)) {
    if (position) positions[id] = { ...position };
  }
  return {
    ...layout,
    positions,
    collapsed: [...layout.collapsed],
    ...(layout.viewport ? { viewport: { ...layout.viewport } } : {}),
  };
}

/** Sanitize a path segment: keep alnum, dash, underscore, dot; collapse rest to `_`. */
export function sanitizePinFilenamePart(raw: string): string {
  const cleaned = raw
    .replace(/\.\.+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^\.+|\.+$/g, '');
  return cleaned.slice(0, 120) || 'id';
}

export function entityPinKey(entity: MindMapEntityRef): string {
  if (entity.type === 'session') {
    return `session_${sanitizePinFilenamePart(entity.sessionId)}`;
  }
  if (entity.type === 'note') {
    return `note_${sanitizePinFilenamePart(entity.noteId)}`;
  }
  const ref = entity.ref;
  const kind = sanitizePinFilenamePart(ref.kind);
  const id = sanitizePinFilenamePart(ref.id);
  return `knowledge_${kind}_${id}`;
}

export function pinFilename(entity: MindMapEntityRef): string {
  return `${entityPinKey(entity)}.json`;
}

export function serializePinnedMap(pin: PinnedMap): string {
  return `${JSON.stringify(pin, null, 2)}\n`;
}

export function parsePinnedMap(json: string): PinnedMap {
  const data = JSON.parse(json) as PinnedMap;
  if (!data || typeof data !== 'object') {
    throw new Error('mindmap: invalid pinned map JSON');
  }
  if (!data.entity || !data.graph || !data.layout) {
    throw new Error('mindmap: pinned map missing required fields');
  }
  return data;
}

export function isStale(pin: PinnedMap, currentHash: string): boolean {
  return pin.sourceContentHash !== currentHash;
}

export interface PinReadIO {
  read(path: string): Promise<string | null>;
}

export interface PinWriteIO {
  write(path: string, data: string): Promise<void>;
}

function joinDir(dir: string, file: string): string {
  if (!dir) return file;
  const base = dir.endsWith('/') || dir.endsWith('\\') ? dir.slice(0, -1) : dir;
  return `${base}/${file}`;
}

export async function loadPinnedMap(
  io: PinReadIO,
  dir: string,
  entity: MindMapEntityRef,
): Promise<PinnedMap | null> {
  const path = joinDir(dir, pinFilename(entity));
  const raw = await io.read(path);
  if (raw == null || raw.trim() === '') return null;
  return parsePinnedMap(raw);
}

export async function savePinnedMap(
  io: PinWriteIO,
  dir: string,
  pin: PinnedMap,
): Promise<void> {
  const path = joinDir(dir, pinFilename(pin.entity));
  await io.write(path, serializePinnedMap(pin));
}

/** Convenience factory for a fresh pin from a live graph. */
export function createPinnedMap(
  graph: MindMapGraph,
  layout: MindMapLayout = { positions: {}, collapsed: [] },
  now = Date.now(),
  /** Hash of the live source projection this pin tracks (defaults to graph.contentHash). */
  sourceContentHash?: string,
): PinnedMap {
  const pinnedGraph = cloneMindMapGraph(graph);
  pinnedGraph.derivation = 'pinned';
  return {
    id: `pin_${entityPinKey(graph.entity)}_${now}`,
    entity: pinnedGraph.entity,
    graph: pinnedGraph,
    layout: cloneMindMapLayout(layout),
    sourceContentHash: sourceContentHash ?? graph.contentHash,
    createdAt: now,
    updatedAt: now,
  };
}
