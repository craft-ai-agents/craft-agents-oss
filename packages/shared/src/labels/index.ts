/**
 * Labels Module
 *
 * Simple labeling system for sessions.
 * Labels are stored at {workspaceRootPath}/labels.json
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { listSessions, updateSessionMetadata } from '../sessions/storage.ts';

// ============================================================
// Types
// ============================================================

/**
 * Label definition
 */
export interface Label {
  /** Unique ID (UUID) */
  id: string;
  /** Display name (1-50 chars) */
  name: string;
  /** Hex color from preset palette */
  color: string;
}

/**
 * Label configuration for a workspace
 */
export interface WorkspaceLabelConfig {
  /** Schema version for migrations */
  version: number;
  /** Array of label definitions */
  labels: Label[];
}

// ============================================================
// Preset Colors
// ============================================================

/**
 * Preset color palette (8 accessible colors)
 * No custom hex input in MVP - users pick from these
 */
export const LABEL_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
] as const;

export type LabelColorValue = (typeof LABEL_COLORS)[number]['value'];

/** Set of valid color values for fast validation */
const VALID_COLORS = new Set(LABEL_COLORS.map(c => c.value));

/**
 * Validate that a color is from the preset palette
 */
export function isValidLabelColor(color: string): color is LabelColorValue {
  return VALID_COLORS.has(color as LabelColorValue);
}

// ============================================================
// Storage
// ============================================================

const LABELS_FILE = 'labels.json';

/** Simple in-memory cache to avoid repeated file reads */
const labelsCache = new Map<string, { labels: Label[]; mtime: number }>();

/**
 * Clear the labels cache for a workspace (call after mutations)
 */
export function clearLabelsCache(workspaceRootPath: string): void {
  labelsCache.delete(workspaceRootPath);
}

/**
 * Get path to labels.json for a workspace
 */
export function getLabelsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, LABELS_FILE);
}

/**
 * Get default (empty) label configuration
 */
export function getDefaultLabelConfig(): WorkspaceLabelConfig {
  return {
    version: 1,
    labels: [],
  };
}

/**
 * Load labels for a workspace
 * Returns empty array if no config exists
 * Uses in-memory cache to avoid repeated file reads
 */
export function loadLabels(workspaceRootPath: string): Label[] {
  const configPath = getLabelsPath(workspaceRootPath);

  if (!existsSync(configPath)) {
    return [];
  }

  try {
    const stat = require('fs').statSync(configPath);
    const mtime = stat.mtimeMs;

    // Check cache
    const cached = labelsCache.get(workspaceRootPath);
    if (cached && cached.mtime === mtime) {
      return cached.labels;
    }

    // Read and parse
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as WorkspaceLabelConfig;
    const labels = config.labels || [];

    // Update cache
    labelsCache.set(workspaceRootPath, { labels, mtime });

    return labels;
  } catch (error) {
    console.error('[loadLabels] Failed to parse labels config:', error);
    return [];
  }
}

/**
 * Save labels to workspace
 * Clears cache after write
 */
export function saveLabels(workspaceRootPath: string, labels: Label[]): void {
  const configPath = getLabelsPath(workspaceRootPath);

  const config: WorkspaceLabelConfig = {
    version: 1,
    labels,
  };

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    // Clear cache so next read gets fresh data
    clearLabelsCache(workspaceRootPath);
  } catch (error) {
    console.error('[saveLabels] Failed to save labels:', error);
    throw error;
  }
}

/**
 * Create a new label
 * Returns the created label
 * Validates color is from preset palette
 */
export function createLabel(
  workspaceRootPath: string,
  name: string,
  color: string
): Label {
  const labels = loadLabels(workspaceRootPath);

  // Validate name
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 50) {
    throw new Error('Label name must be 1-50 characters');
  }

  // Validate color is from preset palette (P1-Security fix)
  if (!isValidLabelColor(color)) {
    throw new Error('Invalid label color. Must be from preset palette.');
  }

  // Check for duplicate names (case-insensitive)
  if (labels.some(l => l.name.toLowerCase() === trimmedName.toLowerCase())) {
    throw new Error('A label with this name already exists');
  }

  const newLabel: Label = {
    id: randomUUID(),
    name: trimmedName,
    color,
  };

  labels.push(newLabel);
  saveLabels(workspaceRootPath, labels);

  return newLabel;
}

