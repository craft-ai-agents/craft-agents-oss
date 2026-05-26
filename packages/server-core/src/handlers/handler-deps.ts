import type { PlatformServices } from '../runtime/platform'
import type { ISessionManager } from './session-manager-interface'
import type { IOAuthFlowStore } from './oauth-flow-store-interface'
import type { IBrowserPaneManager } from './browser-pane-manager-interface'
import type { IWindowManager } from './window-manager-interface'
import type { IMessagingGatewayRegistry } from './messaging-registry-interface'

/**
 * Generic handler dependency bag.
 * Concrete hosts specialize these generics to their runtime implementations.
 *
 * TSessionManager defaults to ISessionManager, TOAuthFlowStore
 * defaults to IOAuthFlowStore, TWindowManager defaults to IWindowManager,
 * and TBrowserPaneManager defaults to IBrowserPaneManager so core handlers
 * get typed access without specialization.  Electron narrows all to their
 * concrete implementations.
 */
export interface HandlerDeps<
  TSessionManager extends ISessionManager = ISessionManager,
  TOAuthFlowStore extends IOAuthFlowStore = IOAuthFlowStore,
  TWindowManager extends IWindowManager = IWindowManager,
  TBrowserPaneManager extends IBrowserPaneManager = IBrowserPaneManager,
> {
  sessionManager: TSessionManager
  platform: PlatformServices
  windowManager?: TWindowManager
  browserPaneManager?: TBrowserPaneManager
  oauthFlowStore: TOAuthFlowStore
  messagingRegistry?: IMessagingGatewayRegistry
  /**
   * Reads the current state of the inbound webhook trigger HTTP server.
   * Used by the renderer to display the live trigger URL and an
   * "enabled/disabled" indicator. The closure is stable for the host's
   * lifetime; the *contents* it reports change as the trigger server
   * starts/stops.
   */
  getTriggerServerInfo?: () => { enabled: boolean; url: string | null }
  /**
   * Resolve the host's `WorkflowRunner`. Lazy-resolved via a getter so the
   * dep bag doesn't have to import the runner at construction time and so
   * hosts that don't yet wire workflows can omit it. Workflow handlers
   * call this once on use and surface a clear error when undefined.
   */
  getWorkflowRunner?: () => import('../workflows/runner').WorkflowRunner
  getDeepResearchRunner?: () => import('../deep-research/DeepResearchRunner').DeepResearchRunner
  /**
   * Resolve the host's `NotificationService`. Lazy-resolved via a getter so
   * the dep bag doesn't have to import the service at construction time.
   * Lane B's PulseExecutor wiring reads this to call `add()` on
   * `notify_user` / `ask_user` decisions.
   */
  getNotificationService?: () => import('../notifications/NotificationService').NotificationService
}
