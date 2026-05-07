import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { getDefaultWorkspacesDir } from '@craft-agent/shared/workspaces'
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import matter from 'gray-matter'
import yaml from 'js-yaml'
import { RPC_CHANNELS, type FileAttachment, type NoteAsset, type NoteAssetRenameResult, type NoteBacklink, type NoteChangedPayload, type NoteDocument, type NoteLink, type NoteRenameImpact, type NoteSummary } from '@craft-agent/shared/protocol'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import { sanitizeFilename } from '@craft-agent/server-core/handlers'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.notes.LIST,
  RPC_CHANNELS.notes.READ,
  RPC_CHANNELS.notes.SAVE,
  RPC_CHANNELS.notes.CREATE,
  RPC_CHANNELS.notes.RENAME,
  RPC_CHANNELS.notes.DELETE,
  RPC_CHANNELS.notes.RENAME_FOLDER,
  RPC_CHANNELS.notes.DELETE_FOLDER,
  RPC_CHANNELS.notes.SEARCH,
  RPC_CHANNELS.notes.GET_BACKLINKS,
  RPC_CHANNELS.notes.GET_RENAME_IMPACT,
  RPC_CHANNELS.notes.GET_DAILY_NOTE,
  RPC_CHANNELS.notes.IMPORT_ASSET,
  RPC_CHANNELS.notes.LIST_ASSETS,
  RPC_CHANNELS.notes.DELETE_ASSET,
  RPC_CHANNELS.notes.RENAME_ASSET,
  RPC_CHANNELS.notes.UPDATE_PROPERTIES,
  RPC_CHANNELS.notes.WATCH,
  RPC_CHANNELS.notes.UNWATCH,
] as const

const NOTES_DIR = 'notes'
const ASSETS_DIR = 'assets'
const DAILY_DIR = 'daily'
const TEMPLATES_DIR = 'templates'
const DAILY_TEMPLATE_FILE = 'daily.md'

type ParsedNote = {
  properties: Record<string, unknown>
  body: string
  tags: string[]
  links: NoteLink[]
  assetRefs: string[]
}

type ClientNotesWatchState = {
  watcher: import('fs').FSWatcher
  workspaceId: string
  debounceTimer: ReturnType<typeof setTimeout> | null
}

const clientNotesWatches = new Map<string, ClientNotesWatchState>()
// noteFilePath → mtime recorded immediately after our own writeFile()
// If watcher fires and stat() mtime matches, it's our own write — suppress it.
const lastInternalMtime = new Map<string, number>()

export function cleanupNotesWatchForClient(clientId: string): void {
  const state = clientNotesWatches.get(clientId)
  if (!state) return

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
    state.debounceTimer = null
  }
  state.watcher.close()
  clientNotesWatches.delete(clientId)
}

function getWorkspaceRoot(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function getWorkspaceNotesRoot(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  // Custom notesPath takes priority; fallback to isolated app-data directory
  const config = loadWorkspaceConfig(workspace.rootPath)
  if (config?.notesPath) return config.notesPath
  return join(getDefaultWorkspacesDir(), workspaceId, NOTES_DIR)
}

function getNotesRoot(workspaceRoot: string): string {
  return join(workspaceRoot, NOTES_DIR)
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

function assertSafeNoteId(noteId: string): string {
  if (!noteId || noteId.startsWith('/') || noteId.includes('\\') || noteId.split('/').some(part => part === '..' || part === '')) {
    throw new Error('Invalid note id')
  }
  return stripMdExtension(noteId).replace(/^\/+/, '')
}

function notePathFromId(notesRoot: string, noteId: string): string {
  const safeId = assertSafeNoteId(noteId)
  const resolved = resolve(notesRoot, `${safeId}.md`)
  const normalizedRoot = resolve(notesRoot)
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error('Invalid note path')
  }
  return resolved
}

function titleFromId(noteId: string): string {
  return basename(noteId)
}

function safeNoteFilename(title: string): string {
  const safe = sanitizeFilename(title.trim() || 'Untitled').replace(/\.md$/i, '')
  return `${safe || 'Untitled'}.md`
}

async function ensureNotesDirs(notesRoot: string): Promise<void> {
  await mkdir(join(notesRoot, ASSETS_DIR), { recursive: true })
  await mkdir(join(notesRoot, DAILY_DIR), { recursive: true })
  await mkdir(join(notesRoot, TEMPLATES_DIR), { recursive: true })
}

function isInsidePath(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
}

async function listMarkdownFiles(dir: string, root = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    const rel = toSlashPath(relative(root, abs))
    if (entry.isDirectory()) {
      if (rel === ASSETS_DIR || rel.startsWith(`${ASSETS_DIR}/`)) continue
      if (rel === TEMPLATES_DIR || rel.startsWith(`${TEMPLATES_DIR}/`)) continue
      files.push(...await listMarkdownFiles(abs, root))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(abs)
    }
  }

  return files
}

