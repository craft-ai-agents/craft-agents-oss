import type { SetupNeeds } from '@craft-agent/shared/auth'
import type { LlmConnectionWithStatus } from '@craft-agent/shared/config'

export type StartupAppState = 'onboarding' | 'workspace-picker' | 'ready'

export function hasReadyEnvironmentConnection(connections: LlmConnectionWithStatus[]): boolean {
  return connections.some((connection) => connection.isEnvironmentConnection && connection.isAuthenticated)
}

export async function resolveAuthenticatedStartupState({
  setupNeeds,
  windowWorkspaceId,
  listLlmConnectionsWithStatus,
}: {
  setupNeeds: SetupNeeds
  windowWorkspaceId?: string | null
  listLlmConnectionsWithStatus: () => Promise<LlmConnectionWithStatus[]>
}): Promise<StartupAppState> {
  if (setupNeeds.isFullyConfigured) {
    return windowWorkspaceId ? 'ready' : 'workspace-picker'
  }

  const connections = await listLlmConnectionsWithStatus()
  if (hasReadyEnvironmentConnection(connections)) {
    return windowWorkspaceId ? 'ready' : 'workspace-picker'
  }

  return 'onboarding'
}
