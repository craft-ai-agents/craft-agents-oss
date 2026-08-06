/**
 * Per-workspace avatar color overrides.
 *
 * Stored in localStorage so the user's choice survives reloads. When unset,
 * `WorkspaceAvatar` falls back to a deterministic hue derived from the
 * workspace id (see `components/ui/workspace-avatar.tsx`).
 */

import { atomWithStorage } from 'jotai/utils'

const STORAGE_KEY = 'craft-workspace-avatar-colors'

export type WorkspaceAvatarColors = Record<string, string>

export const workspaceAvatarColorsAtom = atomWithStorage<WorkspaceAvatarColors>(
  STORAGE_KEY,
  {}
)
