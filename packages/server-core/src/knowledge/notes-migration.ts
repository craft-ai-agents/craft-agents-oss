/**
 * Local Craft Markdown Notes import.
 *
 * Import state is stored at `{workspaceRoot}/.craft/notes-migration-map.json`.
 * The importer only reads the selected source vault and writes into the existing
 * local Markdown Notes root. Each source file is checkpointed before it is
 * materialized, so a crash or injected failure can resume without duplicate
 * files. Source vault files are never renamed, modified, or deleted.
 */
import { createHash } from 'crypto'
import { link, lstat, mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from 'fs/promises'
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'path'
import { assertNotesImportPaths, getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { getDefaultWorkspacesDir, loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import matter from 'gray-matter'

export const NOTES_MIGRATION_MAP_VERSION = 2 as const
export const NOTES_MIGRATION_MAP_RELATIVE = join('.craft', 'notes-migration-map.json')
export const CRAFT_MARKDOWN_IMPORT_FORMAT = 'craft-markdown' as const

const NOTES_DIR = 'notes'
const ASSETS_DIR = 'assets'
const TEMPLATES_DIR = 'templates'
const IMPORTS_DIR = 'imports'

export interface NotesImportLimits {
  maxTraversalEntries: number
  maxDepth: number
  maxNotes: number
  maxNoteBytes: number
  maxAssets: number
  maxAssetBytes: number
  maxTotalAssetBytes: number
}

/** Bounds mirror existing source-index and attachment handling limits. */
export const NOTES_IMPORT_LIMITS: Readonly<NotesImportLimits> = {
  maxTraversalEntries: 10_000,
  maxDepth: 64,
  maxNotes: 2_000,
  maxNoteBytes: 2 * 1024 * 1024,
  maxAssets: 2_000,
  maxAssetBytes: 50 * 1024 * 1024,
  maxTotalAssetBytes: 200 * 1024 * 1024,
}
export type NotesImportCheckpointStage =
  | 'asset-planned'
  | 'asset-completed'
  | 'note-planned'
  | 'note-completed'

type NotesImportCheckpointState = 'pending' | 'completed'

export interface NotesImportCheckpoint {
  stage: NotesImportCheckpointStage
  sourcePath: string
}

export interface NotesMigrationMapEntry {
  /** Canonical selected import root. */
  sourceRoot: string
  /** Canonical Markdown Notes destination root. */
  destinationRoot: string
  /** Source relative note id, without `.md`. */
  noteId: string
  /** Source relative Markdown path, with `.md`. */
  sourcePath: string
  /** Destination local Notes id, without `.md`. */
  destinationNoteId: string
  /** Destination local Notes path relative to destination root, with `.md`. */
  destinationPath: string
  title: string
  sourceHash: string
  destinationHash?: string
  state: NotesImportCheckpointState
  importedAt?: number
}

export interface NotesMigrationAssetMapEntry {
  sourceRoot: string
  destinationRoot: string
  /** Source relative asset path under the selected root. */
  sourcePath: string
  /** Destination asset path relative to destination Notes root. */
  destinationPath: string
  bytes: number
  sourceHash: string
  destinationHash?: string
  state: NotesImportCheckpointState
  importedAt?: number
}

/** Retained when reading a v1 remote map so local import never erases user data. */
export interface LegacySiyuanMigrationMapEntry {
  noteId: string
  path: string
  siyuanId: string
  title: string
  migratedAt: number
}

export interface LegacySiyuanMigrationMap {
  notebookId?: string
  notebookName?: string
  entries: LegacySiyuanMigrationMapEntry[]
}

export interface NotesMigrationMap {
  version: typeof NOTES_MIGRATION_MAP_VERSION
  entries: NotesMigrationMapEntry[]
  assets: NotesMigrationAssetMapEntry[]
  legacySiyuan?: LegacySiyuanMigrationMap
}

export interface MigrateNotesArgs {
  workspaceId: string
  /** Absolute source vault root chosen by the user. */
  sourceRoot: string
  /** Defaults to the only supported local format, `craft-markdown`. */
  format?: string
}

export interface MigrateNotesResult {
  migrated: number
  skipped: number
  failed: Array<{ noteId: string; error: string }>
  mapPath: string
  sourceRoot: string
  destinationRoot: string
  format: typeof CRAFT_MARKDOWN_IMPORT_FORMAT
}

export interface NotesMigrationNote {
  noteId: string
  relativePath: string
  title: string
  sourceHash: string
}

export class NotesImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotesImportError'
  }
}

interface ScannedAsset {
  relativePath: string
  bytes: number
  sourceHash: string
}

interface ScannedVault {
  notes: NotesMigrationNote[]
  assets: ScannedAsset[]
}

export interface ImportCraftMarkdownNotesOptions {
  workspaceRoot: string
  sourceRoot: string
  destinationRoot: string
  now?: () => number
  limits?: Partial<NotesImportLimits>
  /** Test seam for simulating a process interruption after an atomic checkpoint. */
  onCheckpoint?: (checkpoint: NotesImportCheckpoint) => void | Promise<void>
}

export interface ImportNotesOptions extends ImportCraftMarkdownNotesOptions {
  format?: string
}

function toSlashPath(path: string): string {
  return path.split(sep).join('/')
}

function stripMdExtension(path: string): string {
  return path.toLowerCase().endsWith('.md') ? path.slice(0, -3) : path
}

function noteIdFromRelativePath(relativePath: string): string {
  return stripMdExtension(toSlashPath(relativePath))
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isNodeError(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function assertPortableRelativePath(value: string, label: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new NotesImportError(`Unsafe notes import path: invalid ${label}`)
  }
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new NotesImportError(`Unsafe notes import path: invalid ${label}`)
  }
  return parts.join('/')
}

function normalizeReferencePath(value: string): string | null {
  const raw = value.replace(/\\/g, '/')
  if (!raw || raw.includes('\0') || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) return null
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length > 0 ? parts.join('/') : null
}

function normalizeLimits(overrides?: Partial<NotesImportLimits>): NotesImportLimits {
  const limits: NotesImportLimits = { ...NOTES_IMPORT_LIMITS, ...overrides }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new NotesImportError(`Invalid notes import limit: ${key}`)
    }
  }
  return limits
}

