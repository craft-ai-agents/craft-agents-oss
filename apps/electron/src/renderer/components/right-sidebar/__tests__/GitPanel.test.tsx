import { describe, expect, it } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GitCommit, GitStatusEntry } from '../../../../shared/types'
import { gitPanelCacheAtomFamily } from '@/atoms/git-panel-cache'
import { GitPanel, refreshGitPanelCache } from '../GitPanel'

describe('GitPanel empty states', () => {
  it('renders a no working directory empty state when no workspace path is provided', () => {
    const markup = renderToStaticMarkup(<GitPanel />)

    expect(markup).toContain('No working directory set')
  })

  it('renders cached git data immediately for a warm workspace cache', () => {
    const store = createStore()
    store.set(gitPanelCacheAtomFamily('/repo'), {
      hasLoaded: true,
      statusEntries: [{ path: 'src/index.ts', status: 'modified' }],
      commits: [
        {
          hash: 'abcdef1234567890',
          shortHash: 'abcdef1',
          message: 'Wire git cache',
          author: 'Sherlock',
          date: '2026-05-13T00:00:00.000Z',
          filesChanged: [],
        },
      ],
      error: null,
    })

    const markup = renderToStaticMarkup(
      <Provider store={store}>
        <GitPanel workspacePath="/repo" />
      </Provider>
    )

    expect(markup).toContain('src/index.ts')
    expect(markup).toContain('Wire git cache')
    expect(markup).not.toContain('animate-spin')
  })

  it('keeps cached git data visible with a refresh error', () => {
    const store = createStore()
    store.set(gitPanelCacheAtomFamily('/repo'), {
      hasLoaded: true,
      statusEntries: [{ path: 'src/index.ts', status: 'modified' }],
      commits: [],
      error: 'Unable to refresh git data',
    })

    const markup = renderToStaticMarkup(
      <Provider store={store}>
        <GitPanel workspacePath="/repo" />
      </Provider>
    )

    expect(markup).toContain('src/index.ts')
    expect(markup).toContain('Unable to refresh git data')
  })

  it('preserves cached data when a warm background refresh fails', async () => {
    const statusEntries: GitStatusEntry[] = [{ path: 'src/index.ts', status: 'modified' }]
    const commits: GitCommit[] = [
      {
        hash: 'abcdef1234567890',
        shortHash: 'abcdef1',
        message: 'Wire git cache',
        author: 'Sherlock',
        date: '2026-05-13T00:00:00.000Z',
        filesChanged: [],
      },
    ]
    const loadingStates: boolean[] = []
    const refreshingStates: boolean[] = []
    const writes: Parameters<Parameters<typeof refreshGitPanelCache>[0]['setCache']>[0][] = []

    await refreshGitPanelCache({
      workspacePath: '/repo',
      cached: {
        hasLoaded: true,
        statusEntries,
        commits,
        error: null,
      },
      api: {
        getGitStatus: async () => {
          throw new Error('Unable to refresh git data')
        },
        getGitLog: async () => [],
      },
      setCache: (next) => writes.push(next),
      setIsLoading: (next) => loadingStates.push(next),
      setIsRefreshing: (next) => refreshingStates.push(next),
      isCancelled: () => false,
    })

    expect(loadingStates).toEqual([false, false])
    expect(refreshingStates).toEqual([true, false])
    expect(writes).toEqual([{
      hasLoaded: true,
      statusEntries,
      commits,
      error: 'Unable to refresh git data',
    }])
  })
})
