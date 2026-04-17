/**
 * Messaging Gateway Atoms
 *
 * Workspace-level state for messaging bindings.
 * Populated by subscribing to messaging:bindingChanged push events.
 * SessionItem reads from the derived map for O(1) badge lookups.
 */

import { atom } from 'jotai'

export interface MessagingBinding {
  id: string
  workspaceId: string
  sessionId: string
  platform: string
  channelId: string
  channelName?: string
  enabled: boolean
}

/**
 * Map of sessionId → MessagingBinding for the active workspace.
 * Updated when messaging:bindingChanged events arrive.
 */
export const messagingBindingsMapAtom = atom<Map<string, MessagingBinding>>(new Map())

/**
 * Update the bindings map from a flat array (from getMessagingBindings RPC).
 */
export const setMessagingBindingsAtom = atom(
  null,
  (_get, set, bindings: MessagingBinding[]) => {
    const map = new Map<string, MessagingBinding>()
    for (const b of bindings) {
      if (b.enabled) {
        map.set(b.sessionId, b)
      }
    }
    set(messagingBindingsMapAtom, map)
  },
)

/**
 * Global messaging dialog state.
 *
 * Hoisted out of SessionMenu so dialogs survive context-menu / dropdown close.
 * Rendered by <MessagingDialogHost /> mounted at AppShell level.
 */
export type MessagingDialogState =
  | { kind: 'closed' }
  | {
      kind: 'pairing'
      platform: 'telegram' | 'whatsapp'
      sessionId: string
      code: string | null
      expiresAt: number | null
      botUsername?: string
      error?: string
    }
  | { kind: 'wa_connect' }

export const messagingDialogAtom = atom<MessagingDialogState>({ kind: 'closed' })
