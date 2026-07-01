import { describe, expect, test } from 'bun:test'
import { findArtistHQWorkspace, isArtistHQWorkspace } from './artist-workspace'

describe('artist workspace helpers', () => {
  test('recognizes the global artist HQ workspace', () => {
    const workspaces = [
      { id: 'song-1', name: 'Night Drive' },
      { id: 'hq', name: 'M' },
    ]

    expect(isArtistHQWorkspace(workspaces[1], workspaces)).toBe(true)
    expect(findArtistHQWorkspace(workspaces)?.id).toBe('hq')
  })

  test('leaves normal campaign workspaces campaign-scoped', () => {
    const workspaces = [
      { id: 'song-1', name: 'Night Drive' },
      { id: 'song-2', name: 'Album Rollout' },
    ]

    expect(isArtistHQWorkspace(workspaces[0], workspaces)).toBe(false)
    expect(findArtistHQWorkspace(workspaces)).toBeUndefined()
  })
})
