/**
 * Deep Link Handler
 *
 * Parses craftagents:// URLs and routes to appropriate actions.
 *
 * URL Formats (workspace is optional - uses active window if omitted):
 *
 * New compound format (hierarchical navigation):
 *   craftagents://inbox[/chat/{sessionId}]               - Chat list (inbox filter)
 *   craftagents://flagged[/chat/{sessionId}]             - Chat list (flagged filter)
 *   craftagents://archive[/chat/{sessionId}]             - Chat list (archive filter)
 *   craftagents://agent/{agentId}[/chat/{sessionId}]     - Chat list (agent filter)
 *   craftagents://sources[/source/{sourceSlug}]          - Sources list
 *   craftagents://settings[/{subpage}]                   - Settings (general, shortcuts, preferences)
 *
 * Legacy formats (still supported):
 *   craftagents://tab/{tabType}[/{id}][?params]
 *   craftagents://action/{actionName}[/{id}][?params]
 *   craftagents://sidebar/{filter}[/{id}]
 *   craftagents://workspace/{workspaceId}/tab/{tabType}[/{id}][?params]
 *   craftagents://workspace/{workspaceId}/action/{actionName}[?params]
 *
 * Examples:
 *   craftagents://inbox                                  (chat list, inbox filter)
 *   craftagents://inbox/chat/abc123                      (specific chat in inbox)
 *   craftagents://settings/shortcuts                     (shortcuts page)
 *   craftagents://sources/source/github                  (github source info)
 *   craftagents://tab/settings                           (legacy - uses active window)
 *   craftagents://action/new-chat?agentId=my-agent       (legacy - uses active window)
 *   craftagents://sidebar/inbox                          (legacy - uses active window)
 *   craftagents://workspace/ws123/tab/chat/session456    (legacy - targets specific workspace)
 */

import type { BrowserWindow } from 'electron'
import { mainLog } from './logger'
import type { WindowManager } from './window-manager'
import { IPC_CHANNELS } from '../shared/types'

export interface DeepLinkTarget {
  /** Workspace ID - undefined means use active window */
  workspaceId?: string
  /** New compound route format (e.g., 'inbox/chat/abc123', 'settings/shortcuts') */
  view?: string
  /** Legacy: tab type */
  tabType?: string
  tabParams?: Record<string, string>
  action?: string
  actionParams?: Record<string, string>
  sidebar?: string
  sidebarParams?: Record<string, string>
}

export interface DeepLinkResult {
  success: boolean
  error?: string
  windowId?: number
}

/**
 * Navigation payload sent to renderer via IPC
 */
export interface DeepLinkNavigation {
  /** New compound route format (e.g., 'inbox/chat/abc123', 'settings/shortcuts') */
  view?: string
  /** Legacy: tab type */
  tabType?: string
  tabParams?: Record<string, string>
  action?: string
  actionParams?: Record<string, string>
  sidebar?: string
  sidebarParams?: Record<string, string>
}

/**
 * Parse a deep link URL into structured target
 */