function parseFrontmatter(content: string): { properties: Record<string, unknown>; body: string } {
  try {
    const parsed = matter(content)
    return { properties: parsed.data as Record<string, unknown>, body: parsed.content }
  } catch {
    return { properties: {}, body: content }
  }
}

function extractTags(body: string, properties: Record<string, unknown>): string[] {
  const tags = new Set<string>()
  const fmTags = properties.tags
  if (Array.isArray(fmTags)) {
    fmTags.forEach(tag => {
      if (typeof tag === 'string' && tag.trim()) tags.add(tag.replace(/^#/, '').trim())
    })
  } else if (typeof fmTags === 'string') {
    fmTags.split(/[,\s]+/).forEach(tag => {
      if (tag.trim()) tags.add(tag.replace(/^#/, '').trim())
    })
  }

  for (const match of body.matchAll(/(^|[\s(])#([A-Za-z0-9_/-]+)/g)) {
    tags.add(match[2])
  }
  return [...tags].sort((a, b) => a.localeCompare(b))
}

function lineForIndex(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length
}

function parseNoteContent(content: string): ParsedNote {
  const { properties, body } = parseFrontmatter(content)
  const links: NoteLink[] = []
  const assetRefs = new Set<string>()

  for (const match of content.matchAll(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g)) {
    links.push({
      target: match[1].trim(),
      ...(match[3]?.trim() ? { alias: match[3].trim() } : {}),
      line: lineForIndex(content, match.index ?? 0),
    })
  }

  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const ref = match[1].trim()
    if (ref && !/^[a-z]+:\/\//i.test(ref)) assetRefs.add(ref)
  }

  return {
    properties,
    body,
    tags: extractTags(body, properties),
    links,
    assetRefs: [...assetRefs].sort(),
  }
}

async function summarizeNote(notesRoot: string, filePath: string): Promise<NoteSummary> {
  const [content, info] = await Promise.all([
    readFile(filePath, 'utf-8'),
    stat(filePath),
  ])
  const relativePath = toSlashPath(relative(notesRoot, filePath))
  const id = noteIdFromRelativePath(relativePath)
  const parsed = parseNoteContent(content)
  const title = typeof parsed.properties.title === 'string' && parsed.properties.title.trim()
    ? parsed.properties.title.trim()
    : titleFromId(id)

  return {
    id,
    title,
    path: filePath,
    relativePath,
    tags: parsed.tags,
    properties: parsed.properties,
    links: parsed.links,
    assetRefs: parsed.assetRefs,
    updatedAt: info.mtimeMs,
    createdAt: info.birthtimeMs,
    size: info.size,
  }
}

async function listNotes(notesRoot: string): Promise<NoteSummary[]> {
  await ensureNotesDirs(notesRoot)
  const files = await listMarkdownFiles(notesRoot)
  const notes = await Promise.all(files.map(file => summarizeNote(notesRoot, file)))
  notes.sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title))
  return notes
}

function noteMatchesTarget(note: NoteSummary, target: string): boolean {
  const normalized = stripMdExtension(target.trim()).toLowerCase()
  return normalized === note.id.toLowerCase()
    || normalized === note.title.toLowerCase()
    || normalized === titleFromId(note.id).toLowerCase()
}

async function getBacklinks(notesRoot: string, noteId: string): Promise<NoteBacklink[]> {
  await ensureNotesDirs(notesRoot)
  const notes = await listNotes(notesRoot)
  const target = notes.find(note => note.id === noteId)
  if (!target) return []

  const backlinks: NoteBacklink[] = []
  for (const note of notes) {
    if (note.id === target.id) continue
    const matchingLinks = note.links.filter(link => noteMatchesTarget(target, link.target))
    if (matchingLinks.length === 0) continue
    const content = await readFile(join(notesRoot, note.relativePath), 'utf-8')
    const lines = content.split(/\r?\n/)
    for (const link of matchingLinks) {
      backlinks.push({
        noteId: note.id,
        title: note.title,
        path: note.path,
        line: link.line,
        preview: (lines[link.line - 1] ?? '').trim(),
      })
    }
  }
  return backlinks
}

async function readNote(notesRoot: string, noteId: string): Promise<NoteDocument> {
  await ensureNotesDirs(notesRoot)
  const filePath = notePathFromId(notesRoot, noteId)
  const [summary, content, backlinks] = await Promise.all([
    summarizeNote(notesRoot, filePath),
    readFile(filePath, 'utf-8'),
    getBacklinks(notesRoot, assertSafeNoteId(noteId)),
  ])
  return { ...summary, content, backlinks }
}

function buildInitialNoteContent(title: string): string {
  return stringifyNoteContent('', { title, tags: [] })
}

function stringifyNoteContent(body: string, properties: Record<string, unknown>): string {
  const frontmatter = yaml.dump(properties, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: (a, b) => {
      if (a === 'title') return -1
      if (b === 'title') return 1
      if (a === 'tags') return -1
      if (b === 'tags') return 1
      return String(a).localeCompare(String(b))
    },
  }).trimEnd()
  return `---\n${frontmatter}\n---\n\n${body.replace(/^\n+/, '')}`
}

function updateFrontmatterTitle(content: string, title: string): string {
  const { properties, body } = parseFrontmatter(content)
  return stringifyNoteContent(body, { ...properties, title })
}

function updateFrontmatterProperties(content: string, nextProperties: Record<string, unknown>): string {
  const { body } = parseFrontmatter(content)
  return stringifyNoteContent(body, nextProperties)
}

async function createNote(notesRoot: string, title: string, folder?: string): Promise<NoteDocument> {
  await ensureNotesDirs(notesRoot)
  const safeFolder = folder ? assertSafeNoteId(folder) : ''
  const dir = safeFolder ? resolve(notesRoot, safeFolder) : notesRoot
  if (!dir.startsWith(resolve(notesRoot))) throw new Error('Invalid note folder')
  await mkdir(dir, { recursive: true })

  let filePath = join(dir, safeNoteFilename(title))
  let suffix = 2
  while (existsSync(filePath)) {
    filePath = join(dir, `${sanitizeFilename(title || 'Untitled')}-${suffix++}.md`)
  }
  await writeFile(filePath, buildInitialNoteContent(title || 'Untitled'), 'utf-8')
  return readNote(notesRoot, noteIdFromRelativePath(relative(notesRoot, filePath)))
}

async function saveNote(notesRoot: string, noteId: string, content: string): Promise<NoteDocument> {
  await ensureNotesDirs(notesRoot)
  const filePath = notePathFromId(notesRoot, noteId)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
  // Record the exact mtime of our write so the watcher can recognize it as internal
  const { mtimeMs } = await stat(filePath)
  lastInternalMtime.set(filePath, mtimeMs)
  return readNote(notesRoot, noteId)
}

function replaceWikiTargets(content: string, oldTargets: Set<string>, newTarget: string): { content: string; replacements: number } {
  let replacements = 0
  const next = content.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g, (full, target: string, heading = '', alias = '') => {
    if (!oldTargets.has(stripMdExtension(target.trim()).toLowerCase())) return full
    replacements++
    return `[[${newTarget}${heading}${alias}]]`
  })
  return { content: next, replacements }
}

async function getRenameImpact(notesRoot: string, noteId: string, nextTitle: string): Promise<NoteRenameImpact> {
  await ensureNotesDirs(notesRoot)
  const oldPath = notePathFromId(notesRoot, noteId)
  const oldSummary = await summarizeNote(notesRoot, oldPath)
  const newPath = join(dirname(oldPath), safeNoteFilename(nextTitle))
  if (oldPath !== newPath && existsSync(newPath)) throw new Error(`A note named "${nextTitle}" already exists`)

  const newId = noteIdFromRelativePath(relative(notesRoot, newPath))
  const newTarget = titleFromId(newId)
  const oldTargets = new Set([
    oldSummary.id,
    oldSummary.title,
    titleFromId(oldSummary.id),
  ].map(value => stripMdExtension(value).toLowerCase()))

  const updatedNotes: NoteRenameImpact['updatedNotes'] = []
  const files = await listMarkdownFiles(notesRoot)
  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    const result = replaceWikiTargets(content, oldTargets, newTarget)
    if (result.replacements > 0) {
      const summary = await summarizeNote(notesRoot, file)
      updatedNotes.push({
        noteId: summary.id,
        title: summary.title,
        path: file,
        replacements: result.replacements,
      })
    }
  }

  return {
    noteId: oldSummary.id,
    nextNoteId: newId,
    nextTitle,
    updatedNotes,
    totalReplacements: updatedNotes.reduce((sum, note) => sum + note.replacements, 0),
  }
}

async function renameNote(notesRoot: string, noteId: string, nextTitle: string): Promise<{ note: NoteDocument; updatedNotes: Array<{ noteId: string; path: string; replacements: number }> }> {
  await ensureNotesDirs(notesRoot)
  const oldPath = notePathFromId(notesRoot, noteId)
  const oldSummary = await summarizeNote(notesRoot, oldPath)
  const newPath = join(dirname(oldPath), safeNoteFilename(nextTitle))
  if (oldPath !== newPath && existsSync(newPath)) throw new Error(`A note named "${nextTitle}" already exists`)

  if (oldPath !== newPath) {
    await rename(oldPath, newPath)
  }

  const newId = noteIdFromRelativePath(relative(notesRoot, newPath))
  const newTarget = titleFromId(newId)
  const renamedContent = await readFile(newPath, 'utf-8')
  await writeFile(newPath, updateFrontmatterTitle(renamedContent, nextTitle), 'utf-8')
  const oldTargets = new Set([
    oldSummary.id,
    oldSummary.title,
    titleFromId(oldSummary.id),
  ].map(value => stripMdExtension(value).toLowerCase()))

  const updatedNotes: Array<{ noteId: string; path: string; replacements: number }> = []
  const files = await listMarkdownFiles(notesRoot)
  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    const result = replaceWikiTargets(content, oldTargets, newTarget)
    if (result.replacements > 0) {
      await writeFile(file, result.content, 'utf-8')
      updatedNotes.push({
        noteId: noteIdFromRelativePath(relative(notesRoot, file)),
        path: file,
        replacements: result.replacements,
      })
    }
  }

  return { note: await readNote(notesRoot, newId), updatedNotes }
}

