import { describe, it, expect } from 'bun:test'
import { validateArchiveTarget } from './archive-guards.ts'

describe('validateArchiveTarget (archive_session guards)', () => {
  const WS = 'ws-1'
  const idle = { workspaceId: WS, isProcessing: false }
  const busy = { workspaceId: WS, isProcessing: true }

  it('allows archiving an idle session in the same workspace', () => {
    expect(validateArchiveTarget(idle, WS, 's-2', true)).toBeNull()
  })

  it('allows unarchiving an idle session in the same workspace', () => {
    expect(validateArchiveTarget(idle, WS, 's-2', false)).toBeNull()
  })

  it('rejects an unknown target', () => {
    expect(validateArchiveTarget(undefined, WS, 'ghost', true)).toContain('not found in this workspace')
  })

  it('rejects a cross-workspace target with the same opaque message as unknown', () => {
    const foreign = { workspaceId: 'ws-OTHER', isProcessing: false }
    const crossWs = validateArchiveTarget(foreign, WS, 's-3', true)
    const unknown = validateArchiveTarget(undefined, WS, 's-3', true)
    expect(crossWs).toContain('not found in this workspace')
    expect(crossWs).toBe(unknown)
  })

  it('rejects archiving a session that is mid-turn', () => {
    expect(validateArchiveTarget(busy, WS, 's-4', true)).toContain('processing a turn')
  })

  it('allows UNarchiving a session that is mid-turn', () => {
    // Unarchive only restores visibility — no reason to gate it on idleness.
    expect(validateArchiveTarget(busy, WS, 's-4', false)).toBeNull()
  })
})