/**
 * Update an existing label
 * Returns the updated label
 */
export function updateLabel(
  workspaceRootPath: string,
  labelId: string,
  updates: { name?: string; color?: string }
): Label {
  const labels = loadLabels(workspaceRootPath);

  const labelIndex = labels.findIndex(l => l.id === labelId);
  if (labelIndex === -1) {
    throw new Error('Label not found');
  }

  const existingLabel = labels[labelIndex];
  if (!existingLabel) {
    throw new Error('Label not found');
  }

  // Create updated label (copy to avoid mutation issues)
  const updatedLabel: Label = { ...existingLabel };

  // Validate name if provided
  if (updates.name !== undefined) {
    const trimmedName = updates.name.trim();
    if (!trimmedName || trimmedName.length > 50) {
      throw new Error('Label name must be 1-50 characters');
    }
    // Check for duplicate names (case-insensitive), excluding current label
    if (labels.some(l => l.id !== labelId && l.name.toLowerCase() === trimmedName.toLowerCase())) {
      throw new Error('A label with this name already exists');
    }
    updatedLabel.name = trimmedName;
  }

  // Validate color if provided
  if (updates.color !== undefined) {
    if (!isValidLabelColor(updates.color)) {
      throw new Error('Invalid label color. Must be from preset palette.');
    }
    updatedLabel.color = updates.color;
  }

  labels[labelIndex] = updatedLabel;
  saveLabels(workspaceRootPath, labels);

  return updatedLabel;
}

/**
 * Delete a label and remove it from all sessions
 */
export function deleteLabel(workspaceRootPath: string, labelId: string): void {
  const labels = loadLabels(workspaceRootPath);

  // Remove from labels list
  const filteredLabels = labels.filter(l => l.id !== labelId);

  if (filteredLabels.length === labels.length) {
    // Label not found, nothing to do
    return;
  }

  // Save updated labels
  saveLabels(workspaceRootPath, filteredLabels);

  // Remove from all sessions that have this label
  try {
    const sessions = listSessions(workspaceRootPath);
    for (const session of sessions) {
      if (session.labelIds?.includes(labelId)) {
        const newLabelIds = session.labelIds.filter(id => id !== labelId);
        updateSessionMetadata(workspaceRootPath, session.id, { labelIds: newLabelIds });
      }
    }
  } catch (error) {
    console.error('[deleteLabel] Failed to remove label from sessions:', error);
    // Don't throw - label is already deleted from config
  }
}

/**
 * Get a label by ID
 * Returns null if not found
 */
export function getLabel(workspaceRootPath: string, labelId: string): Label | null {
  const labels = loadLabels(workspaceRootPath);
  return labels.find(l => l.id === labelId) || null;
}

/**
 * Check if a label ID exists in this workspace
 */
export function isValidLabelId(workspaceRootPath: string, labelId: string): boolean {
  const labels = loadLabels(workspaceRootPath);
  return labels.some(l => l.id === labelId);
}

// ============================================================
// Session Label Operations
// ============================================================

/**
 * Set labels for a session
 * Validates that all label IDs exist
 */
export function setSessionLabels(
  workspaceRootPath: string,
  sessionId: string,
  labelIds: string[]
): void {
  // Validate all label IDs exist
  const validLabels = loadLabels(workspaceRootPath);
  const validIds = new Set(validLabels.map(l => l.id));

  const filteredIds = labelIds.filter(id => validIds.has(id));

  // Update session metadata
  updateSessionMetadata(workspaceRootPath, sessionId, { labelIds: filteredIds });
}

/**
 * Filter session label IDs to only include valid labels
 * Use this when loading session data to clean up stale references
 */
export function filterValidLabelIds(
  workspaceRootPath: string,
  labelIds: string[] | undefined
): string[] {
  if (!labelIds || labelIds.length === 0) {
    return [];
  }

  const validLabels = loadLabels(workspaceRootPath);
  const validIds = new Set(validLabels.map(l => l.id));

  return labelIds.filter(id => validIds.has(id));
}