async function updateNoteProperties(notesRoot: string, noteId: string, properties: Record<string, unknown>): Promise<NoteDocument> {
  await ensureNotesDirs(notesRoot)
  const filePath = notePathFromId(notesRoot, noteId)
  const content = await readFile(filePath, 'utf-8')
  await writeFile(filePath, updateFrontmatterProperties(content, properties), 'utf-8')
  return readNote(notesRoot, noteId)
}

function formatDateId(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function todayDateString(): string {
  const d = new Date()
  return formatDateId(d)
}

function assertDailyDate(date?: string): string {
  const value = date?.trim() || todayDateString()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid daily note date')
  return value
}

function dailyId(date?: string): string {
  return `${DAILY_DIR}/${assertDailyDate(date)}`
}

function shiftDate(date: string, deltaDays: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  d.setDate(d.getDate() + deltaDays)
  return formatDateId(d)
}

async function buildDailyNoteContent(notesRoot: string, date: string): Promise<string> {
  const templatePath = join(notesRoot, TEMPLATES_DIR, DAILY_TEMPLATE_FILE)
  const fallback = [
    '---',
    'title: "{{date}}"',
    'tags:',
    '  - daily',
    '---',
    '',
    '# {{date}}',
    '',
  ].join('\n')
  const template = await readFile(templatePath, 'utf-8').catch(() => fallback)
  return template
    .replaceAll('{{date}}', date)
    .replaceAll('{{title}}', date)
    .replaceAll('{{yesterday}}', shiftDate(date, -1))
    .replaceAll('{{tomorrow}}', shiftDate(date, 1))
}

function mimeFromName(name: string): string {
  const ext = extname(name).toLowerCase()
  if (['.png'].includes(ext)) return 'image/png'
  if (['.jpg', '.jpeg'].includes(ext)) return 'image/jpeg'
  if (['.gif'].includes(ext)) return 'image/gif'
  if (['.webp'].includes(ext)) return 'image/webp'
  if (['.svg'].includes(ext)) return 'image/svg+xml'
  if (['.pdf'].includes(ext)) return 'application/pdf'
  if (['.md', '.txt'].includes(ext)) return 'text/plain'
  if (['.json'].includes(ext)) return 'application/json'
  return 'application/octet-stream'
}

function noteIdFromWatchFilename(filename: string | Buffer | null): string | undefined {
  if (!filename) return undefined
  const rel = toSlashPath(filename.toString())
  if (!rel || rel.startsWith('.') || rel.includes('/.') || rel.startsWith(`${ASSETS_DIR}/`) || rel.startsWith(`${TEMPLATES_DIR}/`)) return undefined
  if (!rel.toLowerCase().endsWith('.md')) return undefined
  return noteIdFromRelativePath(rel)
}

// Returns true if this file change was caused by our own writeFile() call.
// Compares current on-disk mtime against the mtime we recorded after writing.
async function isOwnWrite(filePath: string): Promise<boolean> {
  const recorded = lastInternalMtime.get(filePath)
  if (recorded === undefined) return false
  try {
    const { mtimeMs } = await stat(filePath)
    if (mtimeMs === recorded) {
      // Consume the record — a second watcher event for the same mtime is external
      lastInternalMtime.delete(filePath)
      return true
    }
  } catch {
    // File deleted or inaccessible — treat as external
  }
  return false
}

async function importAsset(notesRoot: string, attachment: FileAttachment): Promise<{ asset: { name: string; path: string; relativePath: string; size: number; mimeType: string }; markdown: string }> {
  await ensureNotesDirs(notesRoot)
  const assetsRoot = join(notesRoot, ASSETS_DIR)
  await mkdir(assetsRoot, { recursive: true })

  const safeName = sanitizeFilename(attachment.name || basename(attachment.path || 'asset'))
  let assetPath = join(assetsRoot, safeName)
  let suffix = 2
  const parsedExt = extname(safeName)
  const parsedBase = parsedExt ? safeName.slice(0, -parsedExt.length) : safeName
  while (existsSync(assetPath)) {
    assetPath = join(assetsRoot, `${parsedBase}-${suffix++}${parsedExt}`)
  }

  let buffer: Buffer
  if (attachment.base64) {
    buffer = Buffer.from(attachment.base64, 'base64')
  } else if (attachment.text != null) {
    buffer = Buffer.from(attachment.text, 'utf-8')
  } else {
    buffer = await readFile(attachment.path)
  }

  await writeFile(assetPath, buffer)
  const relativePath = toSlashPath(relative(notesRoot, assetPath))
  const mimeType = attachment.mimeType || mimeFromName(assetPath)
  const isImage = mimeType.startsWith('image/')
  return {
    asset: {
      name: basename(assetPath),
      path: assetPath,
      relativePath,
      size: buffer.length,
      mimeType,
    },
    markdown: isImage ? `![${basename(assetPath)}](${relativePath})` : `[${basename(assetPath)}](${relativePath})`,
  }
}

async function listAssetFiles(dir: string, root = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listAssetFiles(abs, root))
    } else if (entry.isFile()) {
      files.push(abs)
    }
  }

  return files
}

