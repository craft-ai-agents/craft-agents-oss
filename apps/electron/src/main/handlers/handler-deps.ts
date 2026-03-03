/**
 * HandlerDeps — dependency bag for all IPC handlers.
 *
 * Replaces the old IpcContext. Core handlers use sessionManager + platform.
 * Shell handlers additionally use windowManager and/or browserPaneManager.
 */

import type { SessionManager } from '../sessions'
import type { PlatformServices } from '../../runtime/platform'
import type { WindowManager } from '../window-manager'
import type { BrowserPaneManager } from '../browser-pane-manager'
import type { OAuthFlowStore } from '@craft-agent/shared/auth'

export interface HandlerDeps {
  sessionManager: SessionManager
  platform: PlatformServices
  // Shell-only (undefined for headless)
  windowManager?: WindowManager
  browserPaneManager?: BrowserPaneManager
  // Server-owned OAuth flow store
  oauthFlowStore: OAuthFlowStore
}
