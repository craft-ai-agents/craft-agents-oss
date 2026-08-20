/**
 * Kanban board config storage.
 *
 * File: `{workspaceRoot}/kanban/config.json`
 * Absence → built-in defaults (5 columns, groupBy project).
 */

import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import type { KanbanBoardConfig } from './types.ts'
import { getDefaultKanbanBoardConfig, normalizeKanbanBoardConfig } from './config.ts'

export const KANBAN_CONFIG_RELATIVE_PATH = 'kanban/config.json'

export function getKanbanConfigPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, KANBAN_CONFIG_RELATIVE_PATH)
}

/**
 * Load board config from disk. Missing/corrupt file → defaults (not written).
 */
export function loadKanbanBoardConfig(workspaceRootPath: string): KanbanBoardConfig {
  const path = getKanbanConfigPath(workspaceRootPath)
  if (!existsSync(path)) return getDefaultKanbanBoardConfig()
  try {
    const raw = readJsonFileSync<unknown>(path)
    return normalizeKanbanBoardConfig(raw)
  } catch {
    return getDefaultKanbanBoardConfig()
  }
}

/**
 * Persist board config. Creates `kanban/` directory as needed.
 * Returns the normalized config that was written.
 */
export function saveKanbanBoardConfig(
  workspaceRootPath: string,
  config: KanbanBoardConfig,
): KanbanBoardConfig {
  const normalized = normalizeKanbanBoardConfig(config)
  const path = getKanbanConfigPath(workspaceRootPath)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  atomicWriteFileSync(path, JSON.stringify(normalized, null, 2) + '\n')
  return normalized
}

