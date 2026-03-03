import type { HandlerDeps } from './handler-deps'
import type { RpcServer } from '../../transport/types'

import { registerLabelsHandlers } from './labels'
import { registerStatusesHandlers } from './statuses'
import { registerSkillsHandlers } from './skills'
import { registerFilesHandlers } from './files'
import { registerSystemHandlers } from './system'
import { registerAuthHandlers } from './auth'
import { registerSettingsHandlers } from './settings'
import { registerSourcesHandlers } from './sources'
import { registerLlmConnectionsHandlers } from './llm-connections'
import { registerAutomationsHandlers } from './automations'
import { registerWorkspaceHandlers } from './workspace'
import { registerSessionsHandlers } from './sessions'
import { registerBrowserHandlers } from './browser'
import { registerOAuthHandlers } from './oauth'
import { registerOnboardingHandlers } from '../onboarding'

export function registerAllRpcHandlers(server: RpcServer, deps: HandlerDeps): void {
  registerLabelsHandlers(server, deps)
  registerStatusesHandlers(server, deps)
  registerSkillsHandlers(server, deps)
  registerFilesHandlers(server, deps)
  registerSystemHandlers(server, deps)
  registerAuthHandlers(server, deps)
  registerSettingsHandlers(server, deps)
  registerSourcesHandlers(server, deps)
  registerLlmConnectionsHandlers(server, deps)
  registerAutomationsHandlers(server, deps)
  registerWorkspaceHandlers(server, deps)
  registerSessionsHandlers(server, deps)
  registerBrowserHandlers(server, deps)
  registerOAuthHandlers(server, deps)
  registerOnboardingHandlers(server, deps)
}
