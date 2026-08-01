import { describe, expect, it } from 'bun:test'
import type { SessionHeader } from '@archstudio/shared/sessions'
import {
  clearSessionUnread,
  markSessionMetadataRead,
  markSessionMetadataUnread,
  reconcileExternalSessionMetadata,
  type MutableSessionMetadata,
} from './session-metadata'

describe('session metadata helpers', () => {
  it('reconciles mutable header fields and reports event-relevant changes', () => {
    const target = {
      labels: ['old'],
      isFlagged: false,
      sessionStatus: 'todo',
      name: 'Before',
      projectId: 'project-old',
      kanbanColumn: 'todo',
    }
    const header = {
      labels: ['new'],
      isFlagged: true,
      sessionStatus: 'in_progress',
      name: 'After',
      projectId: 'project-new',
      kanbanColumn: 'doing',
    } as SessionHeader

    expect(reconcileExternalSessionMetadata(target, header)).toEqual({
      changed: true,
      labelsChanged: ['new'],
      flagChanged: true,
      statusChanged: 'in_progress',
      nameChanged: 'After',
    })
    expect(target).toEqual({
      labels: ['new'],
      isFlagged: true,
      sessionStatus: 'in_progress',
      name: 'After',
      projectId: 'project-new',
      kanbanColumn: 'doing',
    })
  })

  it('returns no changes for equivalent metadata', () => {
    const target = { labels: ['one'], isFlagged: false, name: 'Same' }
    const header = { labels: ['one'], isFlagged: false, name: 'Same' } as SessionHeader
    expect(reconcileExternalSessionMetadata(target, header)).toEqual({ changed: false })
  })

  it('marks a session read only when not processing and returns minimal persistence updates', () => {
    const target = { hasUnread: true, lastReadMessageId: 'old', isProcessing: false }
    expect(markSessionMetadataRead(target, 'latest')).toEqual({
      lastReadMessageId: 'latest',
      hasUnread: false,
    })
    expect(target).toEqual({ hasUnread: false, lastReadMessageId: 'latest', isProcessing: false })

    const processing = { hasUnread: true, isProcessing: true }
    expect(markSessionMetadataRead(processing, 'latest')).toBeUndefined()
    expect(processing.hasUnread).toBe(true)
  })

  it('marks unread and clears unread only for eligible sessions', () => {
    const target: MutableSessionMetadata = { hasUnread: false, lastReadMessageId: 'latest', isProcessing: false }
    expect(markSessionMetadataUnread(target)).toEqual({ hasUnread: true, lastReadMessageId: undefined })
    expect(target).toEqual({ hasUnread: true, lastReadMessageId: undefined, isProcessing: false })
    expect(clearSessionUnread(target)).toBe(true)
    expect(clearSessionUnread(target)).toBe(false)
    target.hasUnread = true
    target.isProcessing = true
    expect(clearSessionUnread(target)).toBe(false)
    expect(target.hasUnread).toBe(true)
  })
})