function normalizeAssetRef(ref: string): string {
  try {
    return decodeURIComponent(ref.trim()).replace(/\\/g, '/').replace(/^\.\//, '')
  } catch {
    return ref.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  }
}

function assetPathFromRelative(notesRoot: string, relativePath: string): string {
  const normalized = normalizeAssetRef(relativePath)
  if (!normalized.startsWith(`${ASSETS_DIR}/`) || normalized.includes('\0')) throw new Error('Invalid asset path')
  const resolved = resolve(notesRoot, normalized)
  const assetsRoot = resolve(notesRoot, ASSETS_DIR)
  if (!isInsidePath(assetsRoot, resolved)) throw new Error('Invalid asset path')
  return resolved
}

async function listAssets(notesRoot: string): Promise<NoteAsset[]> {
  await ensureNotesDirs(notesRoot)
  const assetsRoot = join(notesRoot, ASSETS_DIR)
  const [files, notes] = await Promise.all([
    listAssetFiles(assetsRoot, notesRoot),
    listNotes(notesRoot),
  ])

  const notesByAsset = new Map<string, Array<{ noteId: string; title: string }>>()
  for (const note of notes) {
    for (const ref of note.assetRefs) {
      const normalized = normalizeAssetRef(ref)
      const variants = new Set([normalized])
      if (!normalized.startsWith(`${ASSETS_DIR}/`)) variants.add(`${ASSETS_DIR}/${basename(normalized)}`)
      for (const variant of variants) {
        const entries = notesByAsset.get(variant) ?? []
        entries.push({ noteId: note.id, title: note.title })
        notesByAsset.set(variant, entries)
      }
    }
  }

  const assets = await Promise.all(files.map(async file => {
    const info = await stat(file)
    const relativePath = toSlashPath(relative(notesRoot, file))
    return {
      name: basename(file),
      path: file,
      relativePath,
      size: info.size,
      mimeType: mimeFromName(file),
      referencedBy: notesByAsset.get(relativePath) ?? [],
    }
  }))
  return assets.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function replaceAssetTargets(content: string, oldRelativePath: string, newRelativePath: string): { content: string; replacements: number } {
  let replacements = 0
  const oldNormalized = normalizeAssetRef(oldRelativePath)
  const oldBasename = basename(oldNormalized)
  const next = content.replace(/(!?\[[^\]]*\]\()([^)]+)(\))/g, (full, prefix: string, ref: string, suffix: string) => {
    const normalizedRef = normalizeAssetRef(ref)
    const matches = normalizedRef === oldNormalized || normalizedRef === `./${oldNormalized}` || normalizedRef === oldBasename
    if (!matches) return full
    replacements++
    return `${prefix}${newRelativePath}${suffix}`
  })
  return { content: next, replacements }
}

