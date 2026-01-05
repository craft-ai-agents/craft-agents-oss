import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { mainLog } from './logger'
import { join } from 'path'
import { homedir } from 'os'

interface WindowState {
  openWorkspaceIds: string[]
  lastFocusedWorkspaceId?: string
}

const CONFIG_DIR = join(homedir(), '.craft-agent')
const WINDOW_STATE_FILE = join(CONFIG_DIR, 'window-state.json')

/**
 * Save the current window state (which workspaces have open windows)
 */
export function saveWindowState(state: WindowState): void {
  try {
    // Ensure config directory exists
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }

    writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
    mainLog.info('[WindowState] Saved window state:', state.openWorkspaceIds.length, 'workspaces')
  } catch (error) {
    mainLog.error('[WindowState] Failed to save window state:', error)
  }
}

/**
 * Load the saved window state
 */
export function loadWindowState(): WindowState | null {
  try {
    if (!existsSync(WINDOW_STATE_FILE)) {
      return null
    }

    const content = readFileSync(WINDOW_STATE_FILE, 'utf-8')
    const state = JSON.parse(content) as WindowState

    // Validate structure
    if (!Array.isArray(state.openWorkspaceIds)) {
      mainLog.warn('[WindowState] Invalid window state file, ignoring')
      return null
    }

    mainLog.info('[WindowState] Loaded window state:', state.openWorkspaceIds.length, 'workspaces')
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
      writeFileSync(WINDOW_STATE_FILE, JSON.stringify({ openWorkspaceIds: [] }, null, 2), 'utf-8')
      mainLog.info('[WindowState] Cleared window state')
    }
  } catch (error) {
    mainLog.error('[WindowState] Failed to clear window state:', error)
  }
}
