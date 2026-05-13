import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, render, waitFor } from '@testing-library/react'
import { Window } from 'happy-dom'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GitCommit, GitStatusEntry } from '../../../../shared/types'
import { gitPanelCacheAtomFamily, type GitPanelCache } from '@/atoms/git-panel-cache'
import { GitPanel, refreshGitPanelCache } from '../GitPanel'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function statusEntry(path: string, status: GitStatusEntry['status'] = 'modified'): GitStatusEntry {
  return { path, status }
}

function commit(message: string, hash = message.toLowerCase().replace(/\W+/g, '').padEnd(16, '0')): GitCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    message,
    author: 'Sherlock',
    date: '2026-05-13T00:00:00.000Z',
    filesChanged: [],
  }
}

function warmCache(statusEntries: GitStatusEntry[], commits: GitCommit[], error: string | null = null): GitPanelCache {
  return {
    hasLoaded: true,
    statusEntries,
    commits,
    error,
  }
}

function setElectronApiMock(api: Partial<typeof window.electronAPI>) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: api,
  })
}

function createGitRequestsByPath() {
  const statusByPath = new Map<string, Deferred<GitStatusEntry[]>>()
  const logByPath = new Map<string, Deferred<GitCommit[]>>()

  setElectronApiMock({
    getGitStatus: (workspacePath) => {
      const request = createDeferred<GitStatusEntry[]>()
      statusByPath.set(workspacePath, request)
      return request.promise
    },
    getGitLog: (workspacePath) => {
      const request = createDeferred<GitCommit[]>()
      logByPath.set(workspacePath, request)
      return request.promise
    },
  })

  return {
    statusFor(workspacePath: string) {
      const request = statusByPath.get(workspacePath)
      if (!request) throw new Error(`Expected git status request for ${workspacePath}`)
      return request
    },
    logFor(workspacePath: string) {
      const request = logByPath.get(workspacePath)
      if (!request) throw new Error(`Expected git log request for ${workspacePath}`)
      return request
    },
  }
}

function expectSpinner(container: HTMLElement, visible: boolean) {
  expect(container.getElementsByClassName('animate-spin').length > 0).toBe(visible)
}

function setupDom() {
  const window = new Window()
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    navigator: window.navigator,
  })
  Object.assign(window, {
    SyntaxError,
  })
}

beforeEach(() => {
  setupDom()
})

afterEach(() => {
  cleanup()
})

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
    const writes: GitPanelCache[] = []

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

