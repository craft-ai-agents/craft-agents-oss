import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadPiTurnAnchors,
  savePiTurnAnchor,
  copyPiTurnAnchorsForBranch,
} from './SessionManager.ts'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pi-turn-anchors-test-'))
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

const sessionDir = (name: string): string => {
  const p = join(tmpRoot, name)
  mkdirSync(p, { recursive: true })
  return p
}

describe('pi-turn-anchors sidecar', () => {
  it('savePiTurnAnchor then loadPiTurnAnchors round-trips', async () => {
    const session = sessionDir('s1')
    await savePiTurnAnchor(session, 'craft-msg-1', 'entry_pi_aaa')
    await savePiTurnAnchor(session, 'craft-msg-2', 'entry_pi_bbb')

    const index = await loadPiTurnAnchors(session)
    expect(index.version).toBe(1)
    expect(index.anchors).toEqual({
      'craft-msg-1': 'entry_pi_aaa',
      'craft-msg-2': 'entry_pi_bbb',
    })
  })

  it('savePiTurnAnchor is idempotent for the same value', async () => {
    const session = sessionDir('s2')
    await savePiTurnAnchor(session, 'craft-msg-1', 'entry_pi_aaa')
    await savePiTurnAnchor(session, 'craft-msg-1', 'entry_pi_aaa')
    const index = await loadPiTurnAnchors(session)
    expect(Object.keys(index.anchors)).toEqual(['craft-msg-1'])
  })

  it('savePiTurnAnchor overwrites when the anchor changes', async () => {
    const session = sessionDir('s3')
    await savePiTurnAnchor(session, 'craft-msg-1', 'entry_pi_old')
    await savePiTurnAnchor(session, 'craft-msg-1', 'entry_pi_new')
    const index = await loadPiTurnAnchors(session)
    expect(index.anchors['craft-msg-1']).toBe('entry_pi_new')
  })

  it('savePiTurnAnchor with empty arguments is a no-op', async () => {
    const session = sessionDir('s4')
    await savePiTurnAnchor(session, '', 'entry_pi_aaa')
    await savePiTurnAnchor(session, 'craft-msg-1', '')
    const index = await loadPiTurnAnchors(session)
    expect(index.anchors).toEqual({})
  })

  it('loadPiTurnAnchors tolerates a missing sidecar file', async () => {
    const session = sessionDir('s5')
    const index = await loadPiTurnAnchors(session)
    expect(index.anchors).toEqual({})
  })

  it('loadPiTurnAnchors tolerates a malformed sidecar file', async () => {
    const session = sessionDir('s6')
    mkdirSync(join(session, 'meta'), { recursive: true })
    writeFileSync(join(session, 'meta', 'pi-turn-anchors.json'), 'not json{')
    const index = await loadPiTurnAnchors(session)
    expect(index.anchors).toEqual({})
  })
})

describe('copyPiTurnAnchorsForBranch', () => {
  it('copies only anchors whose Craft message id is in the branch path', async () => {
    const src = sessionDir('source')
    const dst = sessionDir('branch')

    // Seed the source sidecar with 4 anchors.
    await savePiTurnAnchor(src, 'craft-msg-1', 'entry_pi_111')
    await savePiTurnAnchor(src, 'craft-msg-2', 'entry_pi_222')
    await savePiTurnAnchor(src, 'craft-msg-3', 'entry_pi_333')
    await savePiTurnAnchor(src, 'craft-msg-4', 'entry_pi_444')

    // Branch cutoff includes only craft-msg-1 and craft-msg-2.
    await copyPiTurnAnchorsForBranch(src, dst, ['craft-msg-1', 'craft-msg-2'])

    const branched = await loadPiTurnAnchors(dst)
    expect(branched.anchors).toEqual({
      'craft-msg-1': 'entry_pi_111',
      'craft-msg-2': 'entry_pi_222',
    })
  })

  it('does not write a file when the source has no anchors', async () => {
    const src = sessionDir('source-empty')
    const dst = sessionDir('branch-empty')
    await copyPiTurnAnchorsForBranch(src, dst, ['craft-msg-1'])
    expect(existsSync(join(dst, 'meta', 'pi-turn-anchors.json'))).toBe(false)
  })

  it('does not write a file when no source anchor matches the branched ids', async () => {
    const src = sessionDir('source-mismatch')
    const dst = sessionDir('branch-mismatch')
    await savePiTurnAnchor(src, 'craft-msg-99', 'entry_pi_xxx')
    await copyPiTurnAnchorsForBranch(src, dst, ['craft-msg-1'])
    expect(existsSync(join(dst, 'meta', 'pi-turn-anchors.json'))).toBe(false)
  })

  it('writes a sidecar in the documented v1 shape', async () => {
    const src = sessionDir('source-shape')
    const dst = sessionDir('branch-shape')
    await savePiTurnAnchor(src, 'craft-msg-1', 'entry_pi_111')
    await copyPiTurnAnchorsForBranch(src, dst, ['craft-msg-1'])

    const raw = readFileSync(join(dst, 'meta', 'pi-turn-anchors.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { version: number; anchors: Record<string, string> }
    expect(parsed.version).toBe(1)
    expect(parsed.anchors).toEqual({ 'craft-msg-1': 'entry_pi_111' })
  })
})
