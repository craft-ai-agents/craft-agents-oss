import { useCallback, useEffect, useRef } from 'react'
import type { FileAttachment } from '../../shared/types'
import type { DraftAttachmentRef, SessionDraft } from '@archstudio/shared/config'
import { attachmentFromContentRef, toDraftRef } from '../lib/drafts'
import { coerceInputText } from '../lib/input-text'

const DRAFT_SAVE_DEBOUNCE_MS = 500

export function useSessionDrafts() {
  const draftsRef = useRef<Map<string, SessionDraft>>(new Map())
  const saveTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => () => {
    saveTimeoutsRef.current.forEach(clearTimeout)
    saveTimeoutsRef.current.clear()
  }, [])

  const replaceDrafts = useCallback((drafts: Record<string, SessionDraft>) => {
    draftsRef.current = new Map(Object.entries(drafts))
  }, [])

  const clearDrafts = useCallback(() => {
    draftsRef.current.clear()
  }, [])

  const getDraft = useCallback((sessionId: string): string => {
    const draft = draftsRef.current.get(sessionId) as unknown
    const text = draft && typeof draft === 'object'
      ? (draft as { text?: unknown }).text
      : draft
    return coerceInputText(text)
  }, [])

  const getDraftAttachmentRefs = useCallback((sessionId: string): DraftAttachmentRef[] => {
    const attachments = draftsRef.current.get(sessionId)?.attachments
    return Array.isArray(attachments) ? attachments : []
  }, [])

  const hydrateDraftAttachments = useCallback(async (sessionId: string): Promise<FileAttachment[]> => {
    const refs = getDraftAttachmentRefs(sessionId)
    if (refs.length === 0) return []

    const results = await Promise.all(refs.map(async (ref) => {
      if (ref.content) return attachmentFromContentRef(ref)
      try {
        const attachment = await window.electronAPI.readUserAttachment(ref.path)
        if (!attachment) {
          console.warn('[drafts] Attachment missing on restore, dropping:', ref.path)
          return null
        }
        return attachment
      } catch (error) {
        console.warn('[drafts] Failed to restore attachment, dropping:', ref.path, error)
        return null
      }
    }))

    return results.filter((attachment): attachment is FileAttachment => attachment !== null)
  }, [getDraftAttachmentRefs])

  const schedulePersistDraft = useCallback((sessionId: string) => {
    const existingTimeout = saveTimeoutsRef.current.get(sessionId)
    if (existingTimeout) clearTimeout(existingTimeout)

    const timeout = setTimeout(() => {
      const draft = draftsRef.current.get(sessionId) ?? { text: '' }
      window.electronAPI.setDraft(sessionId, draft)
      saveTimeoutsRef.current.delete(sessionId)
    }, DRAFT_SAVE_DEBOUNCE_MS)
    saveTimeoutsRef.current.set(sessionId, timeout)
  }, [])

  const handleInputChange = useCallback((sessionId: string, value: string) => {
    const text = coerceInputText(value)
    const existingAttachments = getDraftAttachmentRefs(sessionId)
    const nextDraft: SessionDraft = {
      text,
      ...(existingAttachments.length > 0 ? { attachments: existingAttachments } : {}),
    }

    if (!nextDraft.text && !nextDraft.attachments?.length) draftsRef.current.delete(sessionId)
    else draftsRef.current.set(sessionId, nextDraft)
    schedulePersistDraft(sessionId)
  }, [getDraftAttachmentRefs, schedulePersistDraft])

  const handleAttachmentsChange = useCallback((sessionId: string, attachments: FileAttachment[]) => {
    const refs: DraftAttachmentRef[] = []
    for (const attachment of attachments) {
      const ref = toDraftRef(attachment)
      if (ref) refs.push(ref)
      else console.warn('[drafts] attachment exceeds per-draft size cap, not persisted:', attachment.name, attachment.size)
    }

    const nextDraft: SessionDraft = {
      text: getDraft(sessionId),
      ...(refs.length > 0 ? { attachments: refs } : {}),
    }

    if (!nextDraft.text && !nextDraft.attachments?.length) draftsRef.current.delete(sessionId)
    else draftsRef.current.set(sessionId, nextDraft)
    schedulePersistDraft(sessionId)
  }, [getDraft, schedulePersistDraft])

  return {
    clearDrafts,
    getDraft,
    getDraftAttachmentRefs,
    handleAttachmentsChange,
    handleInputChange,
    hydrateDraftAttachments,
    replaceDrafts,
  }
}
