import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_BRANDING_CONTEXT_SLUG = 'artist-branding'

export interface ArtistBranding {
  version: 1
  creativeDna?: string
  tensions?: string
  fascinations?: string
  reactionHooks?: string
  mythology?: string
  emotionalTerritory?: string
  audienceGravity?: string
  notes?: string
  updatedAt: string
}

export type ArtistBrandingParseResult =
  | { ok: true; branding: ArtistBranding }
  | { ok: false; branding: ArtistBranding; error: string }

export function artistBrandingMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Branding',
    description: 'Brand DNA, creative gravity, mythology, tensions, and audience psychology for branding workers.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function emptyArtistBranding(): ArtistBranding {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
  }
}

export function parseArtistBrandingDocResult(doc: ContextDocDTO | undefined): ArtistBrandingParseResult {
  if (!doc?.body.trim()) return { ok: true, branding: emptyArtistBranding() }
  const json = extractJson(doc.body)
  if (!json) {
    return {
      ok: false,
      branding: emptyArtistBranding(),
      error: 'Artist Branding exists, but no JSON block could be read.',
    }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistBranding>
    if (parsed.version !== 1) {
      return {
        ok: false,
        branding: emptyArtistBranding(),
        error: 'Artist Branding JSON has an unsupported shape.',
      }
    }
    return {
      ok: true,
      branding: normalizeBranding(parsed),
    }
  } catch {
    return {
      ok: false,
      branding: emptyArtistBranding(),
      error: 'Artist Branding JSON is malformed.',
    }
  }
}

export function serializeArtistBrandingBody(branding: ArtistBranding): string {
  const normalized = normalizeBranding(branding)
  return [
    'This is the artist branding guide. Use it when shaping positioning, narrative, creative direction, visuals, campaigns, hooks, content angles, and artist mythology.',
    '',
    'Rules for agents:',
    '- Treat this as brand gravity, not a questionnaire.',
    '- Preserve contradictions, fascinations, symbols, and emotional territory when creating brand work.',
    '- Use Profile and Voice context with this guide when drafting public-facing output.',
    '',
    '```json',
    JSON.stringify(normalized, null, 2),
    '```',
  ].join('\n')
}

export function brandingCompletion(branding: ArtistBranding): number {
  const fields: Array<keyof ArtistBranding> = [
    'creativeDna',
    'tensions',
    'fascinations',
    'reactionHooks',
    'mythology',
    'emotionalTerritory',
    'audienceGravity',
  ]
  const filled = fields.filter((field) => Boolean(clean(branding[field]))).length
  return Math.round((filled / fields.length) * 100)
}

function normalizeBranding(branding: Partial<ArtistBranding>): ArtistBranding {
  return {
    version: 1,
    creativeDna: clean(branding.creativeDna),
    tensions: clean(branding.tensions),
    fascinations: clean(branding.fascinations),
    reactionHooks: clean(branding.reactionHooks),
    mythology: clean(branding.mythology),
    emotionalTerritory: clean(branding.emotionalTerritory),
    audienceGravity: clean(branding.audienceGravity),
    notes: clean(branding.notes),
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
