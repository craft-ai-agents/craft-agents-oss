/**
 * WebWindowManager - adapts the Electron WindowManager interface for web use.
 * Uses WebSocket broadcasting instead of Electron IPC.
 *
 * This class implements a subset of WindowManager's interface that SessionManager uses,
 * specifically the broadcastToAll() method.
 */
import { broadcastToAll } from './broadcaster.js'
import { homedir } from 'os'
import { join } from 'path'

/**
 * A minimal mock of BrowserWindow for the web context.
 * Used for getAllWindowsForWorkspace return type compatibility.
 */
class WebBrowserWindow {
  constructor(public readonly workspaceId: string) {}
}

export class WebWindowManager {
  private activeWorkspaceId: string | null = null
  private windowWorkspaceId: string | null = null
  private windowMode: string = 'main'

  setWorkspaceId(workspaceId: string): void {
    this.activeWorkspaceId = workspaceId
    this.windowWorkspaceId = workspaceId
  }

  getWorkspaceId(): string | null {
    return this.windowWorkspaceId
  }

  getWindowMode(): string {
    return this.windowMode
  }

  /**
   * Replace Electron's WindowManager.broadcastToAll().
   * Broadcasts a message to all connected WebSocket clients.
   */
  broadcastToAll(channel: string, ...args: unknown[]): void {
    // For consistency with Electron's multi-arg IPC, we send first arg as payload
    const payload = args.length === 0 ? undefined : args.length === 1 ? args[0] : args
    broadcastToAll(channel, payload)
  }

  /**
   * Get all "windows" for a workspace.
   * In web context, we return a mock window representing the web client.
   */
  getAllWindowsForWorkspace(workspaceId: string): WebBrowserWindow[] {
    // In web context, we always have at most one "window"
    if (this.activeWorkspaceId === workspaceId) {
      return [new WebBrowserWindow(workspaceId)]
    }
    return []
  }

  /**
   * Send a message to a specific workspace's windows.
   * In web context, this broadcasts to all clients (no per-window targeting).
   */
  sendToWorkspace(workspaceId: string, channel: string, payload?: unknown): void {
    broadcastToAll(channel, payload)
  }

  /**
   * No-op methods for window management features not applicable in web context
   */
  setTrafficLightsVisible(_webContentsId: number, _visible: boolean): void {
    // No-op for web
  }

  createWindow(_options: { workspaceId: string }): WebBrowserWindow {
    return new WebBrowserWindow(_options.workspaceId)
  }
}
