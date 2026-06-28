import { describe, expect, test } from 'bun:test'
import {
  buildDefaultReleaseBoard,
  getBoardTotals,
  mergeReleaseBoardWithAssets,
  parseReleaseBoardDoc,
  serializeReleaseBoardBody,
  toggleReleaseBoardItem,
  updateReleaseBoardItemStatus,
} from './release-board'
import type { ContextDocDTO, MissionAssetManifest } from '../../shared/types'

describe('release board utilities', () => {
  test('builds the default release board categories', () => {
    const board = buildDefaultReleaseBoard('workspace-1')

    expect(board.categories.map((category) => category.id)).toEqual([
      'music',
      'visuals',
      'content',
      'setup',
      'promotion',
      'team',
    ])
    expect(getBoardTotals(board)).toEqual({ done: 0, total: 25 })
    expect(board.categories.find((category) => category.id === 'content')?.items.map((item) => item.label)).toEqual([
      'Idea generation',
      'Lyric clips',
      'Viral clips',
      'UGC clips',
      'Lyric video',
    ])
  })

  test('round-trips through a workspace context doc body', () => {
    const board = toggleReleaseBoardItem(buildDefaultReleaseBoard('workspace-1'), 'visuals', 'cover-art')
    const parsed = parseReleaseBoardDoc({
      slug: 'release-board',
      metadata: { name: 'Release Board', routing: { mode: 'broadcast' }, enabled: true },
      body: serializeReleaseBoardBody(board),
      path: '/tmp/context/release-board',
      workspaceRootPath: '/tmp/workspace',
    } as ContextDocDTO)

    const visuals = parsed?.categories.find((category) => category.id === 'visuals')
    expect(visuals?.items.find((item) => item.id === 'cover-art')?.status).toBe('done')
  })

  test('marks asset-backed items done when matching files exist', () => {
    const board = buildDefaultReleaseBoard('workspace-1')
    const merged = mergeReleaseBoardWithAssets(board, manifestWith('master', 'lyrics', 'cover-art'))

    expect(itemStatus(merged, 'music', 'master')).toBe('done')
    expect(itemStatus(merged, 'music', 'lyrics')).toBe('done')
    expect(itemStatus(merged, 'visuals', 'cover-art')).toBe('done')
    expect(itemStatus(merged, 'promotion', 'ad-creatives')).toBe('needed')
    expect(getBoardTotals(merged).done).toBe(3)
  })

  test('does not mark generated deliverables done from generic media files', () => {
    const board = buildDefaultReleaseBoard('workspace-1')
    const merged = mergeReleaseBoardWithAssets(board, manifestWith('raw-video', 'final-video'))

    expect(itemStatus(merged, 'visuals', 'canvas')).toBe('needed')
    expect(itemStatus(merged, 'content', 'viral-clips')).toBe('needed')
    expect(itemStatus(merged, 'content', 'lyric-video')).toBe('needed')
  })

  test('does not override skipped items from asset auto-fill', () => {
    const board = updateReleaseBoardItemStatus(buildDefaultReleaseBoard('workspace-1'), 'visuals', 'cover-art', 'skipped')
    const merged = mergeReleaseBoardWithAssets(board, manifestWith('cover-art'))

    expect(itemStatus(merged, 'visuals', 'cover-art')).toBe('skipped')
  })

  test('toggles items between needed and done', () => {
    const board = buildDefaultReleaseBoard('workspace-1')
    const done = toggleReleaseBoardItem(board, 'setup', 'presave')
    const needed = toggleReleaseBoardItem(done, 'setup', 'presave')

    expect(itemStatus(done, 'setup', 'presave')).toBe('done')
    expect(itemStatus(needed, 'setup', 'presave')).toBe('needed')
  })
})

function itemStatus(
  board: ReturnType<typeof buildDefaultReleaseBoard>,
  categoryId: string,
  itemId: string,
) {
  return board.categories
    .find((category) => category.id === categoryId)
    ?.items.find((item) => item.id === itemId)
    ?.status
}

function manifestWith(...kinds: MissionAssetManifest['files'][number]['kind'][]): MissionAssetManifest {
  return {
    version: 1,
    workspaceId: 'workspace-1',
    assetsRoot: '/tmp/assets',
    storageMode: 'copied',
    updatedAt: new Date().toISOString(),
    files: kinds.map((kind, index) => ({
      id: `${kind}-${index}`,
      kind,
      label: kind,
      source: 'copy',
      status: 'available',
      usableByAgents: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
  }
}
