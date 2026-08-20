/**
 * Client-side reader for the local Notes import map.
 *
 * The map records source-vault paths and their local Markdown Notes destinations.
 * It intentionally does not route imported Notes through a remote provider.
 */

export const NOTES_MIGRATION_MAP_RELATIVE = '.craft/notes-migration-map.json'
export const NOTES_MIGRATION_MAP_VERSION = 2

export interface NotesMigrationMapEntry {
  sourceRoot: string
  destinationRoot: string
  noteId: string
  sourcePath: string
  destinationNoteId: string
  destinationPath: string
  title: string
  state: 'pending' | 'completed'
  importedAt?: number
}

export interface NotesMigrationMap {
  version: number
  entries: NotesMigrationMapEntry[]
}

function emptyMap(): NotesMigrationMap {
  return { version: NOTES_MIGRATION_MAP_VERSION, entries: [] }
}

/** Normalize a source or destination note key for map lookup. */
export function normalizeNoteMapKey(value: string): string {
  let cleaned = value.replace(/\\/g, '/').trim().replace(/^\.\//, '')
  if (cleaned.toLowerCase().startsWith('notes/')) {
    cleaned = cleaned.slice('notes/'.length)
  }
  if (cleaned.toLowerCase().endsWith('.md')) {
    cleaned = cleaned.slice(0, -3)
  }
  return cleaned.toLowerCase()
}

function isEntry(value: unknown): value is NotesMigrationMapEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<NotesMigrationMapEntry>
  return typeof entry.sourceRoot === 'string'
    && typeof entry.destinationRoot === 'string'
    && typeof entry.noteId === 'string'
    && typeof entry.sourcePath === 'string'
    && typeof entry.destinationNoteId === 'string'
    && typeof entry.destinationPath === 'string'
    && typeof entry.title === 'string'
    && (entry.state === 'pending' || entry.state === 'completed')
    && (entry.importedAt === undefined || typeof entry.importedAt === 'number')
}

export function parseNotesMigrationMap(raw: string): NotesMigrationMap {
  try {
    const parsed = JSON.parse(raw) as Partial<NotesMigrationMap>
    if (!parsed || typeof parsed !== 'object' || parsed.version !== NOTES_MIGRATION_MAP_VERSION) {
      return emptyMap()
    }
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.filter(isEntry)
      : []
    return { version: NOTES_MIGRATION_MAP_VERSION, entries }
  } catch {
    return emptyMap()
  }
}

/**
 * Find a completed local import entry by source or destination key.
 * Ambiguous source ids deliberately return null instead of navigating to the
 * wrong local note.
 */
export function findMigrationEntry(
  map: NotesMigrationMap,
  noteIdOrPath: string,
): NotesMigrationMapEntry | null {
  const key = normalizeNoteMapKey(noteIdOrPath)
  if (!key) return null
  const matches = map.entries.filter((entry) =>
    entry.state === 'completed'
    && (
      normalizeNoteMapKey(entry.noteId) === key
      || normalizeNoteMapKey(entry.sourcePath) === key
      || normalizeNoteMapKey(entry.destinationNoteId) === key
      || normalizeNoteMapKey(entry.destinationPath) === key
    ),
  )
  return matches.length === 1 ? matches[0]! : null
}

export function notesMigrationMapAbsolutePath(workspaceRoot: string): string {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  return `${root}/${NOTES_MIGRATION_MAP_RELATIVE}`
}

/** Missing or unreadable maps are treated as no local import mapping. */
export async function loadNotesMigrationMap(
  workspaceRoot: string | null | undefined,
  readFile: (path: string) => Promise<string> = (path) => window.electronAPI.readFile(path),
): Promise<NotesMigrationMap> {
  if (!workspaceRoot) return emptyMap()
  try {
    return parseNotesMigrationMap(await readFile(notesMigrationMapAbsolutePath(workspaceRoot)))
  } catch {
    return emptyMap()
  }
}

export async function lookupImportedNote(
  workspaceRoot: string | null | undefined,
  noteIdOrPath: string,
  readFile?: (path: string) => Promise<string>,
): Promise<NotesMigrationMapEntry | null> {
  const map = await loadNotesMigrationMap(workspaceRoot, readFile)
  return findMigrationEntry(map, noteIdOrPath)
}
