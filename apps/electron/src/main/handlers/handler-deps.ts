/**
 * HandlerDeps — dependency bag for all IPC handlers.
 *
 * Concrete Electron specialization of the generic server-core handler deps.
 */

import type { HandlerDeps as BaseHandlerDeps } from '@archstudio/server-core/handlers'
import type { SessionManager } from '@archstudio/server-core/sessions'
import type { WindowManager } from '../window-manager'
import type { BrowserPaneManager } from '../browser-pane-manager'
import type { OAuthFlowStore } from '@archstudio/shared/auth'

export type HandlerDeps = BaseHandlerDeps<
  SessionManager,
  OAuthFlowStore,
  WindowManager,
  BrowserPaneManager
>
