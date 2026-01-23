/**
 * Labels Atoms
 *
 * Jotai atoms for workspace-scoped session labels.
 */

import { atom } from 'jotai';
import type { Label } from '@craft-agent/shared/labels';

/**
 * All labels in the current workspace
 */
export const labelsAtom = atom<Label[]>([]);

/**
 * Map of label ID to label (for O(1) lookup)
 */
export const labelsMapAtom = atom((get) => {
  const labels = get(labelsAtom);
  return new Map(labels.map(l => [l.id, l]));
});

/**
 * Active label filter (label IDs to show)
 * Empty array means no filter (show all sessions)
 */
export const activeLabelFilterAtom = atom<string[]>([]);

/**
 * Initialize labels from IPC
 */
export const initializeLabelsAtom = atom(
  null,
  async (get, set, workspaceId: string) => {
    try {
      const labels = await window.electronAPI.listLabels(workspaceId);
      set(labelsAtom, labels);
    } catch (error) {
      console.error('[initializeLabelsAtom] Failed to load labels:', error);
      set(labelsAtom, []);
    }
  }
);

/**
 * Create a new label
 */
export const createLabelAtom = atom(
  null,
  async (get, set, params: { workspaceId: string; name: string; color: string }) => {
    const label = await window.electronAPI.createLabel(params.workspaceId, params.name, params.color);
    // Optimistically add to local state
    const labels = get(labelsAtom);
    set(labelsAtom, [...labels, label]);
    return label;
  }
);

/**
 * Update an existing label
 */
export const updateLabelAtom = atom(
  null,
  async (get, set, params: { workspaceId: string; labelId: string; updates: { name?: string; color?: string } }) => {
    const label = await window.electronAPI.updateLabel(params.workspaceId, params.labelId, params.updates);
    // Optimistically update local state
    const labels = get(labelsAtom);
    set(labelsAtom, labels.map(l => l.id === params.labelId ? label : l));
    return label;
  }
);

/**
 * Delete a label
 */
export const deleteLabelAtom = atom(
  null,
  async (get, set, params: { workspaceId: string; labelId: string }) => {
    await window.electronAPI.deleteLabel(params.workspaceId, params.labelId);
    // Optimistically remove from local state
    const labels = get(labelsAtom);
    set(labelsAtom, labels.filter(l => l.id !== params.labelId));
    // Also remove from active filter if present
    const filter = get(activeLabelFilterAtom);
    if (filter.includes(params.labelId)) {
      set(activeLabelFilterAtom, filter.filter(id => id !== params.labelId));
    }
  }
);

/**
 * Toggle a label in the active filter
 */
export const toggleLabelFilterAtom = atom(
  null,
  (get, set, labelId: string) => {
    const filter = get(activeLabelFilterAtom);
    if (filter.includes(labelId)) {
      set(activeLabelFilterAtom, filter.filter(id => id !== labelId));
    } else {
      set(activeLabelFilterAtom, [...filter, labelId]);
    }
  }
);

/**
 * Clear all label filters
 */
export const clearLabelFilterAtom = atom(
  null,
  (_get, set) => {
    set(activeLabelFilterAtom, []);
  }
);