describe('GitPanel cache behaviour', () => {
  it('shows a spinner for a cold cache, then renders fetched data without the spinner', async () => {
    const status = createDeferred<GitStatusEntry[]>()
    const log = createDeferred<GitCommit[]>()
    setElectronApiMock({
      getGitStatus: () => status.promise,
      getGitLog: () => log.promise,
    })

    const result = render(
      <Provider store={createStore()}>
        <GitPanel workspacePath="/repo" />
      </Provider>
    )
    const { container } = result

    expectSpinner(container, true)
    expect(result.queryByText('src/cold-cache.ts')).toBeNull()

    status.resolve([statusEntry('src/cold-cache.ts')])
    log.resolve([commit('Load cold cache')])

    await waitFor(() => expect(result.getByText('src/cold-cache.ts')).toBeTruthy())
    expect(result.getByText('Load cold cache')).toBeTruthy()
    expectSpinner(container, false)
  })

  it('renders warm cache data immediately without a spinner, then shows background refresh data', async () => {
    const store = createStore()
    store.set(
      gitPanelCacheAtomFamily('/repo'),
      warmCache([statusEntry('src/warm-cache.ts')], [commit('Warm cached commit')])
    )
    const status = createDeferred<GitStatusEntry[]>()
    const log = createDeferred<GitCommit[]>()
    setElectronApiMock({
      getGitStatus: () => status.promise,
      getGitLog: () => log.promise,
    })

    const result = render(
      <Provider store={store}>
        <GitPanel workspacePath="/repo" />
      </Provider>
    )
    const { container } = result

    expect(result.getByText('src/warm-cache.ts')).toBeTruthy()
    expect(result.getByText('Warm cached commit')).toBeTruthy()
    expectSpinner(container, false)

    status.resolve([statusEntry('src/refreshed-cache.ts', 'staged')])
    log.resolve([commit('Refreshed commit')])

    await waitFor(() => expect(result.getByText('src/refreshed-cache.ts')).toBeTruthy())
    expect(result.getByText('Refreshed commit')).toBeTruthy()
    expect(result.queryByText('src/warm-cache.ts')).toBeNull()
    expect(result.queryByText('Warm cached commit')).toBeNull()
  })

  it('shows a spinner and hides old cached data when the CWD root changes to a cold cache', async () => {
    const store = createStore()
    store.set(
      gitPanelCacheAtomFamily('/repo-a'),
      warmCache([statusEntry('src/old-root.ts')], [commit('Old root commit')])
    )
    const requests = createGitRequestsByPath()

    const result = render(
      <Provider store={store}>
        <GitPanel workspacePath="/repo-a" />
      </Provider>
    )
    const { container, rerender } = result

    expect(result.getByText('src/old-root.ts')).toBeTruthy()

    rerender(
      <Provider store={store}>
        <GitPanel workspacePath="/repo-b" />
      </Provider>
    )

    expectSpinner(container, true)
    expect(result.queryByText('src/old-root.ts')).toBeNull()
    expect(result.queryByText('Old root commit')).toBeNull()

    requests.statusFor('/repo-b').resolve([statusEntry('src/new-root.ts')])
    requests.logFor('/repo-b').resolve([commit('New root commit')])

    await waitFor(() => expect(result.getByText('src/new-root.ts')).toBeTruthy())
    expect(result.getByText('New root commit')).toBeTruthy()
    expectSpinner(container, false)
  })

  it('shows a background refresh error without blanking warm cached data', async () => {
    const store = createStore()
    store.set(
      gitPanelCacheAtomFamily('/repo'),
      warmCache([statusEntry('src/preserved.ts')], [commit('Preserved commit')])
    )
    const status = createDeferred<GitStatusEntry[]>()
    const log = createDeferred<GitCommit[]>()
    setElectronApiMock({
      getGitStatus: () => status.promise,
      getGitLog: () => log.promise,
    })

    const result = render(
      <Provider store={store}>
        <GitPanel workspacePath="/repo" />
      </Provider>
    )

    expect(result.getByText('src/preserved.ts')).toBeTruthy()
    expect(result.getByText('Preserved commit')).toBeTruthy()

    status.reject(new Error('Unable to refresh git data'))
    log.resolve([commit('Ignored commit')])

    await waitFor(() => expect(result.getByText('Unable to refresh git data')).toBeTruthy())
    expect(result.getByText('src/preserved.ts')).toBeTruthy()
    expect(result.getByText('Preserved commit')).toBeTruthy()
  })

  it('does not render stale results from a cancelled in-flight fetch after the CWD root changes', async () => {
    const requests = createGitRequestsByPath()
    const store = createStore()

    const result = render(
      <Provider store={store}>
        <GitPanel workspacePath="/repo-a" />
      </Provider>
    )
    const { rerender } = result

    rerender(
      <Provider store={store}>
        <GitPanel workspacePath="/repo-b" />
      </Provider>
    )

    requests.statusFor('/repo-a').resolve([statusEntry('src/stale-result.ts')])
    requests.logFor('/repo-a').resolve([commit('Stale commit')])

    await Promise.resolve()
    expect(result.queryByText('src/stale-result.ts')).toBeNull()
    expect(result.queryByText('Stale commit')).toBeNull()

    requests.statusFor('/repo-b').resolve([statusEntry('src/current-result.ts')])
    requests.logFor('/repo-b').resolve([commit('Current commit')])

    await waitFor(() => expect(result.getByText('src/current-result.ts')).toBeTruthy())
    expect(result.getByText('Current commit')).toBeTruthy()
    expect(result.queryByText('src/stale-result.ts')).toBeNull()
    expect(result.queryByText('Stale commit')).toBeNull()
  })
})