async function deleteAsset(notesRoot: string, relativePath: string): Promise<boolean> {
  await ensureNotesDirs(notesRoot)
  const assetPath = assetPathFromRelative(notesRoot, relativePath)
  const assets = await listAssets(notesRoot)
  const asset = assets.find(item => item.relativePath === normalizeAssetRef(relativePath))
  if ((asset?.referencedBy?.length ?? 0) > 0) {
    throw new Error(`Asset is still referenced by ${asset?.referencedBy?.length} note${asset?.referencedBy?.length === 1 ? '' : 's'}`)
  }
  await unlink(assetPath)
  return true
}

async function renameAsset(notesRoot: string, relativePath: string, nextName: string): Promise<NoteAssetRenameResult> {
  await ensureNotesDirs(notesRoot)
  const oldPath = assetPathFromRelative(notesRoot, relativePath)
  const safeName = sanitizeFilename(nextName.trim() || basename(oldPath))
  if (!safeName) throw new Error('Invalid asset name')
  const newPath = join(dirname(oldPath), safeName)
  if (!isInsidePath(resolve(notesRoot, ASSETS_DIR), newPath)) throw new Error('Invalid asset path')
  if (newPath !== oldPath && existsSync(newPath)) throw new Error(`An asset named "${safeName}" already exists`)

  if (newPath !== oldPath) {
    await rename(oldPath, newPath)
  }

  const oldRelativePath = normalizeAssetRef(relativePath)
  const newRelativePath = toSlashPath(relative(notesRoot, newPath))
  const updatedNotes: NoteAssetRenameResult['updatedNotes'] = []
  const files = await listMarkdownFiles(notesRoot)
  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    const result = replaceAssetTargets(content, oldRelativePath, newRelativePath)
    if (result.replacements > 0) {
      await writeFile(file, result.content, 'utf-8')
      updatedNotes.push({
        noteId: noteIdFromRelativePath(relative(notesRoot, file)),
        path: file,
        replacements: result.replacements,
      })
    }
  }

  const info = await stat(newPath)
  return {
    asset: {
      name: basename(newPath),
      path: newPath,
      relativePath: newRelativePath,
      size: info.size,
      mimeType: mimeFromName(newPath),
      referencedBy: (await listAssets(notesRoot)).find(item => item.relativePath === newRelativePath)?.referencedBy ?? [],
    },
    updatedNotes,
  }
}

