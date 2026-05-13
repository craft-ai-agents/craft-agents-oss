import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import { gitPanelCacheAtomFamily } from '../git-panel-cache'

describe('git panel cache atoms', () => {
  it('starts each CWD root with empty git panel data', () => {
    const store = createStore()

    expect(store.get(gitPanelCacheAtomFamily('/repo'))).toEqual({
      statusEntries: [],
      commits: [],
      error: null,
    })
  })

  it('keeps cache entries isolated by CWD root', () => {
    const store = createStore()

    store.set(gitPanelCacheAtomFamily('/repo-a'), {
      statusEntries: [{ path: 'src/index.ts', status: 'modified' }],
      commits: [],
      error: 'Unable to load git data',
    })

    expect(store.get(gitPanelCacheAtomFamily('/repo-a'))).toEqual({
      statusEntries: [{ path: 'src/index.ts', status: 'modified' }],
      commits: [],
      error: 'Unable to load git data',
    })
    expect(store.get(gitPanelCacheAtomFamily('/repo-b'))).toEqual({
      statusEntries: [],
      commits: [],
      error: null,
    })
  })

  it('always resolves an empty CWD root to the zero value', () => {
    const store = createStore()

    store.set(gitPanelCacheAtomFamily(''), {
      statusEntries: [{ path: 'README.md', status: 'staged' }],
      commits: [
        {
          hash: 'abcdef1234567890',
          shortHash: 'abcdef1',
          message: 'Add git cache',
          author: 'Sherlock',
          date: '2026-05-13T00:00:00.000Z',
          filesChanged: [],
        },
      ],
      error: 'Should be ignored',
    })

    expect(store.get(gitPanelCacheAtomFamily(''))).toEqual({
      statusEntries: [],
      commits: [],
      error: null,
    })
  })
})
