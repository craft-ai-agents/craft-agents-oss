import type { ContextDocDTO, ContextDocMetadata, MissionAssetManifest } from '../../shared/types'

export const RELEASE_BOARD_CONTEXT_SLUG = 'release-board'

export type ReleaseBoardItemStatus = 'needed' | 'done' | 'skipped'
type MissionAssetKind = MissionAssetManifest['files'][number]['kind']

export interface ReleaseBoardItem {
  id: string
  label: string
  status: ReleaseBoardItemStatus
  assetKinds?: MissionAssetKind[]
  linkedAssetId?: string
  notes?: string
  updatedAt?: string
}

export interface ReleaseBoardCategory {
  id: 'music' | 'visuals' | 'setup' | 'content' | 'promotion' | 'team'
  label: string
  detail: string
  items: ReleaseBoardItem[]
}

export interface ReleaseBoard {
  version: 1
  workspaceId: string
  categories: ReleaseBoardCategory[]
  updatedAt: string
}

const DEFAULT_CATEGORIES: Omit<ReleaseBoardCategory, 'items'>[] = [
  { id: 'music', label: 'Music', detail: 'Audio and song context' },
  { id: 'visuals', label: 'Visuals', detail: 'Artwork, photos, and motion' },
  { id: 'content', label: 'Content', detail: 'Short-form pieces and copy' },
  { id: 'setup', label: 'Release Setup', detail: 'Links, metadata, and delivery' },
  { id: 'promotion', label: 'Promotion', detail: 'Audience push and spend' },
  { id: 'team', label: 'Team', detail: 'People, approvals, and owners' },
]

const DEFAULT_ITEMS: Record<ReleaseBoardCategory['id'], ReleaseBoardItem[]> = {
  music: [
    { id: 'master', label: 'Master file', status: 'needed', assetKinds: ['master'] },
    { id: 'clean-version', label: 'Clean version', status: 'needed' },
    { id: 'lyrics', label: 'Lyrics', status: 'needed', assetKinds: ['lyrics'] },
    { id: 'song-notes', label: 'Song notes', status: 'needed', assetKinds: ['note'] },
  ],
  visuals: [
    { id: 'cover-art', label: 'Single art', status: 'needed', assetKinds: ['cover-art'] },
    { id: 'canvas', label: 'Spotify Canvas', status: 'needed' },
    { id: 'press-photos', label: 'Press photos', status: 'needed', assetKinds: ['press-photo'] },
    { id: 'visual-references', label: 'Visual references', status: 'needed', assetKinds: ['moodboard-image'] },
  ],
  setup: [
    { id: 'release-date', label: 'Release target', status: 'needed' },
    { id: 'distributor', label: 'Distributor upload', status: 'needed' },
    { id: 'presave', label: 'Pre-save link', status: 'needed' },
    { id: 'metadata', label: 'Credits and metadata', status: 'needed' },
  ],
  content: [
    { id: 'idea-generation', label: 'Idea generation', status: 'needed' },
    { id: 'lyric-clips', label: 'Lyric clips', status: 'needed' },
    { id: 'viral-clips', label: 'Viral clips', status: 'needed' },
    { id: 'ugc-clips', label: 'UGC clips', status: 'needed' },
    { id: 'lyric-video', label: 'Lyric video', status: 'needed' },
  ],
  promotion: [
    { id: 'budget', label: 'Budget set', status: 'needed' },
    { id: 'ad-creatives', label: 'Ad creatives', status: 'needed' },
    { id: 'playlist-targets', label: 'Playlist targets', status: 'needed' },
    { id: 'press-list', label: 'Press list', status: 'needed', assetKinds: ['press-doc'] },
  ],
  team: [
    { id: 'owners', label: 'Owners named', status: 'needed' },
    { id: 'collaborators', label: 'Collaborators noted', status: 'needed' },
    { id: 'approvals', label: 'Approval path', status: 'needed' },
    { id: 'handoff-notes', label: 'Handoff notes', status: 'needed' },
  ],
}

export function buildDefaultReleaseBoard(workspaceId: string): ReleaseBoard {
  const now = new Date().toISOString()
  return {
    version: 1,
    workspaceId,
    categories: DEFAULT_CATEGORIES.map((category) => ({
      ...category,
      items: DEFAULT_ITEMS[category.id].map((item) => ({ ...item })),
    })),
    updatedAt: now,
  }
}

export function releaseBoardMetadata(board: ReleaseBoard): ContextDocMetadata {
  return {
    name: 'Release Board',
    description: 'Mission-scoped checklist of release pieces, assets, and handoffs.',
    routing: { mode: 'broadcast' },
    enabled: true,
    status: 'active',
    priority: getBoardTotals(board).done > 0 ? 'high' : 'normal',
  }
}