function isCheckpointState(value: unknown): value is NotesImportCheckpointState {
  return value === 'pending' || value === 'completed'
}

function isLegacyEntry(value: unknown): value is LegacySiyuanMigrationMapEntry {
  return !!value
    && typeof value === 'object'
    && typeof (value as LegacySiyuanMigrationMapEntry).noteId === 'string'
    && typeof (value as LegacySiyuanMigrationMapEntry).path === 'string'
    && typeof (value as LegacySiyuanMigrationMapEntry).siyuanId === 'string'
    && typeof (value as LegacySiyuanMigrationMapEntry).title === 'string'
    && typeof (value as LegacySiyuanMigrationMapEntry).migratedAt === 'number'
}

function isMapEntry(value: unknown): value is NotesMigrationMapEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<NotesMigrationMapEntry>
  return typeof entry.sourceRoot === 'string'
    && typeof entry.destinationRoot === 'string'
    && typeof entry.noteId === 'string'
    && typeof entry.sourcePath === 'string'
    && typeof entry.destinationNoteId === 'string'
    && typeof entry.destinationPath === 'string'
    && typeof entry.title === 'string'
    && typeof entry.sourceHash === 'string'
    && isCheckpointState(entry.state)
    && (entry.destinationHash === undefined || typeof entry.destinationHash === 'string')
    && (entry.importedAt === undefined || typeof entry.importedAt === 'number')
}

function isAssetMapEntry(value: unknown): value is NotesMigrationAssetMapEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<NotesMigrationAssetMapEntry>
  return typeof entry.sourceRoot === 'string'
    && typeof entry.destinationRoot === 'string'
    && typeof entry.sourcePath === 'string'
    && typeof entry.destinationPath === 'string'
    && typeof entry.bytes === 'number'
    && Number.isSafeInteger(entry.bytes)
    && entry.bytes >= 0
    && typeof entry.sourceHash === 'string'
    && isCheckpointState(entry.state)
    && (entry.destinationHash === undefined || typeof entry.destinationHash === 'string')
    && (entry.importedAt === undefined || typeof entry.importedAt === 'number')
}

function validateCurrentMapEntry(entry: NotesMigrationMapEntry): NotesMigrationMapEntry {
  assertPortableRelativePath(entry.sourcePath, 'source note path')
  const destinationPath = assertPortableRelativePath(entry.destinationPath, 'destination note path')
  const destinationNoteId = assertPortableRelativePath(entry.destinationNoteId, 'destination note id')
  if (!destinationPath.toLowerCase().endsWith('.md') || stripMdExtension(destinationPath) !== destinationNoteId) {
    throw new NotesImportError('Notes import map contains an invalid destination note mapping')
  }
  if (!entry.noteId || entry.noteId.includes('\0')) {
    throw new NotesImportError('Notes import map contains an invalid source note id')
  }
  return entry
}

function validateCurrentAssetMapEntry(entry: NotesMigrationAssetMapEntry): NotesMigrationAssetMapEntry {
  assertPortableRelativePath(entry.sourcePath, 'source asset path')
  assertPortableRelativePath(entry.destinationPath, 'destination asset path')
  return entry
}

export function emptyNotesMigrationMap(): NotesMigrationMap {
  return {
    version: NOTES_MIGRATION_MAP_VERSION,
    entries: [],
    assets: [],
  }
}

function parseLegacySiyuanMap(parsed: Record<string, unknown>): LegacySiyuanMigrationMap | undefined {
  const entries = Array.isArray(parsed.entries)
    ? parsed.entries.filter(isLegacyEntry)
    : []
  if (entries.length === 0
    && typeof parsed.notebookId !== 'string'
    && typeof parsed.notebookName !== 'string') {
    return undefined
  }
  return {
    notebookId: typeof parsed.notebookId === 'string' ? parsed.notebookId : undefined,
    notebookName: typeof parsed.notebookName === 'string' ? parsed.notebookName : undefined,
    entries,
  }
}

