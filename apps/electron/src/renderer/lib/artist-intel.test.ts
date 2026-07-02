import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_ARTIST_INTEL_SOURCES,
  artistIntelConfigMetadata,
  createIntelRunPrompt,
  emptyArtistIntelConfig,
  parseArtistIntelConfigDocResult,
  serializeArtistIntelConfigBody,
} from './artist-intel'

function makeDoc(body: string) {
  return {
    slug: 'artist-intel-config',
    metadata: artistIntelConfigMetadata(),
    body,
    path: '/tmp/context/artist-intel-config',
    workspaceRootPath: '/tmp/workspace',
  }
}

describe('artist-intel', () => {
  test('seeds the old artist-management YouTube channels', () => {
    const config = emptyArtistIntelConfig()
    expect(config.enabled).toBe(false)
    expect(config.sources.map((source) => source.name)).toEqual([
      'Managers Playbook',
      'Viral VSN',
      'No Labels Necessary',
      'Neighborhood Art Supply',
    ])
  })

  test('round-trips config through a context doc body', () => {
    const config = {
      ...emptyArtistIntelConfig(),
      enabled: true,
      maxPerChannel: 4,
      sinceDays: 10,
      sources: DEFAULT_ARTIST_INTEL_SOURCES.slice(0, 2),
    }

    const result = parseArtistIntelConfigDocResult(makeDoc(serializeArtistIntelConfigBody(config)))

    expect(result.ok).toBe(true)
    expect(result.config.enabled).toBe(true)
    expect(result.config.maxPerChannel).toBe(4)
    expect(result.config.sinceDays).toBe(10)
    expect(result.config.sources).toHaveLength(2)
  })

  test('builds a bounded run prompt with configured channels', () => {
    const prompt = createIntelRunPrompt(emptyArtistIntelConfig(), 'Artist HQ')

    expect(prompt).toContain('Run the HQ YouTube Intel Pulse')
    expect(prompt).toContain('Managers Playbook')
    expect(prompt).toContain('No Labels Necessary')
    expect(prompt).toContain('Do not publish, comment, upload')
  })
})
