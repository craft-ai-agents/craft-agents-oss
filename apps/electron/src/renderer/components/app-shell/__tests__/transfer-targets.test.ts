import { describe, expect, it } from 'bun:test'
import type { Workspace } from '../../../../shared/types'
import { getTransferTargets, hasTransferTargets } from '../transfer-targets'

function ws(id: string, remote = false): Workspace {
  return {
    id,
    name: id,
    ...(remote ? { remoteServer: { url: 'wss://example.test:9100', token: 't' } } : {}),
  } as unknown as Workspace
}

describe('getTransferTargets', () => {
  it('offers every workspace except the active one, local and remote alike', () => {
    const all = [ws('local-a'), ws('local-b'), ws('remote-a', true)]

    const targets = getTransferTargets(all, 'local-a')

    expect(targets.map(w => w.id)).toEqual(['local-b', 'remote-a'])
  })

  it('includes local workspaces when the active workspace is remote (remote → local send)', () => {
    const all = [ws('local-a'), ws('remote-a', true)]

    const targets = getTransferTargets(all, 'remote-a')

    expect(targets.map(w => w.id)).toEqual(['local-a'])
  })

  it('offers everything when no active workspace is known', () => {
    const all = [ws('local-a'), ws('remote-a', true)]

    expect(getTransferTargets(all, null)).toHaveLength(2)
  })
})

describe('hasTransferTargets', () => {
  it('is false with a single (active-only) workspace', () => {
    expect(hasTransferTargets([ws('local-a')])).toBe(false)
  })

  it('is true with two local workspaces — no remote required', () => {
    expect(hasTransferTargets([ws('local-a'), ws('local-b')])).toBe(true)
  })

  it('handles missing workspace lists', () => {
    expect(hasTransferTargets(undefined)).toBe(false)
    expect(hasTransferTargets(null)).toBe(false)
    expect(hasTransferTargets([])).toBe(false)
  })
})
