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
