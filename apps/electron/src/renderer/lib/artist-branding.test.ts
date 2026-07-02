import type { ContextDocDTO } from '../../shared/types'
import { describe, expect, test } from 'bun:test'
import {
  ARTIST_BRANDING_CONTEXT_SLUG,
  artistBrandingMetadata,
  brandingCompletion,
  parseArtistBrandingDocResult,
  serializeArtistBrandingBody,
  type ArtistBranding,
} from './artist-branding'

function makeDoc(body: string): ContextDocDTO {
  return {
    slug: ARTIST_BRANDING_CONTEXT_SLUG,
    metadata: artistBrandingMetadata(),
    body,
    path: '',
    workspaceRootPath: '',
    parseWarnings: [],
  }
}

describe('artist branding context', () => {
  test('broadcasts branding context for future brand workers', () => {
    expect(artistBrandingMetadata().routing).toEqual({ mode: 'broadcast' })
  })

  test('round-trips the branding JSON body', () => {
    const branding: ArtistBranding = {
      version: 1,
      creativeDna: 'Southern gothic, chrome textures, gospel harmonies.',
      tensions: 'spiritual x reckless',
      mythology: 'Motels, rain, satellites.',
      updatedAt: '2026-07-02T00:00:00.000Z',
    }
    const parsed = parseArtistBrandingDocResult(makeDoc(serializeArtistBrandingBody(branding)))
    expect(parsed.ok).toBe(true)
    expect(parsed.branding.creativeDna).toContain('Southern gothic')
    expect(parsed.branding.tensions).toBe('spiritual x reckless')
    expect(parsed.branding.mythology).toContain('satellites')
  })

  test('scores core brand fields', () => {
    expect(brandingCompletion({
      version: 1,
      creativeDna: 'films, fashion, places',
      mythology: 'rain',
      updatedAt: '2026-07-02T00:00:00.000Z',
    })).toBe(29)
  })
})
