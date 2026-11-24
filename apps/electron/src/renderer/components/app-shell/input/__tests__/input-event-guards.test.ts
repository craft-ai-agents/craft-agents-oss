import { describe, expect, it } from 'bun:test'
import {
  shouldHandleScopedInputEvent,
  shouldAutoFocusSessionComposer,

  shouldRecallPromptOnArrowUp,
  type RecallPromptArrowUpState,
} from '../input-event-guards'

describe('shouldHandleScopedInputEvent', () => {
  it('handles targeted event only for matching session', () => {
    expect(shouldHandleScopedInputEvent({
      sessionId: 'session-a',
      isFocusedPanel: false,
      targetSessionId: 'session-a',
    })).toBe(true)

    expect(shouldHandleScopedInputEvent({
      sessionId: 'session-a',
      isFocusedPanel: true,
      targetSessionId: 'session-b',
    })).toBe(false)
  })

  it('handles untargeted events only for focused panel', () => {
    expect(shouldHandleScopedInputEvent({
      sessionId: 'session-a',
      isFocusedPanel: true,
    })).toBe(true)

    expect(shouldHandleScopedInputEvent({
      sessionId: 'session-a',
      isFocusedPanel: false,
    })).toBe(false)
  })
})

const EMPTY_RECALL_STATE: RecallPromptArrowUpState = {
  key: 'ArrowUp',
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  isProcessing: true,
  input: '',
  attachmentCount: 0,
  loadingAttachmentCount: 0,
  followUpItemCount: 0,
  inlineMenuOpen: false,
  disabled: false,
  disableSend: false,
}

function canRecall(overrides: Partial<RecallPromptArrowUpState> = {}): boolean {
  return shouldRecallPromptOnArrowUp({ ...EMPTY_RECALL_STATE, ...overrides })
}

describe('shouldRecallPromptOnArrowUp', () => {
  it('allows plain Arrow Up only for a truly empty draft during processing', () => {
    expect(canRecall()).toBe(true)
    expect(canRecall({ isProcessing: false })).toBe(false)
    expect(canRecall({ key: 'ArrowDown' })).toBe(false)
  })

  it('preserves text and whitespace-only editing', () => {
    expect(canRecall({ input: 'draft' })).toBe(false)
    expect(canRecall({ input: '   ' })).toBe(false)
    expect(canRecall({ input: '\n' })).toBe(false)
  })

  it('preserves non-text draft content and loading attachments', () => {
    expect(canRecall({ attachmentCount: 1 })).toBe(false)
    expect(canRecall({ loadingAttachmentCount: 1 })).toBe(false)
    expect(canRecall({ followUpItemCount: 1 })).toBe(false)
  })

  it('does not steal keys from menus, IME, modifiers, or disabled input', () => {
    expect(canRecall({ inlineMenuOpen: true })).toBe(false)
    expect(canRecall({ isComposing: true })).toBe(false)
    expect(canRecall({ shiftKey: true })).toBe(false)
    expect(canRecall({ metaKey: true })).toBe(false)
    expect(canRecall({ ctrlKey: true })).toBe(false)
    expect(canRecall({ altKey: true })).toBe(false)
    expect(canRecall({ disabled: true })).toBe(false)
    expect(canRecall({ disableSend: true })).toBe(false)
  })
})

describe('shouldAutoFocusSessionComposer', () => {
  const desktop = { compactMode: false, touchOnly: false, overlayOpen: false, activeElement: null }
  const element = (tagName: string, isContentEditable = false, composer = false) => ({
    tagName, isContentEditable, matches: () => composer,
  })

  it('allows focus from a chat row or the previous composer', () => {
    expect(shouldAutoFocusSessionComposer(desktop)).toBe(true)
    expect(shouldAutoFocusSessionComposer({ ...desktop, activeElement: element('BUTTON') })).toBe(true)
    expect(shouldAutoFocusSessionComposer({ ...desktop, activeElement: element('DIV', true, true) })).toBe(true)
  })

  it('preserves a focused search field, rename field, or other editor', () => {
    for (const activeElement of [element('INPUT'), element('TEXTAREA'), element('DIV', true)]) {
      expect(shouldAutoFocusSessionComposer({ ...desktop, activeElement })).toBe(false)
    }
  })

  it('skips compact layouts, touch-only devices, and open overlays', () => {
    for (const blocked of [{ compactMode: true }, { touchOnly: true }, { overlayOpen: true }]) {
      expect(shouldAutoFocusSessionComposer({ ...desktop, ...blocked })).toBe(false)
    }
  })
})
