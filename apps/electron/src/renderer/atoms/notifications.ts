/**
 * notifications atom — per-workspace state for the Pulse notification bell.
 *
 * Mirrors the workflow-runs atom shape. `NotificationEntry` is the canonical
 * shared type re-exported through the electron shared types surface.
 */

import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { NotificationEntry } from '../../shared/types'

export type { NotificationEntry }

export interface NotificationsState {
  entries: NotificationEntry[]
  loading: boolean
  error: string | null
}

export const initialNotificationsState: NotificationsState = {
  entries: [],
  loading: true,
  error: null,
}

export const notificationsStateAtomFamily = atomFamily(
  (workspaceId: string) => atom<NotificationsState>(initialNotificationsState),
  (a, b) => a === b,
)
