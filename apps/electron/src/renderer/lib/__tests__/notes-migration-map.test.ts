import { describe, expect, it } from 'bun:test'
import {
  findMigrationEntry,
  loadNotesMigrationMap,
  lookupImportedNote,
  normalizeNoteMapKey,
  parseNotesMigrationMap,
} from '../notes-migration-map'

const SAMPLE = JSON.stringify({
  version: 2,
  entries: [
    {
      sourceRoot: '/selected/vault',
      destinationRoot: '/local/notes',
      noteId: 'alpha',
      sourcePath: 'alpha.md',
      destinationNoteId: 'imports/abcd/alpha',
      destinationPath: 'imports/abcd/alpha.md',
      title: 'Alpha',
      state: 'completed',
      importedAt: 1,
    },
    {
      sourceRoot: '/selected/vault',
      destinationRoot: '/local/notes',
      noteId: 'projects/beta',
      sourcePath: 'projects/beta.md',
      destinationNoteId: 'imports/abcd/projects/beta',
      destinationPath: 'imports/abcd/projects/beta.md',
      title: 'Beta',
      state: 'completed',
      importedAt: 2,
    },
  ],
})

describe('normalizeNoteMapKey', () => {
  it('strips notes/ prefix, .md, and lowercases', () => {
    expect(normalizeNoteMapKey('notes/Alpha.md')).toBe('alpha')
    expect(normalizeNoteMapKey('projects/Beta')).toBe('projects/beta')
    expect(normalizeNoteMapKey('./notes/x/Y.md')).toBe('x/y')
  })
})

describe('parseNotesMigrationMap + findMigrationEntry', () => {
  it('finds completed imports by source and destination paths', () => {
    const map = parseNotesMigrationMap(SAMPLE)
    expect(findMigrationEntry(map, 'alpha')?.destinationNoteId).toBe('imports/abcd/alpha')
    expect(findMigrationEntry(map, 'notes/alpha.md')?.destinationNoteId).toBe('imports/abcd/alpha')
    expect(findMigrationEntry(map, 'imports/abcd/projects/beta.md')?.title).toBe('Beta')
    expect(findMigrationEntry(map, 'missing')).toBeNull()
  })

  it('ignores legacy and malformed maps instead of retaining remote redirects', () => {
    const legacy = parseNotesMigrationMap(JSON.stringify({
      version: 1,
      notebookId: 'remote-notebook',
      entries: [{ noteId: 'old', siyuanId: 'remote-document' }],
    }))
    expect(legacy.entries).toEqual([])
    expect(findMigrationEntry(legacy, 'old')).toBeNull()
    expect(parseNotesMigrationMap('not-json').entries).toEqual([])
  })
})

describe('loadNotesMigrationMap / lookupImportedNote', () => {
  it('loads via readFile and looks up a local destination', async () => {
    const readFile = async (path: string) => {
      expect(path.replace(/\\/g, '/')).toMatch(/\/.craft\/notes-migration-map\.json$/)
      return SAMPLE
    }
    const map = await loadNotesMigrationMap('/ws/root', readFile)
    expect(map.entries).toHaveLength(2)
    const entry = await lookupImportedNote('/ws/root', 'alpha', readFile)
    expect(entry?.destinationNoteId).toBe('imports/abcd/alpha')
  })

  it('returns empty when reading fails', async () => {
    const map = await loadNotesMigrationMap('/ws', async () => {
      throw new Error('ENOENT')
    })
    expect(map.entries).toEqual([])
    expect(await lookupImportedNote(null, 'alpha')).toBeNull()
  })
})
