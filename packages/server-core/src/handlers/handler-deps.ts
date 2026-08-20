import type { PlatformServices } from '../runtime/platform'
import type { ISessionManager } from './session-manager-interface'
import type { IOAuthFlowStore } from './oauth-flow-store-interface'
import type { IBrowserPaneManager } from './browser-pane-manager-interface'
import type { IWindowManager } from './window-manager-interface'
import type { IMessagingGatewayRegistry } from './messaging-registry-interface'
import type {
  AcceptSecurityRiskRequest,
  AuditMode,
  OpenClawRuntimeStatus,
  SecurityAuditSnapshot,
} from '@craft-agent/shared/openclaw'

export interface OpenClawSecurityWorkspaceInput {
  readonly workspaceId: string
}

export interface OpenClawSecurityAuditInput extends OpenClawSecurityWorkspaceInput {
  readonly mode: AuditMode
}

export interface RevokeOpenClawSecurityRiskInput extends OpenClawSecurityWorkspaceInput {
  readonly fingerprint: string
}

/**
 * Safe OpenClaw data operations available to the core RPC layer.
 *
 * The host owns the concrete composition. Inputs arrive only after the RPC
 * boundary validates and authorizes them; outputs are canonical safe shared
 * projections. Host-control effects intentionally do not belong here.
 */
export interface OpenClawSecurityService {
  getRuntimeStatus(input: OpenClawSecurityWorkspaceInput): Promise<OpenClawRuntimeStatus>
  installRuntime(input: OpenClawSecurityWorkspaceInput): Promise<OpenClawRuntimeStatus>
  provisionRuntime(input: OpenClawSecurityWorkspaceInput): Promise<OpenClawRuntimeStatus>
  startRuntime(input: OpenClawSecurityWorkspaceInput): Promise<OpenClawRuntimeStatus>
  stopRuntime(input: OpenClawSecurityWorkspaceInput): Promise<OpenClawRuntimeStatus>
  runAudit(input: OpenClawSecurityAuditInput): Promise<SecurityAuditSnapshot>
  getLatestAudit(input: OpenClawSecurityWorkspaceInput): Promise<SecurityAuditSnapshot | null>
  acceptRisk(input: AcceptSecurityRiskRequest): Promise<void>
  revokeRiskAcceptance(input: RevokeOpenClawSecurityRiskInput): Promise<void>
}


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
  /** Optional because standalone/headless hosts do not compose a managed OpenClaw runtime. */
  openClawSecurity?: OpenClawSecurityService
}
