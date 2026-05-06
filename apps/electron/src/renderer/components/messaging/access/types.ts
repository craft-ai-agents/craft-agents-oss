/**
 * Renderer-side aliases for the canonical messaging access-control types
 * defined in `apps/electron/src/shared/types.ts`. Kept as a thin re-export
 * surface so the access components stay structurally aligned with the IPC
 * contract without each component importing the long `Messaging*Info`
 * names.
 */

import type {
  MessagingBindingAccessMode,
  MessagingPendingSenderInfo,
  MessagingPlatformAccessMode,
  MessagingPlatformOwnerInfo,
} from '../../../../shared/types'

export type PlatformAccessMode = MessagingPlatformAccessMode
export type BindingAccessMode = MessagingBindingAccessMode
export type PlatformOwner = MessagingPlatformOwnerInfo
export type PendingSender = MessagingPendingSenderInfo

export interface BindingAccess {
  mode: BindingAccessMode
  /** Only meaningful when `mode === 'allow-list'`. */
  allowedSenderIds: string[]
}
