import type { SessionHeader } from '@archstudio/shared/sessions'

export interface MutableSessionMetadata {
  labels?: string[]
  isFlagged?: boolean
  sessionStatus?: string
  name?: string
  projectId?: string
  kanbanColumn?: string
  lastReadMessageId?: string
  hasUnread?: boolean
  isProcessing?: boolean
}

export interface ExternalMetadataChanges {
  changed: boolean
  labelsChanged?: string[]
  flagChanged?: boolean
  statusChanged?: string
  nameChanged?: string
}

export interface ReadMetadataUpdates {
  lastReadMessageId?: string
  hasUnread?: boolean
}

export function reconcileExternalSessionMetadata(
  target: MutableSessionMetadata,
  header: SessionHeader,
): ExternalMetadataChanges {
  const result: ExternalMetadataChanges = { changed: false }

  if (!sameLabels(target.labels, header.labels)) {
    target.labels = header.labels
    result.labelsChanged = header.labels ?? []
    result.changed = true
  }

  if ((target.isFlagged ?? false) !== (header.isFlagged ?? false)) {
    target.isFlagged = header.isFlagged ?? false
    result.flagChanged = target.isFlagged
    result.changed = true
  }

  if (target.sessionStatus !== header.sessionStatus) {
    target.sessionStatus = header.sessionStatus
    result.statusChanged = header.sessionStatus ?? ''
    result.changed = true
  }

  if (target.name !== header.name) {
    target.name = header.name
    result.nameChanged = header.name
    result.changed = true
  }

  if (target.projectId !== header.projectId) {
    target.projectId = header.projectId
    result.changed = true
  }

  if (target.kanbanColumn !== header.kanbanColumn) {
    target.kanbanColumn = header.kanbanColumn
    result.changed = true
  }

  return result
}

export function markSessionMetadataRead(
  target: MutableSessionMetadata,
  lastFinalAssistantMessageId: string | undefined,
): ReadMetadataUpdates | undefined {
  if (target.isProcessing) return undefined

  const updates: ReadMetadataUpdates = {}
  if (lastFinalAssistantMessageId && target.lastReadMessageId !== lastFinalAssistantMessageId) {
    target.lastReadMessageId = lastFinalAssistantMessageId
    updates.lastReadMessageId = lastFinalAssistantMessageId
  }
  if (target.hasUnread) {
    target.hasUnread = false
    updates.hasUnread = false
  }

  return Object.keys(updates).length > 0 ? updates : undefined
}

export function markSessionMetadataUnread(target: MutableSessionMetadata): ReadMetadataUpdates {
  target.hasUnread = true
  target.lastReadMessageId = undefined
  return { hasUnread: true, lastReadMessageId: undefined }
}

export function clearSessionUnread(target: MutableSessionMetadata): boolean {
  if (target.isProcessing || !target.hasUnread) return false
  target.hasUnread = false
  return true
}

function sameLabels(left: string[] | undefined, right: string[] | undefined): boolean {
  const a = left ?? []
  const b = right ?? []
  return a.length === b.length && a.every((label, index) => label === b[index])
}
