import { describe, expect, it } from 'bun:test'
import type { ClipboardCopy, RawSelection } from '../protocol'
import { COPY_TIMEOUT_MS, METHOD_CLIPBOARD, readSelection } from '../read-selection'

const AX: RawSelection = {
  text: 'Move the review to Thursday',
  programName: 'com.apple.TextEdit',
  method: 11,
  posLevel: 3,
  startTop: { x: 10, y: 10 },
  startBottom: { x: 10, y: 30 },
  endTop: { x: 200, y: 10 },
  endBottom: { x: 200, y: 30 },
  mousePosStart: { x: 10, y: 20 },
  mousePosEnd: { x: 200, y: 20 },
}

const copied = (overrides: Partial<ClipboardCopy> = {}): ClipboardCopy => ({
  text: 'Who owns the onboarding copy?',
  pid: 42,
  bundleId: 'com.tinyspeck.slackmacgap',
  posted: true,
  copied: true,
  restored: true,
  ms: 31,
  ...overrides,
})

function readers(accessibility: RawSelection | null, copy: ClipboardCopy | null) {
  const calls: number[] = []
  return {
    calls,
    readers: {
      accessibility: () => accessibility,
      copy: copy ? (timeoutMs: number) => { calls.push(timeoutMs); return copy } : null,
      now: () => 0,
    },
  }
}

describe('readSelection', () => {
  it('takes what Accessibility reads, without a ⌘C', () => {
    const { readers: r, calls } = readers(AX, copied())
    expect(readSelection(r, { clipboardFallback: true })).toEqual({ selection: AX, latencyMs: 0, copy: null })
    expect(calls).toEqual([])
  })

  it('falls back to the ⌘C when Accessibility finds nothing or only whitespace', () => {
    for (const ax of [null, { ...AX, text: ' \n ' }]) {
      const { readers: r, calls } = readers(ax, copied())
      const result = readSelection(r, { clipboardFallback: true })
      expect(calls).toEqual([COPY_TIMEOUT_MS])
      expect(result.selection).toMatchObject({ text: 'Who owns the onboarding copy?', programName: 'com.tinyspeck.slackmacgap', method: METHOD_CLIPBOARD, posLevel: 0 })
      expect(result.copy).toEqual({ posted: true, copied: true, restored: true, ms: 31 })
    }
  })

  it('never passes off what was already on the clipboard: only a copy made just now counts', () => {
    // The app didn't copy (nothing selected): whatever the clipboard holds isn't read at all
    const nothing = readSelection(readers(null, copied({ copied: false, text: null })).readers, { clipboardFallback: true })
    expect(nothing.selection).toBeNull()
    expect(nothing.copy?.copied).toBe(false)
    // It copied something without plain text, or only whitespace
    expect(readSelection(readers(null, copied({ text: null })).readers, { clipboardFallback: true }).selection).toBeNull()
    expect(readSelection(readers(null, copied({ text: '  ' })).readers, { clipboardFallback: true }).selection).toBeNull()
  })

  it('gives the copied text no position on screen', () => {
    const { selection } = readSelection(readers(null, copied()).readers, { clipboardFallback: true })
    expect(selection?.startTop).toEqual({ x: -99999, y: -99999 })
    expect(selection?.mousePosEnd).toEqual({ x: -99999, y: -99999 })
  })

  it('reads Accessibility only when the fallback is off or the addon is missing', () => {
    const off = readers(null, copied())
    expect(readSelection(off.readers, { clipboardFallback: false })).toEqual({ selection: null, latencyMs: 0, copy: null })
    expect(off.calls).toEqual([])
    expect(readSelection(readers(null, null).readers, { clipboardFallback: true })).toEqual({ selection: null, latencyMs: 0, copy: null })
  })

  it('names no app when the copy could not tell which one', () => {
    const { selection } = readSelection(readers(null, copied({ bundleId: null })).readers, { clipboardFallback: true })
    expect(selection?.programName).toBe('')
  })
})
