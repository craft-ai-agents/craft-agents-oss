import { describe, expect, test } from 'bun:test'
import type { ContextDocDTO } from '../../shared/types'
import { parseArtistSpotifySnapshotDocResult } from './artist-spotify'

function makeDoc(body: string): ContextDocDTO {
  return {
    slug: 'artist-spotify-snapshot',
    metadata: {
      name: 'Artist Spotify Snapshot',
      routing: { mode: 'broadcast' },
      enabled: true,
    },
    body,
    path: '/tmp/context/artist-spotify-snapshot',
    workspaceRootPath: '/tmp',
  } as ContextDocDTO
}

describe('parseArtistSpotifySnapshotDocResult', () => {
  test('parses public Spotify Web API snapshots', () => {
    const result = parseArtistSpotifySnapshotDocResult(makeDoc([
      '```json',
      JSON.stringify({
        version: 1,
        dataSource: 'spotify-web-api',
        snapshotDate: '2026-06-30',
        windowDays: 0,
        artist: {
          name: 'Test Artist',
          spotifyArtistId: 'abc123',
          spotifyUrl: 'https://open.spotify.com/artist/abc123',
          genres: ['alt pop'],
        },
        metrics: {
          followers: 1200,
          popularity: 42,
        },
        tracks: [{ id: 'track1', name: 'Lead Song', popularity: 55 }],
      }),
      '```',
    ].join('\n')))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot?.dataSource).toBe('spotify-web-api')
    expect(result.snapshot?.metrics.followers).toBe(1200)
    expect(result.snapshot?.metrics.popularity).toBe(42)
    expect(result.snapshot?.artist.genres).toEqual(['alt pop'])
    expect(result.snapshot?.tracks?.[0]?.name).toBe('Lead Song')
  })
})