function parseMap(raw: string): NotesMigrationMap {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new NotesImportError(`Could not parse notes import map: ${errorMessage(error)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NotesImportError('Could not parse notes import map: expected an object')
  }
  const object = parsed as Record<string, unknown>
  const version = object.version

  // v1 represented remote redirects. Preserve it in a namespaced compatibility
  // field while starting the independent local import map empty.
  if (version === undefined || version === 1) {
    const legacySiyuan = parseLegacySiyuanMap(object)
    return {
      ...emptyNotesMigrationMap(),
      ...(legacySiyuan ? { legacySiyuan } : {}),
    }
  }
  if (version !== NOTES_MIGRATION_MAP_VERSION) {
    throw new NotesImportError(`Unsupported notes import map version: ${String(version)}`)
  }
  if (object.entries !== undefined && !Array.isArray(object.entries)) {
    throw new NotesImportError('Notes import map has invalid entries')
  }
  if (object.assets !== undefined && !Array.isArray(object.assets)) {
    throw new NotesImportError('Notes import map has invalid assets')
  }
  const rawEntries = Array.isArray(object.entries) ? object.entries : []
  const rawAssets = Array.isArray(object.assets) ? object.assets : []
  const entries = rawEntries.map((entry) => {
    if (!isMapEntry(entry)) throw new NotesImportError('Notes import map has an invalid note checkpoint')
    return validateCurrentMapEntry(entry)
  })
  const assets = rawAssets.map((entry) => {
    if (!isAssetMapEntry(entry)) throw new NotesImportError('Notes import map has an invalid asset checkpoint')
    return validateCurrentAssetMapEntry(entry)
  })

  let legacySiyuan: LegacySiyuanMigrationMap | undefined
  if (object.legacySiyuan !== undefined) {
    if (!object.legacySiyuan || typeof object.legacySiyuan !== 'object' || Array.isArray(object.legacySiyuan)) {
      throw new NotesImportError('Notes import map has invalid legacy migration data')
    }
    const legacy = object.legacySiyuan as Record<string, unknown>
    const rawLegacyEntries = legacy.entries
    if (rawLegacyEntries !== undefined && !Array.isArray(rawLegacyEntries)) {
      throw new NotesImportError('Notes import map has invalid legacy migration entries')
    }
    const legacyEntries = Array.isArray(rawLegacyEntries) ? rawLegacyEntries : []
    const entries = legacyEntries.map((entry) => {
      if (!isLegacyEntry(entry)) throw new NotesImportError('Notes import map has an invalid legacy migration entry')
      return entry
    })
    legacySiyuan = {
      notebookId: typeof legacy.notebookId === 'string' ? legacy.notebookId : undefined,
      notebookName: typeof legacy.notebookName === 'string' ? legacy.notebookName : undefined,
      entries,
    }
  }

  return {
    version: NOTES_MIGRATION_MAP_VERSION,
    entries,
    assets,
    ...(legacySiyuan ? { legacySiyuan } : {}),
  }
}

export function notesMigrationMapPath(workspaceRoot: string): string {
  return join(workspaceRoot, NOTES_MIGRATION_MAP_RELATIVE)
}

async function resolveWorkspaceRootForMap(workspaceRoot: string): Promise<string> {
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
    throw new NotesImportError('Notes import workspace root must be an absolute path')
  }
  let canonical: string
  try {
    canonical = await realpath(workspaceRoot)
  } catch (error) {
    throw new NotesImportError(`Could not resolve notes import workspace root: ${errorMessage(error)}`)
  }
  const info = await lstat(canonical).catch((error) => {
    throw new NotesImportError(`Could not inspect notes import workspace root: ${errorMessage(error)}`)
  })
  if (!info.isDirectory()) throw new NotesImportError('Notes import workspace root is not a directory')
  return canonical
}

async function resolveSafeMapPath(workspaceRoot: string, createParent: boolean): Promise<string> {
  const canonicalWorkspaceRoot = await resolveWorkspaceRootForMap(workspaceRoot)
  const mapPath = resolve(canonicalWorkspaceRoot, NOTES_MIGRATION_MAP_RELATIVE)
  if (!isPathInside(canonicalWorkspaceRoot, mapPath)) {
    throw new NotesImportError('Unsafe notes import map path')
  }
  const mapDir = dirname(mapPath)
  if (createParent) {
    await mkdir(mapDir, { recursive: true })
  }
  try {
    const dirInfo = await lstat(mapDir)
    if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) {
      throw new NotesImportError('Unsafe notes import map directory')
    }
    const canonicalDir = await realpath(mapDir)
    if (!isPathInside(canonicalWorkspaceRoot, canonicalDir)) {
      throw new NotesImportError('Unsafe notes import map directory')
    }
  } catch (error) {
    if (isNodeError(error, 'ENOENT') && !createParent) return mapPath
    throw error
  }
  try {
    const mapInfo = await lstat(mapPath)
    if (mapInfo.isSymbolicLink()) throw new NotesImportError('Unsafe notes import map path')
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error
  }
  return mapPath
}

export async function readNotesMigrationMap(workspaceRoot: string): Promise<NotesMigrationMap> {
  const mapPath = await resolveSafeMapPath(workspaceRoot, false)
  try {
    return parseMap(await readFile(mapPath, 'utf-8'))
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return emptyNotesMigrationMap()
    if (error instanceof NotesImportError) throw error
    throw new NotesImportError(`Could not read notes import map: ${errorMessage(error)}`)
  }
}

let temporaryFileSequence = 0

function temporaryPath(directory: string, targetName: string, label: string): string {
  temporaryFileSequence += 1
  return join(directory, `.${targetName}.${process.pid}.${Date.now()}.${temporaryFileSequence}.${label}.tmp`)
}

function sortedMapPayload(map: NotesMigrationMap): NotesMigrationMap {
  const entries = [...map.entries].sort((left, right) =>
    `${left.sourceRoot}\0${left.destinationRoot}\0${left.sourcePath}`.localeCompare(
      `${right.sourceRoot}\0${right.destinationRoot}\0${right.sourcePath}`,
    ),
  )
  const assets = [...map.assets].sort((left, right) =>
    `${left.sourceRoot}\0${left.destinationRoot}\0${left.sourcePath}`.localeCompare(
      `${right.sourceRoot}\0${right.destinationRoot}\0${right.sourcePath}`,
    ),
  )
  return {
    version: NOTES_MIGRATION_MAP_VERSION,
    entries,
    assets,
    ...(map.legacySiyuan ? { legacySiyuan: map.legacySiyuan } : {}),
  }
}

/** Atomically replace the map from a same-directory temporary file. */
export async function writeNotesMigrationMap(workspaceRoot: string, map: NotesMigrationMap): Promise<string> {
  const mapPath = await resolveSafeMapPath(workspaceRoot, true)
  const payload = `${JSON.stringify(sortedMapPayload(map), null, 2)}\n`
  const tempPath = temporaryPath(dirname(mapPath), basename(mapPath), 'notes-import-map')
  try {
    await writeFile(tempPath, payload, { encoding: 'utf-8', flag: 'wx' })
    await rename(tempPath, mapPath)
    return mapPath
  } finally {
    await unlink(tempPath).catch(() => undefined)
  }
}

/** Resolve the local Markdown Notes destination the Notes RPC uses. */
export function resolveWorkspaceNotesRoot(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (config?.notesPath) return config.notesPath
  return join(getDefaultWorkspacesDir(), workspaceId, NOTES_DIR)
}

async function resolveSelectedImportRoot(sourceRoot: string): Promise<string> {
  if (!sourceRoot || !isAbsolute(sourceRoot)) {
    throw new NotesImportError('Selected notes import root must be an absolute path')
  }
  let canonical: string
  try {
    canonical = await realpath(sourceRoot)
  } catch (error) {
    throw new NotesImportError(`Could not resolve selected notes import root: ${errorMessage(error)}`)
  }
  const info = await lstat(canonical).catch((error) => {
    throw new NotesImportError(`Could not inspect selected notes import root: ${errorMessage(error)}`)
  })
  if (!info.isDirectory()) throw new NotesImportError('Selected notes import root is not a directory')
  return canonical
}

async function resolveDestinationNotesRoot(destinationRoot: string): Promise<string> {
  if (!destinationRoot || !isAbsolute(destinationRoot)) {
    throw new NotesImportError('Notes destination root must be an absolute path')
  }
  await mkdir(destinationRoot, { recursive: true })
  let canonical: string
  try {
    canonical = await realpath(destinationRoot)
  } catch (error) {
    throw new NotesImportError(`Could not resolve notes destination root: ${errorMessage(error)}`)
  }
  const info = await lstat(canonical).catch((error) => {
    throw new NotesImportError(`Could not inspect notes destination root: ${errorMessage(error)}`)
  })
  if (!info.isDirectory()) throw new NotesImportError('Notes destination root is not a directory')
  return canonical
}

async function inspectSafeSourcePath(root: string, absolutePath: string): Promise<{ path: string; isDirectory: boolean; isFile: boolean; size: number }> {
  if (!isPathInside(root, absolutePath)) {
    throw new NotesImportError('Unsafe notes import path: candidate escapes the selected root')
  }
  const initial = await lstat(absolutePath).catch((error) => {
    throw new NotesImportError(`Could not inspect selected notes import path: ${errorMessage(error)}`)
  })
  if (initial.isSymbolicLink()) {
    throw new NotesImportError(`Unsafe notes import path: symlinks are not allowed (${toSlashPath(relative(root, absolutePath))})`)
  }
  const canonical = await realpath(absolutePath).catch((error) => {
    throw new NotesImportError(`Could not resolve selected notes import path: ${errorMessage(error)}`)
  })
  if (!isPathInside(root, canonical)) {
    throw new NotesImportError(`Unsafe notes import path: resolved path escapes the selected root (${toSlashPath(relative(root, absolutePath))})`)
  }
  const current = await lstat(canonical).catch((error) => {
    throw new NotesImportError(`Could not inspect selected notes import path: ${errorMessage(error)}`)
  })
  if (current.isSymbolicLink()) {
    throw new NotesImportError(`Unsafe notes import path: symlinks are not allowed (${toSlashPath(relative(root, absolutePath))})`)
  }
  return {
    path: canonical,
    isDirectory: current.isDirectory(),
    isFile: current.isFile(),
    size: current.size,
  }
}

async function readSafeSourceFile(root: string, sourcePath: string, maxBytes: number): Promise<Buffer> {
  const safePath = assertPortableRelativePath(sourcePath, 'source path')
  const absolutePath = resolve(root, ...safePath.split('/'))
  const inspected = await inspectSafeSourcePath(root, absolutePath)
  if (!inspected.isFile) {
    throw new NotesImportError(`Selected notes import path is not a file: ${safePath}`)
  }
  if (inspected.size > maxBytes) {
    throw new NotesImportError(`Selected notes import file exceeds the ${maxBytes} byte limit: ${safePath}`)
  }
  const bytes = await readFile(inspected.path)
  if (bytes.length > maxBytes) {
    throw new NotesImportError(`Selected notes import file exceeds the ${maxBytes} byte limit: ${safePath}`)
  }
  return bytes
}

function titleFromContent(noteId: string, content: string): string {
  let properties: Record<string, unknown> = {}
  let body = content
  try {
    const parsed = matter(content)
    properties = (parsed.data ?? {}) as Record<string, unknown>
    body = parsed.content ?? ''
  } catch {
    // Keep original Markdown unless link relocation is necessary.
  }
  if (typeof properties.title === 'string' && properties.title.trim()) return properties.title.trim()
  const heading = body.match(/^#\s+(.+)$/m)
  if (heading?.[1]?.trim()) return heading[1].trim()
  return basename(noteId)
}

async function scanCraftMarkdownVault(root: string, limits: NotesImportLimits): Promise<ScannedVault> {
  const notes: NotesMigrationNote[] = []
  const assets: ScannedAsset[] = []
  let visitedEntries = 0
  let totalAssetBytes = 0

  const visitEntry = (): void => {
    visitedEntries += 1
    if (visitedEntries > limits.maxTraversalEntries) {
      throw new NotesImportError(`Selected notes import root exceeds the ${limits.maxTraversalEntries} entry traversal limit`)
    }
  }

  const walkAssets = async (directory: string, depth: number): Promise<void> => {
    if (depth > limits.maxDepth) {
      throw new NotesImportError(`Selected notes import root exceeds the ${limits.maxDepth} directory depth limit`)
    }
    const directoryInfo = await inspectSafeSourcePath(root, directory)
    if (!directoryInfo.isDirectory) {
      throw new NotesImportError(`Selected notes import asset path is not a directory: ${toSlashPath(relative(root, directory))}`)
    }
    const entries = await readdir(directoryInfo.path, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      visitEntry()
      if (entry.name.startsWith('.')) continue
      const absolutePath = join(directoryInfo.path, entry.name)
      const inspected = await inspectSafeSourcePath(root, absolutePath)
      if (inspected.isDirectory) {
        await walkAssets(inspected.path, depth + 1)
        continue
      }
      if (!inspected.isFile) continue
      if (assets.length >= limits.maxAssets) {
        throw new NotesImportError(`Selected notes import root exceeds the ${limits.maxAssets} asset limit`)
      }
      if (inspected.size > limits.maxAssetBytes) {
        throw new NotesImportError(`Selected notes import asset exceeds the ${limits.maxAssetBytes} byte limit: ${toSlashPath(relative(root, inspected.path))}`)
      }
      totalAssetBytes += inspected.size
      if (totalAssetBytes > limits.maxTotalAssetBytes) {
        throw new NotesImportError(`Selected notes import assets exceed the ${limits.maxTotalAssetBytes} byte total limit`)
      }
      const relativePath = toSlashPath(relative(root, inspected.path))
      const bytes = await readSafeSourceFile(root, relativePath, limits.maxAssetBytes)
      if (bytes.length !== inspected.size) {
        throw new NotesImportError(`Selected notes import asset changed during scanning: ${relativePath}`)
      }
      assets.push({
        relativePath,
        bytes: bytes.length,
        sourceHash: hashBytes(bytes),
      })
    }
  }

  const walkNotes = async (directory: string, depth: number): Promise<void> => {
    if (depth > limits.maxDepth) {
      throw new NotesImportError(`Selected notes import root exceeds the ${limits.maxDepth} directory depth limit`)
    }
    const directoryInfo = await inspectSafeSourcePath(root, directory)
    if (!directoryInfo.isDirectory) {
      throw new NotesImportError(`Selected notes import path is not a directory: ${toSlashPath(relative(root, directory))}`)
    }
    const entries = await readdir(directoryInfo.path, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      visitEntry()
      if (entry.name.startsWith('.')) continue
      const absolutePath = join(directoryInfo.path, entry.name)
      const sourceRelativePath = toSlashPath(relative(root, absolutePath))
      if (sourceRelativePath === TEMPLATES_DIR || sourceRelativePath.startsWith(`${TEMPLATES_DIR}/`)) continue
      const inspected = await inspectSafeSourcePath(root, absolutePath)
      if (sourceRelativePath === ASSETS_DIR) {
        if (inspected.isDirectory) await walkAssets(inspected.path, depth + 1)
        continue
      }
      if (inspected.isDirectory) {
        await walkNotes(inspected.path, depth + 1)
        continue
      }
      if (!inspected.isFile || !entry.name.toLowerCase().endsWith('.md')) continue
      if (notes.length >= limits.maxNotes) {
        throw new NotesImportError(`Selected notes import root exceeds the ${limits.maxNotes} note limit`)
      }
      if (inspected.size > limits.maxNoteBytes) {
        throw new NotesImportError(`Selected notes import note exceeds the ${limits.maxNoteBytes} byte limit: ${sourceRelativePath}`)
      }
      const bytes = await readSafeSourceFile(root, sourceRelativePath, limits.maxNoteBytes)
      if (bytes.length !== inspected.size) {
        throw new NotesImportError(`Selected notes import note changed during scanning: ${sourceRelativePath}`)
      }
      const noteId = noteIdFromRelativePath(sourceRelativePath)
      notes.push({
        noteId,
        relativePath: sourceRelativePath,
        title: titleFromContent(noteId, bytes.toString('utf-8')),
        sourceHash: hashBytes(bytes),
      })
    }
  }

  await walkNotes(root, 0)
  if (notes.length === 0) {
    throw new NotesImportError('Selected import root contains no Markdown notes')
  }
  notes.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  assets.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return { notes, assets }
}

function importNamespace(sourceRoot: string): string {
  return createHash('sha256').update(sourceRoot).digest('hex').slice(0, 16)
}

function normalizeDestinationMarkdownPath(sourcePath: string): string {
  const safeSourcePath = assertPortableRelativePath(sourcePath, 'source note path')
  return `${stripMdExtension(safeSourcePath)}.md`
}

async function destinationPathExists(destinationRoot: string, destinationPath: string): Promise<boolean> {
  const safePath = assertPortableRelativePath(destinationPath, 'destination path')
  const absolutePath = resolve(destinationRoot, ...safePath.split('/'))
  if (!isPathInside(destinationRoot, absolutePath)) {
    throw new NotesImportError('Unsafe notes destination path')
  }
  try {
    const info = await lstat(absolutePath)
    if (info.isSymbolicLink()) throw new NotesImportError(`Unsafe notes destination path: symlink (${safePath})`)
    return true
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return false
    throw error
  }
}

function withImportSuffix(path: string, suffix: number): string {
  const extensionIndex = path.toLowerCase().lastIndexOf('.md')
  const stem = extensionIndex >= 0 ? path.slice(0, extensionIndex) : path
  return `${stem}-import-${suffix}.md`
}

async function allocateDestinationPath(
  destinationRoot: string,
  preferredPath: string,
  reservedPaths: Set<string>,
): Promise<string> {
  let candidate = assertPortableRelativePath(preferredPath, 'destination path')
  let suffix = 2
  while (reservedPaths.has(candidate) || await destinationPathExists(destinationRoot, candidate)) {
    candidate = withImportSuffix(preferredPath, suffix)
    suffix += 1
  }
  reservedPaths.add(candidate)
  return candidate
}

async function ensureSafeDestinationDirectory(destinationRoot: string, directory: string): Promise<void> {
  if (!isPathInside(destinationRoot, directory)) {
    throw new NotesImportError('Unsafe notes destination directory')
  }
  const relativeDirectory = relative(destinationRoot, directory)
  if (!relativeDirectory) return
  let current = destinationRoot
  for (const segment of relativeDirectory.split(sep)) {
    current = join(current, segment)
    try {
      await mkdir(current)
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error
    }
    const info = await lstat(current).catch((error) => {
      throw new NotesImportError(`Could not inspect notes destination directory: ${errorMessage(error)}`)
    })
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new NotesImportError(`Unsafe notes destination directory: ${toSlashPath(relative(destinationRoot, current))}`)
    }
    const canonical = await realpath(current).catch((error) => {
      throw new NotesImportError(`Could not resolve notes destination directory: ${errorMessage(error)}`)
    })
    if (!isPathInside(destinationRoot, canonical)) {
      throw new NotesImportError(`Unsafe notes destination directory: ${toSlashPath(relative(destinationRoot, current))}`)
    }
  }
}

async function readExistingDestinationHash(destinationRoot: string, destinationPath: string, maxBytes: number): Promise<string | null> {
  const safePath = assertPortableRelativePath(destinationPath, 'destination path')
  const absolutePath = resolve(destinationRoot, ...safePath.split('/'))
  if (!isPathInside(destinationRoot, absolutePath)) throw new NotesImportError('Unsafe notes destination path')
  try {
    const info = await lstat(absolutePath)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new NotesImportError(`Unsafe notes destination path: ${safePath}`)
    }
    if (info.size > maxBytes) {
      throw new NotesImportError(`Notes destination file exceeds the ${maxBytes} byte limit: ${safePath}`)
    }
    const canonical = await realpath(absolutePath)
    if (!isPathInside(destinationRoot, canonical)) {
      throw new NotesImportError(`Unsafe notes destination path: ${safePath}`)
    }
    return hashBytes(await readFile(canonical))
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null
    throw error
  }
}

/** Create a destination file atomically without ever replacing an existing file. */
async function materializeDestinationFile(
  destinationRoot: string,
  destinationPath: string,
  bytes: Buffer,
  maxBytes: number,
): Promise<'written' | 'already-present'> {
  const safePath = assertPortableRelativePath(destinationPath, 'destination path')
  const absolutePath = resolve(destinationRoot, ...safePath.split('/'))
  if (!isPathInside(destinationRoot, absolutePath)) throw new NotesImportError('Unsafe notes destination path')
  const expectedHash = hashBytes(bytes)
  const existing = await readExistingDestinationHash(destinationRoot, safePath, maxBytes)
  if (existing !== null) {
    if (existing === expectedHash) return 'already-present'
    throw new NotesImportError(`Notes destination already contains different content: ${safePath}`)
  }

  const parent = dirname(absolutePath)
  await ensureSafeDestinationDirectory(destinationRoot, parent)
  const tempPath = temporaryPath(parent, basename(absolutePath), 'notes-import')
  try {
    await writeFile(tempPath, bytes, { flag: 'wx' })
    try {
      // link() is an atomic create-if-absent primitive on the same filesystem.
      // It prevents an importer from overwriting a user-created race target.
      await link(tempPath, absolutePath)
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error
      const racedHash = await readExistingDestinationHash(destinationRoot, safePath, maxBytes)
      if (racedHash === expectedHash) return 'already-present'
      throw new NotesImportError(`Notes destination already contains different content: ${safePath}`)
    }
    return 'written'
  } finally {
    await unlink(tempPath).catch(() => undefined)
  }
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/)
  if (!match) return { frontmatter: '', body: content }
  return { frontmatter: match[0], body: content.slice(match[0].length) }
}

function splitMarkdownTarget(raw: string): { target: string; prefix: string; suffix: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>')
    if (end <= 1) return null
    return {
      target: trimmed.slice(1, end),
      prefix: '<',
      suffix: `>${trimmed.slice(end + 1)}`,
    }
  }
  const match = trimmed.match(/^(\S+)([\s\S]*)$/)
  if (!match) return null
  return { target: match[1], prefix: '', suffix: match[2] }
}

function splitUrlSuffix(target: string): { path: string; suffix: string } {
  const index = target.search(/[?#]/)
  return index < 0 ? { path: target, suffix: '' } : { path: target.slice(0, index), suffix: target.slice(index) }
}

function encodeMarkdownPath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function relativeMarkdownPath(fromDestinationPath: string, toDestinationPath: string): string {
  const fromDir = posix.dirname(fromDestinationPath)
  const value = posix.relative(fromDir, toDestinationPath)
  return encodeMarkdownPath(value || posix.basename(toDestinationPath))
}

function resolveSourceReference(
  rawTarget: string,
  fromSourcePath: string,
  candidates: ReadonlyMap<string, unknown>,
  preferRelative: boolean,
): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawTarget)
  } catch {
    return null
  }
  if (!decoded || decoded.includes('\0') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(decoded) || decoded.startsWith('//') || decoded.startsWith('/')) {
    return null
  }
  const sourceDir = posix.dirname(fromSourcePath)
  const relativeCandidate = normalizeReferencePath(posix.join(sourceDir, decoded))
  const rootCandidate = normalizeReferencePath(decoded)
  const ordered = preferRelative ? [relativeCandidate, rootCandidate] : [rootCandidate, relativeCandidate]
  for (const candidate of ordered) {
    if (candidate && candidates.has(candidate)) return candidate
  }
  if ((decoded.startsWith('../') || decoded === '..') && relativeCandidate === null) {
    throw new NotesImportError(`Unsafe notes import path: link target escapes selected root (${rawTarget})`)
  }
  return null
}

function rewriteImportedMarkdown(
  content: string,
  sourcePath: string,
  destinationPath: string,
  notesBySourcePath: ReadonlyMap<string, NotesMigrationMapEntry>,
  assetsBySourcePath: ReadonlyMap<string, NotesMigrationAssetMapEntry>,
): string {
  const { frontmatter, body } = splitFrontmatter(content)
  const wikilinksRewritten = body.replace(
    /\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g,
    (full, target: string, heading = '', alias = '') => {
      const sourceTarget = resolveSourceReference(target.trim(), sourcePath, notesBySourcePath, target.trim().startsWith('.'))
      if (!sourceTarget) return full
      const mapped = notesBySourcePath.get(sourceTarget)
      if (!mapped) return full
      return `[[${mapped.destinationNoteId}${heading}${alias}]]`
    },
  )
  const linksRewritten = wikilinksRewritten.replace(
    /(!?\[[^\]]*\])\(([^)\r\n]+)\)/g,
    (full, label: string, rawTarget: string) => {
      const parsed = splitMarkdownTarget(rawTarget)
      if (!parsed) return full
      const { path, suffix } = splitUrlSuffix(parsed.target)
      const assetPath = resolveSourceReference(path, sourcePath, assetsBySourcePath, true)
      if (assetPath) {
        const mapped = assetsBySourcePath.get(assetPath)
        if (!mapped) return full
        const next = `${relativeMarkdownPath(destinationPath, mapped.destinationPath)}${suffix}`
        return `${label}(${parsed.prefix}${next}${parsed.suffix})`
      }
      const notePath = resolveSourceReference(path, sourcePath, notesBySourcePath, true)
      if (notePath) {
        const mapped = notesBySourcePath.get(notePath)
        if (!mapped) return full
        const next = `${relativeMarkdownPath(destinationPath, mapped.destinationPath)}${suffix}`
        return `${label}(${parsed.prefix}${next}${parsed.suffix})`
      }
      return full
    },
  )
  return `${frontmatter}${linksRewritten}`
}

function noteMapKey(sourceRoot: string, destinationRoot: string, sourcePath: string): string {
  return `${sourceRoot}\0${destinationRoot}\0${sourcePath}`
}

function assetMapKey(sourceRoot: string, destinationRoot: string, sourcePath: string): string {
  return `${sourceRoot}\0${destinationRoot}\0${sourcePath}`
}

async function emitCheckpoint(
  callback: ImportCraftMarkdownNotesOptions['onCheckpoint'],
  stage: NotesImportCheckpointStage,
  sourcePath: string,
): Promise<void> {
  await callback?.({ stage, sourcePath })
}

async function persistMap(workspaceRoot: string, map: NotesMigrationMap): Promise<string> {
  return writeNotesMigrationMap(workspaceRoot, map)
}

/**
 * Imports Craft Markdown notes into the local Markdown Notes store.
 *
 * Checkpoints are written before each source file is materialized. A pending
 * checkpoint always owns a fixed destination path, so retrying after a failure
 * resumes rather than allocating a duplicate name.
 */
export async function importCraftMarkdownNotes(
  options: ImportCraftMarkdownNotesOptions,
): Promise<MigrateNotesResult> {
  const limits = normalizeLimits(options.limits)
  const sourceRoot = await resolveSelectedImportRoot(options.sourceRoot)
  const destinationRoot = await resolveDestinationNotesRoot(options.destinationRoot)
  if (isPathInside(sourceRoot, destinationRoot) || isPathInside(destinationRoot, sourceRoot)) {
    throw new NotesImportError('Selected notes import root and local Notes destination must not overlap')
  }
  const scanned = await scanCraftMarkdownVault(sourceRoot, limits)
  const now = options.now ?? (() => Date.now())
  const map = await readNotesMigrationMap(options.workspaceRoot)
  const namespace = importNamespace(sourceRoot)
  const reservedNotePaths = new Set(
    map.entries
      .filter((entry) => entry.destinationRoot === destinationRoot)
      .map((entry) => entry.destinationPath),
  )
  const reservedAssetPaths = new Set(
    map.assets
      .filter((entry) => entry.destinationRoot === destinationRoot)
      .map((entry) => entry.destinationPath),
  )
  const noteEntries = new Map<string, NotesMigrationMapEntry>(
    map.entries.map((entry) => [
      noteMapKey(entry.sourceRoot, entry.destinationRoot, entry.sourcePath),
      entry,
    ] as const),
  )
  const assetEntries = new Map<string, NotesMigrationAssetMapEntry>(
    map.assets.map((entry) => [
      assetMapKey(entry.sourceRoot, entry.destinationRoot, entry.sourcePath),
      entry,
    ] as const),
  )

  // Plan every note first. Link rewriting can then use stable destinations even
  // when the run is interrupted before any file is written.
  for (const note of scanned.notes) {
    const key = noteMapKey(sourceRoot, destinationRoot, note.relativePath)
    let entry = noteEntries.get(key)
    if (!entry) {
      const preferredPath = `${IMPORTS_DIR}/${namespace}/${normalizeDestinationMarkdownPath(note.relativePath)}`
      const destinationPath = await allocateDestinationPath(destinationRoot, preferredPath, reservedNotePaths)
      entry = {
        sourceRoot,
        destinationRoot,
        noteId: note.noteId,
        sourcePath: note.relativePath,
        destinationNoteId: stripMdExtension(destinationPath),
        destinationPath,
        title: note.title,
        sourceHash: note.sourceHash,
        state: 'pending',
      }
      map.entries.push(entry)
      noteEntries.set(key, entry)
      await persistMap(options.workspaceRoot, map)
      await emitCheckpoint(options.onCheckpoint, 'note-planned', note.relativePath)
      continue
    }

    validateCurrentMapEntry(entry)
    if (entry.state === 'pending' && entry.sourceHash !== note.sourceHash) {
      entry.sourceHash = note.sourceHash
      entry.title = note.title
      entry.destinationHash = undefined
      await persistMap(options.workspaceRoot, map)
      await emitCheckpoint(options.onCheckpoint, 'note-planned', note.relativePath)
    }
  }

  for (const asset of scanned.assets) {
    const key = assetMapKey(sourceRoot, destinationRoot, asset.relativePath)
    let entry = assetEntries.get(key)
    if (!entry) {
      const preferredPath = `${ASSETS_DIR}/${IMPORTS_DIR}/${namespace}/${asset.relativePath}`
      const destinationPath = await allocateDestinationPath(destinationRoot, preferredPath, reservedAssetPaths)
      entry = {
        sourceRoot,
        destinationRoot,
        sourcePath: asset.relativePath,
        destinationPath,
        bytes: asset.bytes,
        sourceHash: asset.sourceHash,
        state: 'pending',
      }
      map.assets.push(entry)
      assetEntries.set(key, entry)
      await persistMap(options.workspaceRoot, map)
      await emitCheckpoint(options.onCheckpoint, 'asset-planned', asset.relativePath)
      continue
    }

    validateCurrentAssetMapEntry(entry)
    if (entry.state === 'pending' && entry.sourceHash !== asset.sourceHash) {
      entry.sourceHash = asset.sourceHash
      entry.bytes = asset.bytes
      entry.destinationHash = undefined
      await persistMap(options.workspaceRoot, map)
      await emitCheckpoint(options.onCheckpoint, 'asset-planned', asset.relativePath)
    }
  }

  for (const asset of scanned.assets) {
    const entry = assetEntries.get(assetMapKey(sourceRoot, destinationRoot, asset.relativePath))
    if (!entry) throw new NotesImportError(`Missing asset checkpoint: ${asset.relativePath}`)
    if (entry.state === 'completed') {
      const existingHash = await readExistingDestinationHash(destinationRoot, entry.destinationPath, limits.maxAssetBytes)
      if (existingHash === entry.destinationHash) continue
      if (existingHash !== null) {
        throw new NotesImportError(`Asset checkpoint destination changed locally: ${entry.destinationPath}`)
      }
      entry.state = 'pending'
      entry.destinationHash = undefined
      entry.sourceHash = asset.sourceHash
      entry.bytes = asset.bytes
      await persistMap(options.workspaceRoot, map)
      await emitCheckpoint(options.onCheckpoint, 'asset-planned', asset.relativePath)
    }

    const bytes = await readSafeSourceFile(sourceRoot, asset.relativePath, limits.maxAssetBytes)
    const sourceHash = hashBytes(bytes)
    if (sourceHash !== entry.sourceHash) {
      throw new NotesImportError(`Selected notes import asset changed during import: ${asset.relativePath}`)
    }
    await materializeDestinationFile(destinationRoot, entry.destinationPath, bytes, limits.maxAssetBytes)
    entry.destinationHash = sourceHash
    entry.state = 'completed'
    entry.importedAt = now()
    await persistMap(options.workspaceRoot, map)
    await emitCheckpoint(options.onCheckpoint, 'asset-completed', asset.relativePath)
  }

  const notesBySourcePath = new Map<string, NotesMigrationMapEntry>()
  for (const entry of map.entries) {
    if (entry.sourceRoot === sourceRoot && entry.destinationRoot === destinationRoot) {
      notesBySourcePath.set(entry.sourcePath, entry)
      notesBySourcePath.set(stripMdExtension(entry.sourcePath), entry)
    }
  }
  const assetsBySourcePath = new Map<string, NotesMigrationAssetMapEntry>()
  for (const entry of map.assets) {
    if (entry.sourceRoot === sourceRoot && entry.destinationRoot === destinationRoot) {
      assetsBySourcePath.set(entry.sourcePath, entry)
    }
  }

  let migrated = 0
  let skipped = 0
  const failed: MigrateNotesResult['failed'] = []
  for (const note of scanned.notes) {
    const entry = noteEntries.get(noteMapKey(sourceRoot, destinationRoot, note.relativePath))
    if (!entry) throw new NotesImportError(`Missing note checkpoint: ${note.relativePath}`)
    try {
      if (entry.state === 'completed') {
        const existingHash = await readExistingDestinationHash(destinationRoot, entry.destinationPath, limits.maxNoteBytes)
        if (existingHash === entry.destinationHash) {
          skipped += 1
          continue
        }
        if (existingHash !== null) {
          throw new NotesImportError(`Note checkpoint destination changed locally: ${entry.destinationPath}`)
        }
        entry.state = 'pending'
        entry.destinationHash = undefined
        entry.sourceHash = note.sourceHash
        entry.title = note.title
        await persistMap(options.workspaceRoot, map)
        await emitCheckpoint(options.onCheckpoint, 'note-planned', note.relativePath)
      }

      const bytes = await readSafeSourceFile(sourceRoot, note.relativePath, limits.maxNoteBytes)
      if (hashBytes(bytes) !== entry.sourceHash) {
        throw new NotesImportError(`Selected notes import note changed during import: ${note.relativePath}`)
      }
      const rewritten = rewriteImportedMarkdown(
        bytes.toString('utf-8'),
        note.relativePath,
        entry.destinationPath,
        notesBySourcePath,
        assetsBySourcePath,
      )
      const destinationBytes = Buffer.from(rewritten, 'utf-8')
      await materializeDestinationFile(destinationRoot, entry.destinationPath, destinationBytes, limits.maxNoteBytes)
      entry.destinationHash = hashBytes(destinationBytes)
      entry.state = 'completed'
      entry.importedAt = now()
      await persistMap(options.workspaceRoot, map)
      await emitCheckpoint(options.onCheckpoint, 'note-completed', note.relativePath)
      migrated += 1
    } catch (error) {
      failed.push({ noteId: note.noteId, error: errorMessage(error) })
    }
  }

  const mapPath = await persistMap(options.workspaceRoot, map)
  return {
    migrated,
    skipped,
    failed,
    mapPath,
    sourceRoot,
    destinationRoot,
    format: CRAFT_MARKDOWN_IMPORT_FORMAT,
  }
}

/**
 * Generic import entry point. It deliberately accepts only Craft Markdown;
 * unsupported formats fail before the filesystem is touched.
 */
export async function importNotes(options: ImportNotesOptions): Promise<MigrateNotesResult> {
  assertNotesImportPaths({
    sourceRoot: options.sourceRoot,
    destinationRoot: options.destinationRoot,
  })
  const format = options.format?.trim() || CRAFT_MARKDOWN_IMPORT_FORMAT
  if (format !== CRAFT_MARKDOWN_IMPORT_FORMAT) {
    throw new NotesImportError(`Unsupported notes import format: ${format}`)
  }
  return importCraftMarkdownNotes(options)
}
