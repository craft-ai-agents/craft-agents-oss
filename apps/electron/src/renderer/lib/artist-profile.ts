import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_PROFILE_CONTEXT_SLUG = 'artist-profile'

export interface ArtistProfile {
  version: 1
  artistName?: string
  aliases?: string
  bio?: string
  themes?: string
  sound?: string
  visualWorld?: string
  brandWords?: string
  audience?: string
  similarArtists?: string
  priorityMarkets?: string
  socialLinks?: string
  spotifyProfile?: string
  team?: string
  promoBudget?: string
  rules?: string
  updatedAt: string
}

export type ArtistProfileParseResult =
  | { ok: true; profile: ArtistProfile }
  | { ok: false; profile: ArtistProfile; error: string }

export function artistProfileMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Profile',
    description: 'Global artist identity, audience, brand, music, and operating context for workers.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function emptyArtistProfile(): ArtistProfile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
  }
}

export function parseArtistProfileDocResult(doc: ContextDocDTO | undefined): ArtistProfileParseResult {
  if (!doc?.body.trim()) return { ok: true, profile: emptyArtistProfile() }
  const json = extractJson(doc.body)
  if (!json) {
    return {
      ok: false,
      profile: emptyArtistProfile(),
      error: 'Artist Profile exists, but no JSON block could be read.',
    }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistProfile>
    if (parsed.version !== 1) {
      return {
        ok: false,
        profile: emptyArtistProfile(),
        error: 'Artist Profile JSON has an unsupported shape.',
      }
    }
    return {
      ok: true,
      profile: normalizeProfile(parsed),
    }
  } catch {
    return {
      ok: false,
      profile: emptyArtistProfile(),
      error: 'Artist Profile JSON is malformed.',
    }
  }
}

export function serializeArtistProfileBody(profile: ArtistProfile): string {
  const normalized = normalizeProfile(profile)
  return [
    'This is global artist profile context. Treat it as long-term creator context, not one-campaign context.',
    '',
    '```json',
    JSON.stringify(normalized, null, 2),
    '```',
  ].join('\n')
}

export function profileCompletion(profile: ArtistProfile): number {
  const fields: Array<keyof ArtistProfile> = [
    'artistName',
    'bio',
    'themes',
    'sound',
    'visualWorld',
    'brandWords',
    'audience',
    'similarArtists',
    'priorityMarkets',
    'socialLinks',
    'spotifyProfile',
    'promoBudget',
    'rules',
  ]
  const filled = fields.filter((field) => Boolean(clean(profile[field]))).length
  return Math.round((filled / fields.length) * 100)
}

function normalizeProfile(profile: Partial<ArtistProfile>): ArtistProfile {
  return {
    version: 1,
    artistName: clean(profile.artistName),
    aliases: clean(profile.aliases),
    bio: clean(profile.bio),
    themes: clean(profile.themes),
    sound: clean(profile.sound),
    visualWorld: clean(profile.visualWorld),
    brandWords: clean(profile.brandWords),
    audience: clean(profile.audience),
    similarArtists: clean(profile.similarArtists),
    priorityMarkets: clean(profile.priorityMarkets),
    socialLinks: clean(profile.socialLinks),
    spotifyProfile: clean(profile.spotifyProfile),
    team: clean(profile.team),
    promoBudget: clean(profile.promoBudget),
    rules: clean(profile.rules),
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
