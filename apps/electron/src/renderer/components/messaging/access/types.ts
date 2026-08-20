/**
 * Renderer-side aliases for the canonical messaging access-control types
 * defined in `apps/electron/src/shared/types.ts`. Kept as a thin re-export
 * surface so the access components stay structurally aligned with the IPC
 * contract without each component importing the long `Messaging*Info`
 * names.
 */

import type {
  MessagingPendingSenderInfo,
  MessagingPlatformOwnerInfo,
} from '../../../../shared/types'
import type { BindingAccess, UiMessagingAccessMode } from './access-mode'

export type PlatformAccessMode = UiMessagingAccessMode
export type BindingAccessMode = UiMessagingAccessMode
export type PlatformOwner = MessagingPlatformOwnerInfo
export type PendingSender = MessagingPendingSenderInfo
export type { BindingAccess }
