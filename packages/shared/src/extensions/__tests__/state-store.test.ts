import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ExtensionStateStore,
  getExtensionStateStore,
  resetExtensionStateStoreCache,
} from '../state-store.ts'

describe('ExtensionStateStore', () => {
  const dirs: string[] = []
  afterEach(() => {
    resetExtensionStateStoreCache()
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0
  })

  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'ext-state-'))
    dirs.push(d)
    return d
  }

  it('defaults missing ids to enabled', () => {
    const store = new ExtensionStateStore({ configDir: tmp() })
    expect(store.isEnabled('skill:ws:a')).toBe(true)
    expect(store.getState().enabled).toEqual({})
  })

  it('persists enable/disable across reload', () => {
    const dir = tmp()
    const a = new ExtensionStateStore({ configDir: dir })
    a.setEnabled('skill:ws:a', false)
    a.setEnabled('marketplace:demo', true)

    const raw = readFileSync(join(dir, 'extensions', 'state.json'), 'utf8')
    expect(raw).toContain('skill:ws:a')
    expect(JSON.parse(raw).enabled['skill:ws:a']).toBe(false)

    const b = new ExtensionStateStore({ configDir: dir })
    expect(b.isEnabled('skill:ws:a')).toBe(false)
    expect(b.isEnabled('marketplace:demo')).toBe(true)
  })

  it('singleton cache is keyed by configDir', () => {
    const dir = tmp()
    const s1 = getExtensionStateStore(dir)
    const s2 = getExtensionStateStore(dir)
    expect(s1).toBe(s2)
    s1.setEnabled('x', false)
    expect(s2.isEnabled('x')).toBe(false)
  })
})
