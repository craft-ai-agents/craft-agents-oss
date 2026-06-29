import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_NETWORK_CONTEXT_SLUG = 'artist-network'

export type ArtistNetworkCategory =
  | 'key'
  | 'music'
  | 'collaborators'
  | 'djs'
  | 'producers'
  | 'press'
  | 'playlist-curators'
  | 'influencers'
  | 'design'
  | 'video'
  | 'venues'
  | 'brands'
  | 'fans-vips'
  | 'other'

export interface ArtistNetworkPerson {
  id: string
  name: string
  category: ArtistNetworkCategory
  role?: string
  contact?: string
  socials?: string
  location?: string
  relationship?: 'new' | 'warm' | 'strong' | 'vip'
  lastTouch?: string
  canHelpWith?: string
  tags: string[]
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface ArtistNetwork {
  version: 1
  people: ArtistNetworkPerson[]
  updatedAt: string
}

export const NETWORK_CATEGORIES: Array<{ id: ArtistNetworkCategory; label: string }> = [
  { id: 'key', label: 'Key' },
  { id: 'music', label: 'Music' },
  { id: 'collaborators', label: 'Collaborators' },
  { id: 'djs', label: 'DJs' },
  { id: 'producers', label: 'Producers' },
  { id: 'press', label: 'Press' },
  { id: 'playlist-curators', label: 'Playlist Curators' },
  { id: 'influencers', label: 'Influencers' },
  { id: 'design', label: 'Design' },
  { id: 'video', label: 'Video' },
  { id: 'venues', label: 'Venues' },
  { id: 'brands', label: 'Brands' },
  { id: 'fans-vips', label: 'Fans / VIPs' },
  { id: 'other', label: 'Other' },
]

export function artistNetworkMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Network',
    description: 'Global people, contacts, and relationship context for the artist.',
    routing: { mode: 'broadcast' },
    enabled: true,
  }
}

export function emptyArtistNetwork(): ArtistNetwork {
  return {
    version: 1,
    people: [],
    updatedAt: new Date().toISOString(),
  }
}

export function parseArtistNetworkDoc(doc: ContextDocDTO | undefined): ArtistNetwork {
  if (!doc?.body.trim()) return emptyArtistNetwork()
  const json = extractJson(doc.body)
  if (!json) return emptyArtistNetwork()
  try {
    const parsed = JSON.parse(json) as Partial<ArtistNetwork>
    if (parsed.version !== 1 || !Array.isArray(parsed.people)) return emptyArtistNetwork()
    return {
      version: 1,
      people: parsed.people.filter(isPerson),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return emptyArtistNetwork()
  }
}

export function serializeArtistNetworkBody(network: ArtistNetwork): string {
  const sorted = {
    ...network,
    people: [...network.people].sort((a, b) => a.name.localeCompare(b.name)),
    updatedAt: new Date().toISOString(),
  }
  return [
    'This is global artist relationship context. Treat it as long-term creator context, not one-campaign context.',
    '',
    '```json',
    JSON.stringify(sorted, null, 2),
    '```',
  ].join('\n')
}

export function createNetworkPerson(input: {
  name: string
  category: ArtistNetworkCategory
  role?: string
  contact?: string
  notes?: string
}): ArtistNetworkPerson {
  const now = new Date().toISOString()
  return {
    id: `person-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim(),
    category: input.category,
    role: clean(input.role),
    contact: clean(input.contact),
    notes: clean(input.notes),
    relationship: 'new',
    tags: [],
    createdAt: now,
    updatedAt: now,
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

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  return trimmed || undefined
}

function isPerson(value: unknown): value is ArtistNetworkPerson {
  const candidate = value as Partial<ArtistNetworkPerson>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    NETWORK_CATEGORIES.some((category) => category.id === candidate.category) &&
    Array.isArray(candidate.tags)
  )
}
