import type { ContextDocDTO, ContextDocMetadata } from '../../shared/types'

export const ARTIST_NETWORK_CONTEXT_SLUG = 'artist-network'

export type ArtistNetworkCategory = string

export interface ArtistNetworkCategoryDefinition {
  id: ArtistNetworkCategory
  label: string
}

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
  categories: ArtistNetworkCategoryDefinition[]
  people: ArtistNetworkPerson[]
  updatedAt: string
}

export type ArtistNetworkParseResult =
  | { ok: true; network: ArtistNetwork }
  | { ok: false; network: ArtistNetwork; error: string }

export const NETWORK_CATEGORIES: ArtistNetworkCategoryDefinition[] = [
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
    categories: NETWORK_CATEGORIES,
    people: [],
    updatedAt: new Date().toISOString(),
  }
}

export function parseArtistNetworkDoc(doc: ContextDocDTO | undefined): ArtistNetwork {
  return parseArtistNetworkDocResult(doc).network
}

export function parseArtistNetworkDocResult(doc: ContextDocDTO | undefined): ArtistNetworkParseResult {
  if (!doc?.body.trim()) return { ok: true, network: emptyArtistNetwork() }
  const json = extractJson(doc.body)
  if (!json) {
    return {
      ok: false,
      network: emptyArtistNetwork(),
      error: 'Artist Network exists, but no JSON block could be read.',
    }
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistNetwork>
    if (parsed.version !== 1 || !Array.isArray(parsed.people)) {
      return {
        ok: false,
        network: emptyArtistNetwork(),
        error: 'Artist Network JSON has an unsupported shape.',
      }
    }
    return {
      ok: true,
      network: {
        version: 1,
        categories: normalizeCategories(parsed.categories),
        people: parsed.people.filter(isPerson),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      },
    }
  } catch {
    return {
      ok: false,
      network: emptyArtistNetwork(),
      error: 'Artist Network JSON is malformed.',
    }
  }
}

export function updateNetworkPerson(
  person: ArtistNetworkPerson,
  input: {
    name: string
    category: ArtistNetworkCategory
    role?: string
    contact?: string
    notes?: string
    canHelpWith?: string
    tags?: string
  },
): ArtistNetworkPerson {
  return {
    ...person,
    name: input.name.trim(),
    category: input.category,
    role: clean(input.role),
    contact: clean(input.contact),
    notes: clean(input.notes),
    canHelpWith: clean(input.canHelpWith),
    tags: parseTags(input.tags),
    updatedAt: new Date().toISOString(),
  }
}

export function createNetworkCategory(label: string, existingCategories: ArtistNetworkCategoryDefinition[]): ArtistNetworkCategoryDefinition {
  const cleanLabel = label.replace(/\s+/g, ' ').trim()
  const base = slugify(cleanLabel || 'category')
  const existingIds = new Set(existingCategories.map((category) => category.id))
  let id = base
  let count = 2
  while (existingIds.has(id)) {
    id = `${base}-${count}`
    count += 1
  }
  return {
    id,
    label: cleanLabel || 'Category',
  }
}

export function createNetworkPerson(input: {
  name: string
  category: ArtistNetworkCategory
  role?: string
  contact?: string
  notes?: string
  canHelpWith?: string
  tags?: string
}): ArtistNetworkPerson {
  const now = new Date().toISOString()
  return {
    id: `person-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim(),
    category: input.category,
    role: clean(input.role),
    contact: clean(input.contact),
    notes: clean(input.notes),
    canHelpWith: clean(input.canHelpWith),
    relationship: 'new',
    tags: parseTags(input.tags),
    createdAt: now,
    updatedAt: now,
  }
}

function normalizeNetwork(network: ArtistNetwork): ArtistNetwork {
  return {
    version: 1,
    categories: normalizeCategories(network.categories),
    people: network.people,
    updatedAt: new Date().toISOString(),
  }
}

export function serializeArtistNetworkBody(network: ArtistNetwork): string {
  const sorted = {
    ...normalizeNetwork(network),
    people: [...network.people].sort((a, b) => a.name.localeCompare(b.name)),
  }
  return [
    'This is global artist relationship context. Treat it as long-term creator context, not one-campaign context.',
    '',
    '```json',
    JSON.stringify(sorted, null, 2),
    '```',
  ].join('\n')
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

function parseTags(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function normalizeCategories(categories: unknown): ArtistNetworkCategoryDefinition[] {
  const customCategories = Array.isArray(categories)
    ? categories.filter(isCategory).map((category) => ({
      id: slugify(category.id),
      label: category.label.replace(/\s+/g, ' ').trim(),
    }))
    : []

  const merged = new Map<string, ArtistNetworkCategoryDefinition>()
  for (const category of [...NETWORK_CATEGORIES, ...customCategories]) {
    if (!category.id || !category.label) continue
    merged.set(category.id, category)
  }
  return [...merged.values()]
}

function isCategory(value: unknown): value is ArtistNetworkCategoryDefinition {
  const candidate = value as Partial<ArtistNetworkCategoryDefinition>
  return typeof candidate.id === 'string' && typeof candidate.label === 'string'
}

function isPerson(value: unknown): value is ArtistNetworkPerson {
  const candidate = value as Partial<ArtistNetworkPerson>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.category === 'string' &&
    Array.isArray(candidate.tags)
  )
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'category'
}