async function renameFolder(notesRoot: string, folder: string, nextName: string): Promise<{ movedNotes: string[] }> {
  await ensureNotesDirs(notesRoot)
  const safeFolder = assertSafeNoteId(folder)
  const oldDir = resolve(notesRoot, safeFolder)
  if (!isInsidePath(notesRoot, oldDir)) throw new Error('Invalid folder path')
  if (!existsSync(oldDir)) throw new Error(`Folder not found: ${folder}`)

  const parentDir = dirname(oldDir)
  const safeName = sanitizeFilename(nextName.trim() || basename(oldDir))
  const newDir = join(parentDir, safeName)
  if (!isInsidePath(notesRoot, newDir)) throw new Error('Invalid target folder path')
  if (newDir !== oldDir && existsSync(newDir)) throw new Error(`A folder named "${safeName}" already exists`)

  const oldPrefix = toSlashPath(relative(notesRoot, oldDir))
  const newPrefix = toSlashPath(relative(notesRoot, newDir))

  const oldTargetsByNote = new Map<string, Set<string>>()
  const allFiles = await listMarkdownFiles(notesRoot)
  for (const file of allFiles) {
    const rel = toSlashPath(relative(notesRoot, file))
    if (rel.startsWith(`${oldPrefix}/`) || rel === `${oldPrefix}.md`) {
      const content = await readFile(file, 'utf-8')
      const parsed = parseNoteContent(content)
      const targets = new Set([
        noteIdFromRelativePath(rel),
        ...parsed.links.map(l => l.target),
      ])
      oldTargetsByNote.set(file, targets)
    }
  }

  if (newDir !== oldDir) {
    await rename(oldDir, newDir)
  }

  const newFiles = await listMarkdownFiles(newDir, notesRoot)
  const movedNotes: string[] = []
  for (const file of newFiles) {
    const newRel = toSlashPath(relative(notesRoot, file))
    const oldRel = newRel.replace(newPrefix, oldPrefix)
    const oldId = noteIdFromRelativePath(oldRel)
    const newId = noteIdFromRelativePath(newRel)
    movedNotes.push(newId)

    const oldTargets = new Set([
      oldId,
      titleFromId(oldId),
      basename(oldId),
    ].map(v => stripMdExtension(v).toLowerCase()))

    for (const otherFile of allFiles) {
      if (newFiles.includes(otherFile)) continue
      const content = await readFile(otherFile, 'utf-8').catch(() => '')
      const result = replaceWikiTargets(content, oldTargets, titleFromId(newId))
      if (result.replacements > 0) {
        await writeFile(otherFile, result.content, 'utf-8')
      }
    }
  }

  return { movedNotes }
}