export function parseDeepLink(url: string): DeepLinkTarget | null {
  try {
    const parsed = new URL(url)

    if (parsed.protocol !== 'craftagents:') {
      return null
    }

    // For custom protocols, the hostname contains the first path segment
    // e.g., craftagents://workspace/ws123 → hostname='workspace', pathname='/ws123'
    // e.g., craftagents://tab/settings → hostname='tab', pathname='/settings'
    const host = parsed.hostname
    const pathParts = parsed.pathname.split('/').filter(Boolean)

    // craftagents://auth-callback?... (OAuth callbacks - return null to let existing handler process)
    if (host === 'auth-callback') {
      return null
    }

    // Compound route prefixes (new hierarchical format)
    const COMPOUND_ROUTE_PREFIXES = [
      'inbox', 'archive', 'flagged', 'agent', 'state', 'sources', 'settings'
    ]

    // craftagents://inbox/..., craftagents://settings/..., etc. (compound routes)
    if (COMPOUND_ROUTE_PREFIXES.includes(host)) {
      // Reconstruct the full compound route from host + pathname
      const viewRoute = pathParts.length > 0 ? `${host}/${pathParts.join('/')}` : host
      return {
        workspaceId: undefined,
        view: viewRoute,
      }
    }

    // craftagents://workspace/{workspaceId}/... (with workspace targeting)
    if (host === 'workspace') {
      const workspaceId = pathParts[0]
      if (!workspaceId) return null

      const result: DeepLinkTarget = { workspaceId }

      // Parse /tab/{tabType}/...
      if (pathParts[1] === 'tab') {
        result.tabType = pathParts[2]
        result.tabParams = {}

        // Handle path-based params (e.g., /tab/chat/{sessionId})
        if (pathParts[3]) {
          result.tabParams.id = pathParts[3]
        }
        // Handle secondary path param (e.g., /tab/source-info/{agentSlug}/{sourceSlug})
        if (pathParts[4]) {
          result.tabParams.secondaryId = pathParts[4]
        }

        // Handle query params (e.g., ?path=...&url=...)
        parsed.searchParams.forEach((value, key) => {
          result.tabParams![key] = value
        })
      }

      // Parse /action/{actionName}/...
      if (pathParts[1] === 'action') {
        result.action = pathParts[2]
        result.actionParams = {}
        // Handle path-based ID (e.g., /action/delete-session/{sessionId})
        if (pathParts[3]) {
          result.actionParams.id = pathParts[3]
        }
        parsed.searchParams.forEach((value, key) => {
          result.actionParams![key] = value
        })
      }

      // Parse /sidebar/{filter}/...
      if (pathParts[1] === 'sidebar') {
        result.sidebar = pathParts[2]
        result.sidebarParams = {}
        if (pathParts[3]) {
          result.sidebarParams.id = pathParts[3]
        }
        parsed.searchParams.forEach((value, key) => {
          result.sidebarParams![key] = value
        })
      }

      return result
    }

    // craftagents://tab/... (no workspace - uses active window)
    if (host === 'tab') {
      const result: DeepLinkTarget = {
        workspaceId: undefined, // Will use active window
        tabType: pathParts[0],
        tabParams: {},
      }

      // Handle path-based params
      if (pathParts[1]) {
        result.tabParams!.id = pathParts[1]
      }
      if (pathParts[2]) {
        result.tabParams!.secondaryId = pathParts[2]
      }

      parsed.searchParams.forEach((value, key) => {
        result.tabParams![key] = value
      })

      return result
    }

    // craftagents://action/... (no workspace - uses active window)
    if (host === 'action') {
      const result: DeepLinkTarget = {
        workspaceId: undefined,
        action: pathParts[0],
        actionParams: {},
      }

      if (pathParts[1]) {
        result.actionParams!.id = pathParts[1]
      }

      parsed.searchParams.forEach((value, key) => {
        result.actionParams![key] = value
      })

      return result
    }

    // craftagents://sidebar/... (no workspace - uses active window)
    if (host === 'sidebar') {
      const result: DeepLinkTarget = {
        workspaceId: undefined,
        sidebar: pathParts[0],
        sidebarParams: {},
      }

      if (pathParts[1]) {
        result.sidebarParams!.id = pathParts[1]
      }

      parsed.searchParams.forEach((value, key) => {
        result.sidebarParams![key] = value
      })

      return result
    }

    return null
  } catch (error) {
    mainLog.error('[DeepLink] Failed to parse URL:', url, error)
    return null
  }
}

/**
 * Generate a deep link URL from components
 */
export function generateDeepLinkUrl(
  workspaceId: string,
  tabType: string,
  params?: Record<string, string>
): string {
  let url = `craftagents://workspace/${workspaceId}/tab/${tabType}`

  // For simple tab types with an ID, append to path
  if (params?.id && !params.path && !params.url) {
    url += `/${params.id}`
    // Remove id from params so it's not duplicated in query string
    const { id: _id, ...remainingParams } = params
    params = Object.keys(remainingParams).length > 0 ? remainingParams : undefined
  }

  // Add remaining params as query string
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams(params)
    url += `?${searchParams.toString()}`
  }

  return url
}

/**
 * Wait for window's renderer to signal ready
 */
function waitForWindowReady(window: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => {
        // TIMING NOTE: This 100ms delay allows React to mount and register
        // IPC listeners before we send the deep link. `did-finish-load` fires
        // when the HTML is loaded, but React's useEffect hooks haven't run yet.
        // A proper handshake (renderer signals "ready") would be cleaner but
        // adds complexity for minimal gain - this delay is sufficient for all
        // practical cases and only affects reload scenarios.
        setTimeout(resolve, 100)
      })
    } else {
      resolve()
    }
  })
}

/**
 * Handle a deep link by navigating to the target
 */
export async function handleDeepLink(
  url: string,
  windowManager: WindowManager
): Promise<DeepLinkResult> {
  const target = parseDeepLink(url)

  if (!target) {
    // Return success for null targets (like auth-callback) - they're handled elsewhere
    if (url.includes('auth-callback')) {
      return { success: true }
    }
    return { success: false, error: 'Invalid deep link URL' }
  }

  mainLog.info('[DeepLink] Handling:', target)

  // 1. Get target window
  let window: BrowserWindow | null = null

  if (target.workspaceId) {
    // Workspace specified - focus or create window for that workspace
    window = windowManager.focusOrCreateWindow(target.workspaceId)
  } else {
    // No workspace - use focused window or last active
    window = windowManager.getFocusedWindow() ?? windowManager.getLastActiveWindow()

    if (!window) {
      // No windows at all - can't navigate without a workspace
      return { success: false, error: 'No active window to navigate' }
    }

    // Focus the window
    if (window.isMinimized()) {
      window.restore()
    }
    window.focus()
  }

  // 2. Wait for window to be ready (renderer loaded)
  await waitForWindowReady(window)

  // 3. Send navigation command to renderer
  if (target.view || target.tabType || target.action || target.sidebar) {
    const navigation: DeepLinkNavigation = {
      view: target.view,
      tabType: target.tabType,
      tabParams: target.tabParams,
      action: target.action,
      actionParams: target.actionParams,
      sidebar: target.sidebar,
      sidebarParams: target.sidebarParams,
    }
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.DEEP_LINK_NAVIGATE, navigation)
    }
  }

  return { success: true, windowId: window.isDestroyed() ? -1 : window.webContents.id }
}
