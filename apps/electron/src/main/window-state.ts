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
  type: 'main'
  workspaceId: string
  bounds: WindowBounds
  focused?: boolean
  url?: string  // Full URL to restore (preserves route/query params)
}

export interface WindowState {
  windows: SavedWindow[]
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
 * Sanitize a saved URL to remove dev-mode localhost URLs
 * Returns undefined if the URL should not be restored
 */
function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined

  // Remove localhost URLs (from dev mode) - they won't work in production
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    return undefined
  }

  return url
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
    const raw = JSON.parse(content)

    // Validate format
    const state = raw as WindowState
    if (!Array.isArray(state.windows)) {
      mainLog.warn('[WindowState] Invalid window state file, ignoring')
      return null
    }

    // Sanitize URLs in saved windows (remove dev-mode localhost URLs)
    state.windows = state.windows.map(win => ({
      ...win,
      url: sanitizeUrl(win.url),
    }))

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