export function serializeReleaseBoardBody(board: ReleaseBoard): string {
  const totals = getBoardTotals(board)
  const summary = board.categories.flatMap((category) => {
    const progress = getCategoryProgress(category)
    return [
      `- ${category.label}: ${progress.done}/${progress.total} done`,
      ...category.items.map((item) => `  - ${item.label}: ${item.status}`),
    ]
  })

  return [
    'This context is the release board for the current mission. Treat it as mission-scoped execution context: what exists, what is handled, and what still needs attention.',
    '',
    '```json',
    JSON.stringify(board, null, 2),
    '```',
    '',
    '## Summary',
    '',
    `${totals.done}/${totals.total} release pieces are marked done.`,
    ...summary,
  ].join('\n')
}

export function parseReleaseBoardDoc(doc: ContextDocDTO | undefined | null): ReleaseBoard | null {
  if (!doc) return null
  const fenced = doc.body.match(/```json\s*([\s\S]*?)\s*```/i)
  const raw = fenced?.[1]
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ReleaseBoard>
    if (!parsed || parsed.version !== 1 || !parsed.workspaceId || !Array.isArray(parsed.categories)) return null
    return normalizeReleaseBoard(parsed.workspaceId, parsed)
  } catch {
    return null
  }
}

export function mergeReleaseBoardWithAssets(board: ReleaseBoard, manifest: MissionAssetManifest | null): ReleaseBoard {
  const files = manifest?.files.filter((file) => file.status === 'available') ?? []
  if (files.length === 0) return board

  let changed = false
  const categories = board.categories.map((category) => ({
    ...category,
    items: category.items.map((item) => {
      if (item.status === 'done' || item.status === 'skipped' || !item.assetKinds?.length) return item
      const asset = files.find((file) => item.assetKinds?.includes(file.kind))
      if (!asset) return item
      changed = true
      return {
        ...item,
        status: 'done' as const,
        linkedAssetId: asset.id,
        updatedAt: new Date().toISOString(),
      }
    }),
  }))

  return changed ? { ...board, categories, updatedAt: new Date().toISOString() } : board
}

export function toggleReleaseBoardItem(board: ReleaseBoard, categoryId: ReleaseBoardCategory['id'], itemId: string): ReleaseBoard {
  return updateReleaseBoardItemStatus(
    board,
    categoryId,
    itemId,
    findReleaseBoardItem(board, categoryId, itemId)?.status === 'done' ? 'needed' : 'done',
  )
}

export function updateReleaseBoardItemStatus(
  board: ReleaseBoard,
  categoryId: ReleaseBoardCategory['id'],
  itemId: string,
  status: ReleaseBoardItemStatus,
): ReleaseBoard {
  const now = new Date().toISOString()
  return {
    ...board,
    updatedAt: now,
    categories: board.categories.map((category) => {
      if (category.id !== categoryId) return category
      return {
        ...category,
        items: category.items.map((item) => (
          item.id === itemId ? { ...item, status, updatedAt: now } : item
        )),
      }
    }),
  }
}

export function getCategoryProgress(category: ReleaseBoardCategory): { done: number; total: number } {
  const actionable = category.items.filter((item) => item.status !== 'skipped')
  return {
    done: actionable.filter((item) => item.status === 'done').length,
    total: actionable.length,
  }
}

export function getBoardTotals(board: ReleaseBoard): { done: number; total: number } {
  return board.categories.reduce(
    (totals, category) => {
      const progress = getCategoryProgress(category)
      return {
        done: totals.done + progress.done,
        total: totals.total + progress.total,
      }
    },
    { done: 0, total: 0 },
  )
}

function findReleaseBoardItem(board: ReleaseBoard, categoryId: ReleaseBoardCategory['id'], itemId: string): ReleaseBoardItem | null {
  return board.categories.find((category) => category.id === categoryId)?.items.find((item) => item.id === itemId) ?? null
}

function normalizeReleaseBoard(workspaceId: string, input: Partial<ReleaseBoard>): ReleaseBoard {
  const fallback = buildDefaultReleaseBoard(workspaceId)
  const categories = fallback.categories.map((fallbackCategory) => {
    const existingCategory = input.categories?.find((category) => category.id === fallbackCategory.id)
    return {
      ...fallbackCategory,
      detail: existingCategory?.detail || fallbackCategory.detail,
      items: fallbackCategory.items.map((fallbackItem) => {
        const existingItem = existingCategory?.items?.find((item) => item.id === fallbackItem.id)
        return existingItem
          ? {
              ...fallbackItem,
              ...existingItem,
              status: normalizeStatus(existingItem.status),
            }
          : fallbackItem
      }),
    }
  })

  return {
    version: 1,
    workspaceId,
    categories,
    updatedAt: input.updatedAt || fallback.updatedAt,
  }
}

function normalizeStatus(status: unknown): ReleaseBoardItemStatus {
  return status === 'done' || status === 'skipped' ? status : 'needed'
}
