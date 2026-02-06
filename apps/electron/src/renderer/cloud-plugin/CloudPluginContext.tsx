/**
 * CloudPluginContext
 *
 * Provides cloud-workspace state (sandbox status, cloud sync, remote sandbox toggle)
 * to all descendant components via React context.
 *
 * This eliminates prop drilling of isCloudWorkspace / isRemoteSandbox / sandboxStatuses
 * through ChatPage -> ChatDisplay -> FreeFormInput -> SandboxToggle.
 */

import { createContext, useContext, type ReactNode } from 'react'
import { useCloudSync } from './useCloudSync'
import { useSandboxStatus, type UseSandboxStatusResult } from './useSandboxStatus'
import type { Workspace } from '@craft-agent/shared/config'
import type { SandboxStatus } from '../../shared/types'

export interface CloudPluginState {
  /** Whether the active workspace uses cloud storage */
  isCloudWorkspace: boolean
  /** Sandbox statuses keyed by session ID */
  sandboxStatuses: Map<string, SandboxStatus>
  /** Terminate a sandbox for a given session */
  terminateSandbox: (sessionId: string) => Promise<boolean>
  /** Refresh sandbox statuses immediately */
  refreshSandboxStatuses: () => Promise<void>
}

const defaultState: CloudPluginState = {
  isCloudWorkspace: false,
  sandboxStatuses: new Map(),
  terminateSandbox: async () => false,
  refreshSandboxStatuses: async () => {},
}

const CloudPluginCtx = createContext<CloudPluginState>(defaultState)

export function useCloudPlugin(): CloudPluginState {
  return useContext(CloudPluginCtx)
}

interface CloudPluginProviderProps {
  activeWorkspace: Workspace | null
  children: ReactNode
}

export function CloudPluginProvider({ activeWorkspace, children }: CloudPluginProviderProps) {
  const workspaceId = activeWorkspace?.id ?? null
  const isCloudWorkspace = !!(activeWorkspace?.storageType === 'cloud' && activeWorkspace?.cloudConfig)

  // Cloud sync — listens for remote change events from main process
  useCloudSync({ workspaceId, enabled: isCloudWorkspace })

  // Sandbox status polling
  const { sandboxStatuses, terminateSandbox, refresh } = useSandboxStatus({
    workspaceId,
    isCloudWorkspace,
    enabled: isCloudWorkspace,
  })

  const value: CloudPluginState = {
    isCloudWorkspace,
    sandboxStatuses,
    terminateSandbox,
    refreshSandboxStatuses: refresh,
  }

  return (
    <CloudPluginCtx.Provider value={value}>
      {children}
    </CloudPluginCtx.Provider>
  )
}
