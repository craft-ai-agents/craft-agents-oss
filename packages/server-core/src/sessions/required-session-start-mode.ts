import { parsePermissionMode, type PermissionMode } from '@craft-agent/shared/agent/mode-types'
import type { WorkspaceConfig } from '@craft-agent/shared/workspaces'

/** Read the workspace's opt-in policy, not a mode supplied by the session caller. */
export function readRequiredSessionStartMode(config: WorkspaceConfig | null): PermissionMode | undefined {
  const raw = config?.defaults?.requiredPermissionMode
  if (raw === undefined) return undefined
  const mode = typeof raw === 'string' ? parsePermissionMode(raw) : null
  if (!mode) {
    throw new Error('Invalid workspace defaults.requiredPermissionMode. Use explore, ask, guarded, or execute.')
  }
  return mode
}
