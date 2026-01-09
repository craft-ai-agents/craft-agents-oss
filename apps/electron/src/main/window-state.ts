import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { mainLog } from './logger'
import { join } from 'path'
import { homedir } from 'os'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface SavedWindow {
  type: 'main' | 'tab-content'
  workspaceId: string
  bounds: WindowBounds
  query?: string  // For tab-content: the URL query string (e.g., "tabType=chat&sessionId=xxx")
}

export interface WindowState {
  windows: SavedWindow[]
  lastFocusedWorkspaceId?: string
}

// Old format for migration
interface LegacyWindowState {
  openWorkspaceIds: string[]
  lastFocusedWorkspaceId?: string
}

const CONFIG_DIR = join(homedir(), '.craft-agent')
const WINDOW_STATE_FILE = join(CONFIG_DIR, 'window-state.json')

/**
 * Save the current window state (windows with bounds and type)
 */
export function saveWindowState(state: WindowState): void {
  try {
    // Ensure config directory exists
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }

    writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
    mainLog.info('[WindowState] Saved window state:', state.windows.length, 'windows')
  } catch (error) {
    mainLog.error('[WindowState] Failed to save window state:', error)
  }
}

/**
 * Load the saved window state
 * Handles migration from old format (openWorkspaceIds array)
 */
export function loadWindowState(): WindowState | null {
  try {
    if (!existsSync(WINDOW_STATE_FILE)) {
      return null
    }

    const content = readFileSync(WINDOW_STATE_FILE, 'utf-8')
    const raw = JSON.parse(content)

    // Migrate old format (openWorkspaceIds array)
    if (Array.isArray(raw.openWorkspaceIds)) {
      const legacy = raw as LegacyWindowState
      mainLog.info('[WindowState] Migrating from legacy format')
      return {
        windows: legacy.openWorkspaceIds.map(id => ({
          type: 'main' as const,
          workspaceId: id,
          bounds: { x: 100, y: 100, width: 1400, height: 900 }
        })),
        lastFocusedWorkspaceId: legacy.lastFocusedWorkspaceId
      }
    }

    // New format validation
    const state = raw as WindowState
    if (!Array.isArray(state.windows)) {
      mainLog.warn('[WindowState] Invalid window state file, ignoring')
      return null
    }

    mainLog.info('[WindowState] Loaded window state:', state.windows.length, 'windows')
    return state
  } catch (error) {
    mainLog.error('[WindowState] Failed to load window state:', error)
    return null
  }
}

/**
 * Clear the saved window state
 */
export function clearWindowState(): void {
  try {
    if (existsSync(WINDOW_STATE_FILE)) {
      writeFileSync(WINDOW_STATE_FILE, JSON.stringify({ windows: [] }, null, 2), 'utf-8')
      mainLog.info('[WindowState] Cleared window state')
    }
  } catch (error) {
    mainLog.error('[WindowState] Failed to clear window state:', error)
  }
}
