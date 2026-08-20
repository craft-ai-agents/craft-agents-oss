/**
 * Sessions collection display preferences.
 *
 * File: `{workspaceRoot}/collection/display.json`
 * Absence / corrupt → defaults (not written until save).
 */

import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import {
  COLLECTION_GROUP_BY_VALUES,
  COLLECTION_ORDER_BY_VALUES,
  COLLECTION_PROPERTY_VALUES,
  DEFAULT_COLLECTION_DISPLAY,
  type CollectionDisplay,
  type CollectionGroupBy,
  type CollectionOrderBy,
  type CollectionOrderDir,
  type CollectionProperty,
} from './collection-types.ts'

export type {
  CollectionDisplay,
  CollectionGroupBy,
  CollectionOrderBy,
  CollectionOrderDir,
  CollectionProperty,
} from './collection-types.ts'

export const COLLECTION_DISPLAY_RELATIVE_PATH = 'collection/display.json'

function isGroupBy(value: unknown): value is CollectionGroupBy {
  return typeof value === 'string' && (COLLECTION_GROUP_BY_VALUES as readonly string[]).includes(value)
}

function isOrderBy(value: unknown): value is CollectionOrderBy {
  return typeof value === 'string' && (COLLECTION_ORDER_BY_VALUES as readonly string[]).includes(value)
}

function isOrderDir(value: unknown): value is CollectionOrderDir {
  return value === 'asc' || value === 'desc'
}

function isProperty(value: unknown): value is CollectionProperty {
  return typeof value === 'string' && (COLLECTION_PROPERTY_VALUES as readonly string[]).includes(value)
}

export function getDefaultCollectionDisplay(): CollectionDisplay {
  return {
    ...DEFAULT_COLLECTION_DISPLAY,
    visibleProperties: [...DEFAULT_COLLECTION_DISPLAY.visibleProperties],
  }
}

/**
 * Normalize a raw JSON object into a valid CollectionDisplay.
 * Unknown fields are dropped; invalid enums fall back to defaults.
 * `visibleProperties` is de-duplicated while preserving first-seen order.
 */
export function normalizeCollectionDisplay(raw: unknown): CollectionDisplay {
  const defaults = getDefaultCollectionDisplay()
  if (!raw || typeof raw !== 'object') return defaults

  const obj = raw as Record<string, unknown>

  let visibleProperties = defaults.visibleProperties
  if (Array.isArray(obj.visibleProperties)) {
    const seen = new Set<CollectionProperty>()
    const next: CollectionProperty[] = []
    for (const item of obj.visibleProperties) {
      if (!isProperty(item) || seen.has(item)) continue
      seen.add(item)
      next.push(item)
    }
    // Empty list is allowed (title-only table); keep as empty when author cleared all.
    // If the field was present but entirely invalid, fall back to defaults.
    if (next.length > 0 || obj.visibleProperties.length === 0) {
      visibleProperties = next
    }
  }

  return {
    version: 1,
    groupBy: isGroupBy(obj.groupBy) ? obj.groupBy : defaults.groupBy,
    orderBy: isOrderBy(obj.orderBy) ? obj.orderBy : defaults.orderBy,
    orderDir: isOrderDir(obj.orderDir) ? obj.orderDir : defaults.orderDir,
    visibleProperties,
    showEmptyGroups:
      typeof obj.showEmptyGroups === 'boolean' ? obj.showEmptyGroups : defaults.showEmptyGroups,
    showCompleted:
      typeof obj.showCompleted === 'boolean' ? obj.showCompleted : defaults.showCompleted,
  }
}

export function getCollectionDisplayPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, COLLECTION_DISPLAY_RELATIVE_PATH)
}

/**
 * Load display preferences from disk. Missing/corrupt file → defaults (not written).
 */
export function loadCollectionDisplay(workspaceRootPath: string): CollectionDisplay {
  const path = getCollectionDisplayPath(workspaceRootPath)
  if (!existsSync(path)) return getDefaultCollectionDisplay()
  try {
    const raw = readJsonFileSync<unknown>(path)
    return normalizeCollectionDisplay(raw)
  } catch {
    return getDefaultCollectionDisplay()
  }
}

/**
 * Persist display preferences. Creates `collection/` directory as needed.
 * Returns the normalized config that was written.
 */
export function saveCollectionDisplay(
  workspaceRootPath: string,
  display: CollectionDisplay,
): CollectionDisplay {
  const normalized = normalizeCollectionDisplay(display)
  const path = getCollectionDisplayPath(workspaceRootPath)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  atomicWriteFileSync(path, JSON.stringify(normalized, null, 2) + '\n')
  return normalized
}
