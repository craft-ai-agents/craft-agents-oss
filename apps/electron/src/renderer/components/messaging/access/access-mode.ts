/**
 * Settings-surface access modes for Increment B Task 6.
 * Legacy open/inherit/missing normalize to public-inbox.
 * Renderer-local DTOs — do not re-export gateway wire unions from here.
 */

export type UiAccessMode = 'public-inbox' | 'owner-control' | 'disabled'
export type UiMessagingAccessMode = UiAccessMode

export const UI_ACCESS_MODES: readonly UiAccessMode[] = [
  'public-inbox',
  'owner-control',
  'disabled',
]

export const DEFAULT_UI_ACCESS_MODE: UiAccessMode = 'public-inbox'

export interface BindingAccess {
  mode: UiAccessMode
  allowedSenderIds: string[]
}

export function normalizeUiAccessMode(raw: unknown): UiAccessMode {
  if (raw === 'owner-only' || raw === 'owner-control' || raw === 'allow-list') {
    return 'owner-control'
  }
  if (raw === 'disabled') return 'disabled'
  return 'public-inbox'
}

export function canCommitOwnerControl(allowedSenderIds: readonly string[]): boolean {
  return allowedSenderIds.some((id) => id.trim().length > 0)
}

/** Inbound acceptance. Only `disabled` drops the message entirely. */
export function bindingRoutesInbound(mode: unknown): boolean {
  return normalizeUiAccessMode(mode) !== 'disabled'
}

export function toBindingAccess(binding: {
  accessMode?: unknown
  allowedSenderIds?: readonly string[]
}): BindingAccess {
  return {
    mode: normalizeUiAccessMode(binding.accessMode),
    allowedSenderIds: [...(binding.allowedSenderIds ?? [])],
  }
}

/**
 * Pending Allow for `not-on-binding-allowlist` adds one exact sender id to
 * that binding's allow-list and leaves the binding in owner-control.
 * Other binding records are copied unchanged (mode preserved).
 */
export function applyDisplayedSenderApproval(
  records: Record<string, BindingAccess>,
  sender: { userId: string; bindingId?: string; reason?: string },
): {
  records: Record<string, BindingAccess>
  mode: 'owner-control'
  userId: string
  bindingId?: string
} {
  const userId = sender.userId.trim()
  const recordsCopy: Record<string, BindingAccess> = Object.fromEntries(
    Object.entries(records).map(([id, access]) => [
      id,
      { mode: access.mode, allowedSenderIds: [...access.allowedSenderIds] },
    ]),
  )
  const result: {
    records: Record<string, BindingAccess>
    mode: 'owner-control'
    userId: string
    bindingId?: string
  } = {
    records: recordsCopy,
    mode: 'owner-control',
    userId,
  }
  if (sender.bindingId) result.bindingId = sender.bindingId
  if (!sender.bindingId || !userId) return result

  const current = recordsCopy[sender.bindingId] ?? {
    mode: 'owner-control' as const,
    allowedSenderIds: [] as string[],
  }
  const allowedSenderIds = current.allowedSenderIds.includes(userId)
    ? [...current.allowedSenderIds]
    : [...current.allowedSenderIds, userId]
  recordsCopy[sender.bindingId] = {
    mode: 'owner-control',
    allowedSenderIds,
  }
  return result
}

export function pendingApprovalLeavesOwnerControl(sender: {
  userId: string
  bindingId?: string
  reason?: string
}): { mode: 'owner-control'; userId: string; bindingId?: string } {
  const applied = applyDisplayedSenderApproval({}, sender)
  return {
    mode: applied.mode,
    userId: applied.userId,
    ...(applied.bindingId ? { bindingId: applied.bindingId } : {}),
  }
}