async function deleteFolder(notesRoot: string, folder: string): Promise<{ deletedNotes: string[] }> {
  await ensureNotesDirs(notesRoot)
  const safeFolder = assertSafeNoteId(folder)
  const dir = resolve(notesRoot, safeFolder)
  if (!isInsidePath(notesRoot, dir)) throw new Error('Invalid folder path')
  if (!existsSync(dir)) throw new Error(`Folder not found: ${folder}`)

  const files = await listMarkdownFiles(dir, notesRoot)
  const deletedNotes = files.map(f => noteIdFromRelativePath(relative(notesRoot, f)))

  await rm(dir, { recursive: true, force: true })
  return { deletedNotes }
}

export function registerNotesHandlers(server: RpcServer, _deps: HandlerDeps): void {
  const changed = (payload: NoteChangedPayload, target: { to: 'workspace'; workspaceId: string } | { to: 'client'; clientId: string } = { to: 'workspace', workspaceId: payload.workspaceId }) => {
    pushTyped(server, RPC_CHANNELS.notes.CHANGED, target, payload)
  }

  server.handle(RPC_CHANNELS.notes.LIST, async (_ctx, workspaceId: string) => {
    return listNotes(getWorkspaceNotesRoot(workspaceId))
  })

  server.handle(RPC_CHANNELS.notes.READ, async (_ctx, workspaceId: string, noteId: string) => {
    return readNote(getWorkspaceNotesRoot(workspaceId), noteId)
  })

  server.handle(RPC_CHANNELS.notes.SAVE, async (_ctx, workspaceId: string, noteId: string, content: string) => {
    const note = await saveNote(getWorkspaceNotesRoot(workspaceId), noteId, content)
    changed({ workspaceId, reason: 'save', noteId: note.id })
    return note
  })

  server.handle(RPC_CHANNELS.notes.CREATE, async (_ctx, workspaceId: string, title: string, folder?: string) => {
    const note = await createNote(getWorkspaceNotesRoot(workspaceId), title, folder)
    changed({ workspaceId, reason: 'create', noteId: note.id })
    return note
  })

  server.handle(RPC_CHANNELS.notes.RENAME, async (_ctx, workspaceId: string, noteId: string, nextTitle: string) => {
    const result = await renameNote(getWorkspaceNotesRoot(workspaceId), noteId, nextTitle)
    changed({ workspaceId, reason: 'rename', noteId: result.note.id })
    return result
  })

  server.handle(RPC_CHANNELS.notes.DELETE, async (_ctx, workspaceId: string, noteId: string) => {
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    await ensureNotesDirs(notesRoot)
    await unlink(notePathFromId(notesRoot, noteId))
    changed({ workspaceId, reason: 'delete', noteId })
    return true
  })

  server.handle(RPC_CHANNELS.notes.RENAME_FOLDER, async (_ctx, workspaceId: string, folder: string, nextName: string) => {
    const result = await renameFolder(getWorkspaceNotesRoot(workspaceId), folder, nextName)
    changed({ workspaceId, reason: 'rename' })
    return result
  })

  server.handle(RPC_CHANNELS.notes.DELETE_FOLDER, async (_ctx, workspaceId: string, folder: string) => {
    const result = await deleteFolder(getWorkspaceNotesRoot(workspaceId), folder)
    changed({ workspaceId, reason: 'delete' })
    return result
  })

  server.handle(RPC_CHANNELS.notes.SEARCH, async (_ctx, workspaceId: string, query: string) => {
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    const notes = await listNotes(notesRoot)
    const q = query.trim().toLowerCase()
    if (!q) return notes
    await ensureNotesDirs(notesRoot)

    const results = await Promise.allSettled(
      notes.map(async note => {
        if (note.title.toLowerCase().includes(q) || note.tags.some(tag => tag.toLowerCase().includes(q))) {
          return note
        }
        const content = await readFile(join(notesRoot, note.relativePath), 'utf-8').catch(() => '')
        return content.toLowerCase().includes(q) ? note : null
      })
    )

    return results
      .filter((r): r is PromiseFulfilledResult<NoteSummary> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value)
  })

  server.handle(RPC_CHANNELS.notes.GET_BACKLINKS, async (_ctx, workspaceId: string, noteId: string) => {
    return getBacklinks(getWorkspaceNotesRoot(workspaceId), noteId)
  })

  server.handle(RPC_CHANNELS.notes.GET_RENAME_IMPACT, async (_ctx, workspaceId: string, noteId: string, nextTitle: string) => {
    return getRenameImpact(getWorkspaceNotesRoot(workspaceId), noteId, nextTitle)
  })

  server.handle(RPC_CHANNELS.notes.GET_DAILY_NOTE, async (_ctx, workspaceId: string, date?: string) => {
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    const dailyDate = assertDailyDate(date)
    const id = dailyId(dailyDate)
    await ensureNotesDirs(notesRoot)
    const filePath = notePathFromId(notesRoot, id)
    if (!existsSync(filePath)) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, await buildDailyNoteContent(notesRoot, dailyDate), 'utf-8')
      changed({ workspaceId, reason: 'create', noteId: id })
    }
    return readNote(notesRoot, id)
  })

  server.handle(RPC_CHANNELS.notes.IMPORT_ASSET, async (_ctx, workspaceId: string, attachment: FileAttachment) => {
    const result = await importAsset(getWorkspaceNotesRoot(workspaceId), attachment)
    changed({ workspaceId, reason: 'asset' })
    return result
  })

  server.handle(RPC_CHANNELS.notes.LIST_ASSETS, async (_ctx, workspaceId: string) => {
    return listAssets(getWorkspaceNotesRoot(workspaceId))
  })

  server.handle(RPC_CHANNELS.notes.DELETE_ASSET, async (_ctx, workspaceId: string, relativePath: string) => {
    const result = await deleteAsset(getWorkspaceNotesRoot(workspaceId), relativePath)
    changed({ workspaceId, reason: 'asset' })
    return result
  })

  server.handle(RPC_CHANNELS.notes.RENAME_ASSET, async (_ctx, workspaceId: string, relativePath: string, nextName: string) => {
    const result = await renameAsset(getWorkspaceNotesRoot(workspaceId), relativePath, nextName)
    changed({ workspaceId, reason: 'asset' })
    return result
  })

  server.handle(RPC_CHANNELS.notes.UPDATE_PROPERTIES, async (_ctx, workspaceId: string, noteId: string, properties: Record<string, unknown>) => {
    const note = await updateNoteProperties(getWorkspaceNotesRoot(workspaceId), noteId, properties)
    changed({ workspaceId, reason: 'properties', noteId: note.id })
    return note
  })

  server.handle(RPC_CHANNELS.notes.WATCH, async (ctx, workspaceId: string) => {
    const clientId = ctx.clientId
    cleanupNotesWatchForClient(clientId)
    const notesRoot = getWorkspaceNotesRoot(workspaceId)
    await ensureNotesDirs(notesRoot)

    try {
      const { watch } = await import('fs')
      const state: ClientNotesWatchState = {
        watcher: null as unknown as import('fs').FSWatcher,
        workspaceId,
        debounceTimer: null,
      }

      state.watcher = watch(notesRoot, { recursive: true }, (_eventType, filename) => {
        const noteId = noteIdFromWatchFilename(filename)
        if (filename && !noteId) return

        // Resolve absolute path for mtime comparison (filename is relative to watched dir)
        const absPath = filename ? join(notesRoot, filename.toString()) : null

        if (state.debounceTimer) clearTimeout(state.debounceTimer)
        state.debounceTimer = setTimeout(async () => {
          if (absPath && await isOwnWrite(absPath)) return
          changed({ workspaceId, reason: 'external', noteId }, { to: 'client', clientId })
        }, 50)
      })

      clientNotesWatches.set(clientId, state)
    } catch (error) {
      throw new Error(`Failed to watch notes: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  server.handle(RPC_CHANNELS.notes.UNWATCH, async (ctx) => {
    cleanupNotesWatchForClient(ctx.clientId)
  })
}
