import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  COLLECTION_DISPLAY_RELATIVE_PATH,
  getCollectionDisplayPath,
  getDefaultCollectionDisplay,
  loadCollectionDisplay,
  normalizeCollectionDisplay,
  saveCollectionDisplay,
  type CollectionDisplay,
} from '../collection-display-storage.ts'

let tempDir: string
let workspaceRoot: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'collection-display-'))
  workspaceRoot = join(tempDir, 'workspace')
  mkdirSync(workspaceRoot, { recursive: true })
})

afterEach(() => {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('getDefaultCollectionDisplay', () => {
  it('matches plan B2.2 defaults (rank asc)', () => {
    expect(getDefaultCollectionDisplay()).toEqual({
      version: 1,
      groupBy: 'none',
      orderBy: 'rank',
      orderDir: 'asc',
      visibleProperties: ['status', 'priority', 'project', 'labels', 'dueDate', 'updated', 'flag'],
      showEmptyGroups: false,
      showCompleted: true,
    })
  })
})

describe('normalizeCollectionDisplay', () => {
  it('returns defaults for null/non-object', () => {
    expect(normalizeCollectionDisplay(null)).toEqual(getDefaultCollectionDisplay())
    expect(normalizeCollectionDisplay('x')).toEqual(getDefaultCollectionDisplay())
  })

  it('falls back invalid enums and keeps valid fields', () => {
    const normalized = normalizeCollectionDisplay({
      version: 99,
      groupBy: 'priority',
      orderBy: 'nope',
      orderDir: 'desc',
      visibleProperties: ['status', 'bogus', 'status', 'model'],
      showEmptyGroups: true,
      showCompleted: false,
    })
    expect(normalized).toEqual({
      version: 1,
      groupBy: 'priority',
      orderBy: 'rank',
      orderDir: 'desc',
      visibleProperties: ['status', 'model'],
      showEmptyGroups: true,
      showCompleted: false,
    })
  })

  it('allows empty visibleProperties when author cleared all', () => {
    const normalized = normalizeCollectionDisplay({
      visibleProperties: [],
    })
    expect(normalized.visibleProperties).toEqual([])
  })
})

describe('loadCollectionDisplay / saveCollectionDisplay', () => {
  it('loads defaults when file is missing', () => {
    expect(loadCollectionDisplay(workspaceRoot)).toEqual(getDefaultCollectionDisplay())
    expect(existsSync(getCollectionDisplayPath(workspaceRoot))).toBe(false)
  })

  it('loads defaults when file is corrupt', () => {
    const path = getCollectionDisplayPath(workspaceRoot)
    mkdirSync(join(workspaceRoot, 'collection'), { recursive: true })
    writeFileSync(path, '{not-json')
    expect(loadCollectionDisplay(workspaceRoot)).toEqual(getDefaultCollectionDisplay())
  })

  it('round-trips through collection/display.json', () => {
    const input: CollectionDisplay = {
      version: 1,
      groupBy: 'project',
      orderBy: 'dueDate',
      orderDir: 'desc',
      visibleProperties: ['status', 'dueDate', 'flag'],
      showEmptyGroups: true,
      showCompleted: false,
    }
    const saved = saveCollectionDisplay(workspaceRoot, input)
    expect(saved).toEqual(input)

    const path = join(workspaceRoot, COLLECTION_DISPLAY_RELATIVE_PATH)
    expect(existsSync(path)).toBe(true)
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    expect(raw).toEqual(input)
    expect(loadCollectionDisplay(workspaceRoot)).toEqual(input)
  })

  it('normalizes on save', () => {
    const saved = saveCollectionDisplay(workspaceRoot, {
      version: 1,
      groupBy: 'label',
      orderBy: 'name',
      orderDir: 'asc',
      visibleProperties: ['labels', 'labels', 'nope' as never],
      showEmptyGroups: false,
      showCompleted: true,
    })
    expect(saved.visibleProperties).toEqual(['labels'])
    expect(loadCollectionDisplay(workspaceRoot).visibleProperties).toEqual(['labels'])
  })
})
