import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_VOICE_CONTEXT_SLUG = 'artist-voice'

export const ARTIST_VOICE_TARGET_AGENT_SLUGS = [
  'social-publisher',
  'trypost-agent',
  'content-genius',
  'video-director',
  'video-editor-agent',
  'ads-agent',
  'gaygent-master',
  'persona-agent',
  'branding-agent',
] as const

export interface ArtistVoice {
  version: 1
  summary?: string
  speakingStyle?: string
  vocabulary?: string
  avoid?: string
  captionExamples?: string
  postExamples?: string
  writingExcerpts?: string
  updatedAt: string
}

export type ArtistVoiceParseResult =
  | { ok: true; voice: ArtistVoice }
  | { ok: false; voice: ArtistVoice; error: string }

export function artistVoiceMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Voice',
    description: 'How the artist talks, writes captions, and wants social copy to sound.',
    routing: { mode: 'targeted', agents: [...ARTIST_VOICE_TARGET_AGENT_SLUGS] },
    enabled: true,
  }
}

export function emptyArtistVoice(): ArtistVoice {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
  }
}

export function parseArtistVoiceDocResult(doc: ContextDocDTO | undefined): ArtistVoiceParseResult {
  if (!doc?.body.trim()) return { ok: true, voice: emptyArtistVoice() }
  const json = extractJson(doc.body)
  if (!json) {
    return {
      ok: false,
      voice: emptyArtistVoice(),
      error: 'Artist Voice exists, but no JSON block could be read.',
    }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistVoice>
    if (parsed.version !== 1) {
      return {
        ok: false,
        voice: emptyArtistVoice(),
        error: 'Artist Voice JSON has an unsupported shape.',
      }
    }
    return {
      ok: true,
      voice: normalizeVoice(parsed),
    }
  } catch {
    return {
      ok: false,
      voice: emptyArtistVoice(),
      error: 'Artist Voice JSON is malformed.',
    }
  }
}

export function serializeArtistVoiceBody(voice: ArtistVoice): string {
  const normalized = normalizeVoice(voice)
  return [
    'This is the artist voice guide. Use it when drafting captions, posts, ads, replies, emails, scripts, hooks, and public-facing copy.',
    '',
    'Rules for agents:',
    '- Match the artist voice without copying examples verbatim unless the user asks.',
    '- Preserve meaning and platform fit, but keep the phrasing native to the artist.',
    '- Treat avoid-list items as hard constraints.',
    '',
    '```json',
    JSON.stringify(normalized, null, 2),
    '```',
  ].join('\n')
}

export function voiceCompletion(voice: ArtistVoice): number {
  const fields: Array<keyof ArtistVoice> = [
    'summary',
    'speakingStyle',
    'vocabulary',
    'avoid',
    'captionExamples',
    'postExamples',
    'writingExcerpts',
  ]
  const filled = fields.filter((field) => Boolean(clean(voice[field]))).length
  return Math.round((filled / fields.length) * 100)
}

function normalizeVoice(voice: Partial<ArtistVoice>): ArtistVoice {
  return {
    version: 1,
    summary: clean(voice.summary),
    speakingStyle: clean(voice.speakingStyle),
    vocabulary: clean(voice.vocabulary),
    avoid: clean(voice.avoid),
    captionExamples: clean(voice.captionExamples),
    postExamples: clean(voice.postExamples),
    writingExcerpts: clean(voice.writingExcerpts),
    updatedAt: new Date().toISOString(),
  }
}

function extractJson(body: string): string | null {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1]
  const firstBrace = body.indexOf('{')
  const lastBrace = body.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace <= firstBrace) return null
  return body.slice(firstBrace, lastBrace + 1)
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return trimmed || undefined
}
