import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

import { registerAuthHandlers } from './auth'
import { registerCloudRunsHandlers } from './cloud-runs'
import { registerIdentityHandlers } from './identity'
import { registerExtensionsHandlers } from './extensions'
import { registerPluginBridgeHandlers } from './plugin-bridge'
import { registerAutomationsHandlers } from './automations'
import { registerContextDocsHandlers } from './context-docs'
import { registerBundledSkillsHandlers } from './bundled-skills'
import { registerMarketplaceHandlers } from './marketplace'
import { registerFilesHandlers } from './files'
import { registerLabelsHandlers } from './labels'
import { registerOrgsHandlers } from './orgs'
import { registerLlmConnectionsHandlers } from './llm-connections'
import { registerOAuthHandlers } from './oauth'
import { registerResourcesHandlers } from './resources'
import { registerOnboardingHandlers } from './onboarding'
import { registerSessionsHandlers, cleanupSessionFileWatchForClient } from './sessions'
import { registerNotesHandlers, cleanupNotesWatchForClient } from './notes'
export { registerSessionsHandlers, cleanupSessionFileWatchForClient } from './sessions'
export { cleanupNotesWatchForClient } from './notes'
import { registerKnowledgeHandlers, cleanupKnowledgeWatchForClient } from './knowledge'
import { registerMindmapHandlers } from './mindmap'
import { registerServerHandlers } from './server'
import type { ServerHandlerContext } from '../../bootstrap/headless-start'
export type { ServerHandlerContext } from '../../bootstrap/headless-start'
export { getHealthCheck } from './server'
import { registerSettingsHandlers } from './settings'
import { registerGamificationHandlers } from './gamification'
import { registerProjectsHandlers } from './projects'
import { registerKanbanHandlers } from './kanban'
import { registerCollectionHandlers } from './collection'

import { registerSkillsHandlers } from './skills'
import { registerSourcesHandlers } from './sources'
import { registerStatusesHandlers } from './statuses'
import { registerSystemCoreHandlers } from './system'
import { registerTasksHandlers } from './tasks'
import { registerToolchainHandlers } from './toolchain'
import { registerTransferHandlers } from './transfer'
import { registerWorkspaceCoreHandlers } from './workspace'
import { registerMessagingHandlers } from './messaging'
import { registerMemoryHandlers } from './memory'
import { registerMemoryIoHandlers } from './memory-io'
import { registerMemoryInsightsHandlers } from './memory-insights'
import { registerSkillsPendingHandlers } from './skills-pending'
import { registerOpenClawHandlers } from './openclaw'
export function cleanupCoreClientResources(clientId: string): void {
  cleanupSessionFileWatchForClient(clientId)
  cleanupNotesWatchForClient(clientId)
  cleanupKnowledgeWatchForClient(clientId)
}
import { registerBrowserPaneHandlers } from './browser-pane'

export interface CoreRpcRegistrationOptions {
  /**
   * Register browser-pane:* channels (standalone/headless server needs them
   * for the Web UI). Set to false when the host app registers its own
   * browser-pane handlers (electron GUI) — the RpcServer rejects duplicate
   * channel registrations and the app fails to boot.
   */
  browserPane?: boolean
}

export function registerCoreRpcHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  serverCtx?: ServerHandlerContext,
  options?: CoreRpcRegistrationOptions,
): void {
  registerAuthHandlers(server, deps)
  registerCloudRunsHandlers(server, deps)
  registerIdentityHandlers(server, deps)
  registerExtensionsHandlers(server, deps)
  registerPluginBridgeHandlers(server, deps)
  registerAutomationsHandlers(server, deps)
  registerContextDocsHandlers(server, deps)
  registerMarketplaceHandlers(server, deps)
  registerBundledSkillsHandlers(server, deps)
  registerFilesHandlers(server, deps)
  registerLabelsHandlers(server, deps)
  registerOrgsHandlers(server, deps)
  registerLlmConnectionsHandlers(server, deps)
  registerOAuthHandlers(server, deps)
  registerOnboardingHandlers(server, deps)
  registerResourcesHandlers(server, deps)
  registerSessionsHandlers(server, deps)
  if (serverCtx) registerServerHandlers(server, deps, serverCtx)
  registerSettingsHandlers(server, deps)
  registerGamificationHandlers(server, deps)
  registerProjectsHandlers(server, deps)
  registerKanbanHandlers(server, deps)
  registerCollectionHandlers(server, deps)

  registerSkillsHandlers(server, deps)
  registerSourcesHandlers(server, deps)
  registerStatusesHandlers(server, deps)
  registerSystemCoreHandlers(server, deps)
  registerTasksHandlers(server, deps)
  registerToolchainHandlers(server, deps)
  registerOpenClawHandlers(server, deps)
  registerTransferHandlers(server)
  registerWorkspaceCoreHandlers(server, deps)
  registerMessagingHandlers(server, deps)
  registerMemoryHandlers(server, deps)
  registerMemoryIoHandlers(server, deps)
  registerMemoryInsightsHandlers(server, deps)
  registerSkillsPendingHandlers(server, deps)
  registerNotesHandlers(server, deps)
  registerKnowledgeHandlers(server, deps)
  registerMindmapHandlers(server, deps)
  if (options?.browserPane !== false) registerBrowserPaneHandlers(server, deps)
}
