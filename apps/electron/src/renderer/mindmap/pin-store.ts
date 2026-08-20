/**
 * Mind map pin persistence:
 * 1) workspace FS via mindmap:pin* RPC when workspaceId is available
 * 2) localStorage cache / offline fallback
 */
import {
  entityPinKey,
  parsePinnedMap,
  serializePinnedMap,
  type MindMapEntityRef,
  type PinnedMap,
} from '@craft-agent/core/mindmap'

export function pinStorageKey(entity: MindMapEntityRef): string {
  return `craft-mindmap-pin:${entityPinKey(entity)}`
}

export function loadPinLocal(entity: MindMapEntityRef): PinnedMap | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(pinStorageKey(entity))
    if (raw == null || raw.trim() === '') return null
    return parsePinnedMap(raw)
  } catch {
    return null
  }
}

export function savePinLocal(pin: PinnedMap): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(pinStorageKey(pin.entity), serializePinnedMap(pin))
  } catch {
    /* quota */
  }
}

export function clearPinLocal(entity: MindMapEntityRef): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(pinStorageKey(entity))
  } catch {
    /* ignore */
  }
}

export function loadPin(entity: MindMapEntityRef): PinnedMap | null {
  return loadPinLocal(entity)
}

export function savePin(pin: PinnedMap): void {
  savePinLocal(pin)
}

export function clearPin(entity: MindMapEntityRef): void {
  clearPinLocal(entity)
}

export async function loadPinAsync(
  entity: MindMapEntityRef,
  workspaceId?: string | null,
): Promise<PinnedMap | null> {
  if (workspaceId) {
    try {
      const api = window.electronAPI?.mindmapPinLoad
      if (typeof api === 'function') {
        const remote = await api({ workspaceId, entity })
        if (remote) {
          savePinLocal(remote)
          return remote
        }
      }
    } catch {
      /* local fallback */
    }
  }
  return loadPinLocal(entity)
}

export async function savePinAsync(
  pin: PinnedMap,
  workspaceId?: string | null,
): Promise<void> {
  savePinLocal(pin)
  if (!workspaceId) return
  try {
    const api = window.electronAPI?.mindmapPinSave
    if (typeof api === 'function') await api({ workspaceId, pin })
  } catch {
    /* local already written */
  }
}

export async function clearPinAsync(
  entity: MindMapEntityRef,
  workspaceId?: string | null,
): Promise<void> {
  clearPinLocal(entity)
  if (!workspaceId) return
  try {
    const api = window.electronAPI?.mindmapPinClear
    if (typeof api === 'function') await api({ workspaceId, entity })
  } catch {
    /* ignore */
  }
}
