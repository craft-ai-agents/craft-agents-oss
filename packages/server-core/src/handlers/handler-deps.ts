import type { PlatformServices } from '../runtime/platform'
import type { ISessionManager } from './session-manager-interface'

/**
 * Generic handler dependency bag.
 * Concrete hosts specialize these generics to their runtime implementations.
 *
 * TSessionManager defaults to ISessionManager so core handlers get
 * typed access without specialization.  Electron narrows it to the
 * concrete SessionManager class.
 */
export interface HandlerDeps<
  TSessionManager extends ISessionManager = ISessionManager,
  TOAuthFlowStore = unknown,
  TWindowManager = unknown,
  TBrowserPaneManager = unknown,
> {
  sessionManager: TSessionManager
  platform: PlatformServices
  windowManager?: TWindowManager
  browserPaneManager?: TBrowserPaneManager
  oauthFlowStore: TOAuthFlowStore
}
