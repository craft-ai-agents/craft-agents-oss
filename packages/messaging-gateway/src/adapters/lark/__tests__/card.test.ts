/**
 * Lark interactive-card builder tests.
 *
 * Schema 2.0 layout, label truncation, button cap, and the cleared-card
 * shape used by `clearButtons`.
 */
import { describe, expect, it } from 'bun:test'
import {
  buildLarkCard,
  buildClearedCard,
  isLarkEditExpiredError,
  LARK_MAX_BUTTONS,
  LARK_MAX_LABEL_LENGTH,
} from '../card'
import type { InlineButton } from '../../../types'

describe('buildLarkCard', () => {
  const messageId = 'msg-abc-123'

  it('wraps elements under `body` (schema 2.0 envelope)', () => {
    // Regression guard: top-level `elements` is rejected with code 200621
    // ("unknown property, property: elements") on Lark schema 2.0 — the
    // payload must nest elements under `body`. This test locks the wrapper.
    const card = buildLarkCard('hi', [{ id: 'a', label: 'A' }], { messageId })
    expect(card.body).toBeTruthy()
    expect(Array.isArray(card.body.elements)).toBe(true)
    expect((card as unknown as { elements?: unknown }).elements).toBeUndefined()
  })

  it('produces schema 2.0 with text body + button elements (no `action` wrapper)', () => {
    const buttons: InlineButton[] = [
      { id: 'accept', label: 'Accept' },
      { id: 'reject', label: 'Reject' },
    ]
    const card = buildLarkCard('Plan ready. Approve?', buttons, { messageId })
    expect(card.schema).toBe('2.0')
    // 1 text element + N button elements (no `action` wrapper in 2.0)
    expect(card.body.elements.length).toBe(3)
    expect(card.body.elements[0]!.tag).toBe('div')
    expect(card.body.elements[1]!.tag).toBe('button')
    expect(card.body.elements[2]!.tag).toBe('button')

    const first = card.body.elements[1]!
    if (first.tag === 'button') {
      expect(first.text.content).toBe('Accept')
      expect(first.type).toBe('primary')
      expect(first.behaviors[0]!.type).toBe('callback')
      expect(first.behaviors[0]!.value.buttonId).toBe('accept')
      expect(first.behaviors[0]!.value.messageId).toBe(messageId)
    }
    const second = card.body.elements[2]!
    if (second.tag === 'button') {
      expect(second.type).toBe('default')
    }
  })

  it('rejects the legacy `action` wrapper at the type level (schema-V2 regression guard)', () => {
    // Lark rejects `tag: 'action'` under schema 2.0 with code 200861. The
    // type system enforces this — `body.elements` only allows `div` and
    // `button` tags, never `action`.
    const card = buildLarkCard('hi', [{ id: 'a', label: 'A' }], { messageId })
    for (const el of card.body.elements) {
      expect(el.tag).not.toBe('action')
    }
  })

  it('truncates labels longer than LARK_MAX_LABEL_LENGTH', () => {
    const longLabel = 'a'.repeat(LARK_MAX_LABEL_LENGTH + 5)
    const buttons: InlineButton[] = [{ id: 'x', label: longLabel }]
    const card = buildLarkCard('hi', buttons, { messageId })
    const btn = card.body.elements[1]!
    if (btn.tag === 'button') {
      expect(btn.text.content.length).toBe(LARK_MAX_LABEL_LENGTH)
      expect(btn.text.content.endsWith('…')).toBe(true)
    }
  })

  it('caps button count at LARK_MAX_BUTTONS', () => {
    const buttons: InlineButton[] = Array.from({ length: LARK_MAX_BUTTONS + 5 }, (_, i) => ({
      id: `b${i}`,
      label: `Btn ${i}`,
    }))
    const card = buildLarkCard('hi', buttons, { messageId })
    // 1 text element + LARK_MAX_BUTTONS button elements
    expect(card.body.elements.length).toBe(1 + LARK_MAX_BUTTONS)
  })

  it('forwards button.data into the behaviors[].value payload when set', () => {
    const buttons: InlineButton[] = [{ id: 'x', label: 'X', data: 'extra-payload' }]
    const card = buildLarkCard('hi', buttons, { messageId })
    const btn = card.body.elements[1]!
    if (btn.tag === 'button') {
      expect(btn.behaviors[0]!.value.data).toBe('extra-payload')
    }
  })
})

describe('buildClearedCard', () => {
  it('drops the action row, keeps only the text body, still under body', () => {
    const card = buildClearedCard('Done.')
    expect(card.body.elements.length).toBe(1)
    expect(card.body.elements[0]!.tag).toBe('div')
    expect((card as unknown as { elements?: unknown }).elements).toBeUndefined()
  })
})

describe('isLarkEditExpiredError', () => {
  it('matches the documented edit-expired error codes', () => {
    expect(isLarkEditExpiredError({ code: 230003 })).toBe(true)
    expect(isLarkEditExpiredError({ code: 234001 })).toBe(true)
    expect(isLarkEditExpiredError({ response: { code: 230003 } })).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isLarkEditExpiredError({ code: 99999 })).toBe(false)
    expect(isLarkEditExpiredError(new Error('network'))).toBe(false)
    expect(isLarkEditExpiredError(null)).toBe(false)
    expect(isLarkEditExpiredError(undefined)).toBe(false)
  })
})
