import { hasOpenOverlay } from '../../../lib/overlay-detection'

export function shouldAutoFocusSessionComposer({
  compactMode,
  touchOnly,
  overlayOpen,
  activeElement,
}: {
  compactMode: boolean
  touchOnly: boolean
  overlayOpen: boolean
  activeElement: Pick<HTMLElement, 'tagName' | 'isContentEditable' | 'matches'> | null
}): boolean {
  if (compactMode || touchOnly || overlayOpen) return false
  if (!activeElement || activeElement.matches('[data-tutorial="chat-input"]')) return true
  return activeElement.tagName !== 'INPUT'
    && activeElement.tagName !== 'TEXTAREA'
    && !activeElement.isContentEditable
}

export function canAutoFocusSessionComposer(compactMode: boolean): boolean {
  return shouldAutoFocusSessionComposer({
    compactMode,
    touchOnly: window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches,
    overlayOpen: hasOpenOverlay(),
    activeElement: document.activeElement as HTMLElement | null,
  })
}

export interface ScopedInputEventTarget {
  sessionId?: string | null
  isFocusedPanel: boolean
  targetSessionId?: string
}

/**
 * Decide whether an input-affecting custom event should be handled by
 * this FreeFormInput instance.
 */
export function shouldHandleScopedInputEvent({
  sessionId,
  isFocusedPanel,
  targetSessionId,
}: ScopedInputEventTarget): boolean {
  if (targetSessionId) {
    return targetSessionId === sessionId
  }
  return isFocusedPanel
}

export interface RecallPromptArrowUpState {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing: boolean
  isProcessing: boolean
  input: string
  attachmentCount: number
  loadingAttachmentCount: number
  followUpItemCount: number
  inlineMenuOpen: boolean
  disabled: boolean
  disableSend: boolean
}

/**
 * Plain Arrow Up recalls/cancels only when there is truly no editable draft.
 * Whitespace, attachments, loading files, and follow-up context are all content.
 */
export function shouldRecallPromptOnArrowUp({
  key,
  shiftKey,
  metaKey,
  ctrlKey,
  altKey,
  isComposing,
  isProcessing,
  input,
  attachmentCount,
  loadingAttachmentCount,
  followUpItemCount,
  inlineMenuOpen,
  disabled,
  disableSend,
}: RecallPromptArrowUpState): boolean {
  return key === 'ArrowUp'
    && !shiftKey
    && !metaKey
    && !ctrlKey
    && !altKey
    && !isComposing
    && isProcessing
    && !disabled
    && !disableSend
    && input === ''
    && attachmentCount === 0
    && loadingAttachmentCount === 0
    && followUpItemCount === 0
    && !inlineMenuOpen
}
