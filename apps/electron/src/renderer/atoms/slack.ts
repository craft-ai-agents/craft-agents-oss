/**
 * Slack Atoms
 *
 * State management for Slack integration.
 * Manages OAuth connection status, workspace info, and error state.
 */

import { atom } from 'jotai'

/**
 * Slack connection status
 */
export interface SlackConnection {
  isConnected: boolean
  isConnecting: boolean
  teamName?: string
  teamId?: string
  userId?: string
  connectedAt?: number
}

/**
 * Slack connection atom
 */
export const slackConnectionAtom = atom<SlackConnection>({
  isConnected: false,
  isConnecting: false,
})

/**
 * Slack workspace info (for settings display)
 */
export interface SlackWorkspaceInfo {
  teamId: string
  teamName: string
  userId: string
  connectedAt: number
}

export const slackWorkspacesAtom = atom<SlackWorkspaceInfo[]>([])

/**
 * Slack error state
 */
export const slackErrorAtom = atom<string | null>(null)

/**
 * OAuth loading state
 */
export const slackOAuthLoadingAtom = atom(false)

/**
 * Service connection status per workspace
 * Maps workspace ID to service state
 */
export const slackServiceStatusAtom = atom<Record<string, import('@vesper/shared/slack').SlackServiceState>>({})

/**
 * Recent messages (for activity indicators)
 */
export const slackRecentMessagesAtom = atom<import('@vesper/shared/slack').SlackInboundMessage[]>([])

/**
 * Processing indicator
 */
export const slackProcessingAtom = atom<boolean>(false)

/**
 * Derived atom for connection status of a workspace
 */
export const slackIsConnectedAtom = atom((get) => {
  const statuses = get(slackServiceStatusAtom)
  return (workspaceId: string) => {
    const state = statuses[workspaceId]
    return state?.status === 'connected'
  }
})
