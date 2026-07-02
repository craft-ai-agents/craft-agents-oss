import type { ContextDocDTO } from '../../shared/types'
import { describe, expect, test } from 'bun:test'
import {
  ARTIST_VOICE_CONTEXT_SLUG,
  artistVoiceMetadata,
  parseArtistVoiceDocResult,
  serializeArtistVoiceBody,
  type ArtistVoice,
} from './artist-voice'

function makeDoc(body: string): ContextDocDTO {
  return {
    slug: ARTIST_VOICE_CONTEXT_SLUG,
    metadata: artistVoiceMetadata(),
    body,
    path: '',
    workspaceRootPath: '',
    parseWarnings: [],
  }
}

describe('artist voice context', () => {
  test('routes voice context to social/content workers', () => {
    const metadata = artistVoiceMetadata()
    expect(metadata.routing).toEqual({
      mode: 'targeted',
      agents: expect.arrayContaining(['social-publisher', 'trypost-agent', 'content-genius']),
    })
  })

  test('round-trips the voice JSON body', () => {
    const voice: ArtistVoice = {
      version: 1,
      summary: 'Plainspoken, dry, and sharp.',
      captionExamples: 'not everything needs a rollout. some things just need to land.',
      updatedAt: '2026-07-02T00:00:00.000Z',
    }
    const parsed = parseArtistVoiceDocResult(makeDoc(serializeArtistVoiceBody(voice)))
    expect(parsed.ok).toBe(true)
    expect(parsed.voice.summary).toBe('Plainspoken, dry, and sharp.')
    expect(parsed.voice.captionExamples).toContain('rollout')
  })
})
