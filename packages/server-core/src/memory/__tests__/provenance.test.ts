import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it } from 'bun:test'
import { getProvenancePath, readProvenance, writeProvenance } from '../provenance'

const tmpRoots: string[] = []

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'provenance-'))
  tmpRoots.push(root)
  return root
}

afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop()!, { recursive: true, force: true })
})

describe('memory provenance (F4)', () => {
  it('write/read round-trips lessons, skills and ts', () => {
    const root = tmpRoot()
    const written = writeProvenance(root, 's1', {
      lessons: [
        { rule: 'global rule', scope: 'global' },
        { rule: 'ws rule', scope: 'workspace' },
      ],
      skills: ['sweep-thing'],
    })
    expect(written.ts).toBeTruthy()
    // File lands at {workspace}/sessions/{id}/meta/provenance.json.
    expect(getProvenancePath(root, 's1')).toBe(join(root, 'sessions', 's1', 'meta', 'provenance.json'))
    const disk = JSON.parse(readFileSync(getProvenancePath(root, 's1'), 'utf-8'))
    expect(disk.lessons).toHaveLength(2)
    expect(disk.skills).toEqual(['sweep-thing'])

    const read = readProvenance(root, 's1')
    expect(read).toEqual({
      lessons: [
        { rule: 'global rule', scope: 'global' },
        { rule: 'ws rule', scope: 'workspace' },
      ],
      skills: ['sweep-thing'],
      ts: written.ts,
    })
  })

  it('overwrites the record on the next write (last assembly wins)', () => {
    const root = tmpRoot()
    writeProvenance(root, 's1', { lessons: [{ rule: 'old', scope: 'global' }], skills: [] })
    writeProvenance(root, 's1', { lessons: [{ rule: 'new', scope: 'workspace' }], skills: ['k'] })
    expect(readProvenance(root, 's1')).toEqual({
      lessons: [{ rule: 'new', scope: 'workspace' }],
      skills: ['k'],
      ts: expect.any(String),
    })
  })

  it('returns null when the record is absent', () => {
    const root = tmpRoot()
    expect(readProvenance(root, 'never-created')).toBeNull()
  })

  it('returns null on a corrupt file instead of throwing', () => {
    const root = tmpRoot()
    const path = getProvenancePath(root, 's2')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{not json', 'utf-8')
    expect(readProvenance(root, 's2')).toBeNull()
  })

  it('returns null on a structurally invalid record', () => {
    const root = tmpRoot()
    const path = getProvenancePath(root, 's3')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ lessons: 'oops', skills: [] }), 'utf-8')
    expect(readProvenance(root, 's3')).toBeNull()
  })

  it('drops malformed lesson/skill entries but keeps the valid ones', () => {
    const root = tmpRoot()
    const path = getProvenancePath(root, 's4')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({
        lessons: [{ rule: 'ok', scope: 'global' }, { rule: 42, scope: 'global' }, { rule: 'x', scope: 'nope' }],
        skills: ['a', 7],
        ts: '2026-08-06T00:00:00Z',
      }),
      'utf-8',
    )
    expect(readProvenance(root, 's4')).toEqual({
      lessons: [{ rule: 'ok', scope: 'global' }],
      skills: ['a'],
      ts: '2026-08-06T00:00:00Z',
    })
  })
})
