import * as React from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, FileDown, FilePlus2, FileText, Folder, FolderInput, FolderOpen, FolderPlus, Link2, Paperclip, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { DndContext, useDraggable, useDroppable, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { TiptapMarkdownEditor, type TiptapEditorHandle } from '@craft-agent/ui'
import type { FileAttachment, NoteAsset, NoteChangedPayload, NoteDocument, NoteRenameImpact, NoteSummary } from '../../shared/types'
import { useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuTrigger, StyledContextMenuContent, StyledContextMenuItem, StyledContextMenuSeparator } from '@/components/ui/styled-context-menu'
import { NoteInspector } from './notes/NoteInspector'
import type { NoteTask } from './notes/NoteInspector'
import { NotesAIMenu } from './notes/NotesAIMenu'
import type { AIActionMode } from './notes/NotesAIMenu'
import { NotesDialogs } from './notes/NotesDialogs'

interface NotesPageProps {
  selectedNoteId: string | null
}

function noteRelativeLabel(note: NoteSummary): string {
  return note.relativePath.replace(/\.md$/i, '')
}

function stripMdExtension(path: string): string {
  return path.toLowerCase().endsWith('.md') ? path.slice(0, -3) : path
}

function normalizeNoteTarget(value: string): string {
  return stripMdExtension(value.trim()).toLowerCase()
}

function baseNoteTitle(noteId: string): string {
  return noteId.split('/').pop() || noteId
}

function findNoteByTarget(notes: NoteSummary[], target: string): NoteSummary | null {
  const normalized = normalizeNoteTarget(target)
  return notes.find(note =>
    normalizeNoteTarget(note.id) === normalized
    || normalizeNoteTarget(note.title) === normalized
    || normalizeNoteTarget(baseNoteTitle(note.id)) === normalized
  ) ?? null
}

function filterNotes(notes: NoteSummary[], query: string, tag: string | null): NoteSummary[] {
  const q = query.trim().toLowerCase()
  return notes.filter(note => {
    if (tag && !note.tags.includes(tag)) return false
    if (!q) return true
    return note.title.toLowerCase().includes(q)
      || note.relativePath.toLowerCase().includes(q)
      || note.tags.some(noteTag => noteTag.toLowerCase().includes(q))
  })
}

function parsePropertyInput(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map(v => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  }
  return trimmed.replace(/^['"]|['"]$/g, '')
}

function inputToProperty(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed.includes(',')) return trimmed.split(',').map(part => part.trim()).filter(Boolean)
  return parsePropertyInput(trimmed)
}

function normalizeChangedPayload(payload: NoteChangedPayload | string): NoteChangedPayload {
  return typeof payload === 'string' ? { workspaceId: payload } : payload
}

function todayDateString(): string {
  const date = new Date()
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function shiftDateString(value: string, deltaDays: number): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + deltaDays)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function parseDailyNoteDate(noteId?: string): string | null {
  const match = noteId?.match(/^daily\/(\d{4}-\d{2}-\d{2})$/)
  return match?.[1] ?? null
}

function splitFrontmatter(value: string): { frontmatter: string; body: string } {
  const match = value.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/)
  if (!match) return { frontmatter: '', body: value }
  const frontmatter = match[0].replace(/\s*$/, '\n\n')
  return { frontmatter, body: value.slice(match[0].length).replace(/^\r?\n/, '') }
}

function mergeFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body
  return `${frontmatter}${body.replace(/^\r?\n/, '')}`
}

function findRichWikiQuery(editor: TiptapEditorHandle | null): string | null {
  if (!editor) return null
  const from = editor.state.selection.from
  const textBefore = editor.state.doc.textBetween(Math.max(0, from - 140), from, '\n', '\n')
  const match = textBefore.match(/\[\[([^\]\n]*)$/)
  return match ? match[1] : null
}

function findRichWikiQueryRange(editor: TiptapEditorHandle | null): { from: number; to: number } | null {
  if (!editor) return null
  const to = editor.state.selection.from
  const textBefore = editor.state.doc.textBetween(Math.max(0, to - 140), to, '\n', '\n')
  const match = textBefore.match(/\[\[([^\]\n]*)$/)
  if (!match) return null
  return { from: to - match[0].length, to }
}

function findRichWikiLinkAtCursor(editor: TiptapEditorHandle | null): string | null {
  if (!editor) return null
  const cursor = editor.state.selection.from
  const before = editor.state.doc.textBetween(Math.max(0, cursor - 200), cursor, '\n', '\n')
  const after = editor.state.doc.textBetween(cursor, Math.min(editor.state.doc.content.size, cursor + 200), '\n', '\n')
  const open = before.lastIndexOf('[[')
  const close = after.indexOf(']]')
  if (open === -1 || close === -1) return null
  const raw = `${before.slice(open + 2)}${after.slice(0, close)}`
  return raw.split('|')[0]?.split('#')[0]?.trim() || null
}

function classifyAttachment(file: File): FileAttachment['type'] {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type.startsWith('text/')) return 'text'
  if (/word|excel|powerpoint|officedocument/i.test(file.type)) return 'office'
  return 'unknown'
}

async function fileToAttachment(file: File): Promise<FileAttachment> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return {
    type: classifyAttachment(file),
    path: window.electronAPI.getFilePath(file) ?? '',
    name: file.name || 'attachment',
    mimeType: file.type || 'application/octet-stream',
    base64: btoa(binary),
    size: file.size,
  }
}

function noteFolder(note: NoteSummary): string {
  const parts = note.id.split('/')
  parts.pop()
  return parts.join('/')
}

function extractTasks(note: NoteDocument | NoteSummary, content: string): NoteTask[] {
  return content.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/)
    if (!match) return []
    return [{
      noteId: note.id,
      noteTitle: note.title,
      line: index + 1,
      text: match[2].trim(),
      checked: match[1].toLowerCase() === 'x',
    }]
  })
}

function updateMarkdownTitle(content: string, title: string): string {
  const escaped = title.replace(/"/g, '\\"')
  if (/^---\r?\n[\s\S]*?\r?\n---/.test(content)) {
    if (/^---\r?\n[\s\S]*?\r?\ntitle\s*:/m.test(content)) {
      return content.replace(/(^---\r?\n[\s\S]*?\r?\ntitle\s*:\s*).+$/m, `$1"${escaped}"`)
    }
    return content.replace(/^---\r?\n/, `---\ntitle: "${escaped}"\n`)
  }
  return content
}

// ── Folder tree types & builder ──────────────────────────────────────────────

interface FolderTreeNode {
  /** Full path from vault root, e.g. "1-Daily/2026/05" */
  fullPath: string
  /** Display segment, e.g. "05" */
  name: string
  children: FolderTreeNode[]
  notes: NoteSummary[]
}

function buildFolderTree(notes: NoteSummary[]): { rootNotes: NoteSummary[]; folders: FolderTreeNode[] } {
  const rootNotes: NoteSummary[] = []
  // Map from fullPath → node
  const nodeMap = new Map<string, FolderTreeNode>()

  function getOrCreate(fullPath: string): FolderTreeNode {
    if (nodeMap.has(fullPath)) return nodeMap.get(fullPath)!
    const segments = fullPath.split('/')
    const name = segments[segments.length - 1] ?? fullPath
    const node: FolderTreeNode = { fullPath, name, children: [], notes: [] }
    nodeMap.set(fullPath, node)
    return node
  }

  for (const note of notes) {
    const folder = noteFolder(note)
    if (!folder) {
      rootNotes.push(note)
      continue
    }
    // Ensure all ancestor nodes exist
    const segments = folder.split('/')
    for (let i = 1; i <= segments.length; i++) {
      getOrCreate(segments.slice(0, i).join('/'))
    }
    getOrCreate(folder).notes.push(note)
  }

  // Wire parent→child relationships
  const topLevel: FolderTreeNode[] = []
  for (const [fullPath, node] of nodeMap) {
    const segments = fullPath.split('/')
    if (segments.length === 1) {
      topLevel.push(node)
    } else {
      const parentPath = segments.slice(0, -1).join('/')
      const parent = nodeMap.get(parentPath)
      if (parent && !parent.children.includes(node)) {
        parent.children.push(node)
      }
    }
  }

  const sortNodes = (nodes: FolderTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
    for (const node of nodes) sortNodes(node.children)
  }
  sortNodes(topLevel)
  topLevel.sort((a, b) => a.name.localeCompare(b.name))

  return { rootNotes, folders: topLevel }
}

function DroppableFolderHeader({
  folder,
  children,
}: {
  folder: string
  children: (isOver: boolean) => React.ReactNode
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `folder:${folder}`,
    data: { type: 'folder', folder },
  })
  return <div ref={setNodeRef}>{children(isOver)}</div>
}

function DraggableNoteItem({
  note,
  children,
}: {
  note: NoteSummary
  children: (isDragging: boolean, dragListeners: React.HTMLAttributes<HTMLElement>) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `note:${note.id}`,
    data: { type: 'note', note },
  })
  return (
    <div ref={setNodeRef} {...attributes}>
      {children(isDragging, listeners ?? {})}
    </div>
  )
}

// ── FolderTreeItem ────────────────────────────────────────────────────────────
// Renders one folder node recursively. depth controls indent level (0 = top).

interface FolderTreeItemProps {
  node: FolderTreeNode
  depth: number
  activeNoteId: string | null | undefined
  collapsedFolders: Set<string>
  onToggleFolder(folder: string): void
  onOpenNote(noteId: string): void
  onOpenCreateNoteDialog(folder?: string): void
  onOpenRenameFolder(folder: string): void
  onOpenDeleteFolder(folder: string): void
  onOpenMoveDialog(note: NoteSummary): void
  onOpenRenameDialogForNote(note: NoteSummary): void
  onOpenDeleteDialogForNote(note: NoteSummary): void
  onDuplicateNote(note: NoteSummary): void
  onCopyNoteLink(note: NoteSummary): void
  onCopyNotePath(note: NoteSummary): void
  onRevealNote(note: NoteSummary): void
}

function FolderTreeItem({
  node,
  depth,
  activeNoteId,
  collapsedFolders,
  onToggleFolder,
  onOpenNote,
  onOpenCreateNoteDialog,
  onOpenRenameFolder,
  onOpenDeleteFolder,
  onOpenMoveDialog,
  onOpenRenameDialogForNote,
  onOpenDeleteDialogForNote,
  onDuplicateNote,
  onCopyNoteLink,
  onCopyNotePath,
  onRevealNote,
}: FolderTreeItemProps) {
  const isCollapsed = collapsedFolders.has(node.fullPath)
  const indent = depth * 12

  return (
    <div>
      <DroppableFolderHeader folder={node.fullPath}>
        {(isOver) => (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className={cn(
                  'mb-0.5 flex h-7 cursor-pointer items-center gap-1 rounded-[5px] pr-2 text-sm font-medium text-muted-foreground hover:bg-foreground/[0.04]',
                  isOver && 'ring-2 ring-primary/40 bg-primary/[0.06]'
                )}
                style={{ paddingLeft: `${8 + indent}px` }}
                onClick={() => onToggleFolder(node.fullPath)}
              >
                {isCollapsed
                  ? <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                {isCollapsed
                  ? <Folder className="h-4 w-4 shrink-0" />
                  : <FolderOpen className="h-4 w-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate" title={node.fullPath}>
                  {node.name}
                </span>
                <span className="text-xs text-muted-foreground/50 tabular-nums">
                  {countFolderNotes(node)}
                </span>
              </div>
            </ContextMenuTrigger>
            <StyledContextMenuContent>
              <StyledContextMenuItem onClick={() => onOpenCreateNoteDialog(node.fullPath)}>
                <FilePlus2 className="h-3.5 w-3.5" />
                New note in folder
              </StyledContextMenuItem>
              <StyledContextMenuItem onClick={() => onOpenRenameFolder(node.fullPath)}>
                <Pencil className="h-3.5 w-3.5" />
                Rename folder
              </StyledContextMenuItem>
              <StyledContextMenuSeparator />
              <StyledContextMenuItem variant="destructive" onClick={() => onOpenDeleteFolder(node.fullPath)}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete folder
              </StyledContextMenuItem>
            </StyledContextMenuContent>
          </ContextMenu>
        )}
      </DroppableFolderHeader>

      {!isCollapsed && (
        <>
          {/* Child sub-folders first */}
          {node.children.map(child => (
            <FolderTreeItem
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              activeNoteId={activeNoteId}
              collapsedFolders={collapsedFolders}
              onToggleFolder={onToggleFolder}
              onOpenNote={onOpenNote}
              onOpenCreateNoteDialog={onOpenCreateNoteDialog}
              onOpenRenameFolder={onOpenRenameFolder}
              onOpenDeleteFolder={onOpenDeleteFolder}
              onOpenMoveDialog={onOpenMoveDialog}
              onOpenRenameDialogForNote={onOpenRenameDialogForNote}
              onOpenDeleteDialogForNote={onOpenDeleteDialogForNote}
              onDuplicateNote={onDuplicateNote}
              onCopyNoteLink={onCopyNoteLink}
              onCopyNotePath={onCopyNotePath}
              onRevealNote={onRevealNote}
            />
          ))}

          {/* Notes directly inside this folder */}
          {node.notes.map(note => (
            <DraggableNoteItem key={note.id} note={note}>
              {(isDragging, dragListeners) => (
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <button
                      onClick={() => onOpenNote(note.id)}
                      style={{
                        paddingLeft: `${14 + indent + 12}px`,
                        contentVisibility: 'auto',
                        containIntrinsicSize: '0 44px',
                      }}
                      className={cn(
                        'mb-0.5 w-full rounded-[6px] pr-2.5 py-1.5 text-left hover:bg-foreground/[0.05]',
                        activeNoteId === note.id && 'bg-foreground/[0.08]',
                        isDragging && 'opacity-50'
                      )}
                      {...dragListeners}
                    >
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                        <div className="min-w-0 flex-1 truncate text-sm">{note.title}</div>
                      </div>
                      {note.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1" style={{ paddingLeft: '20px' }}>
                          {note.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="rounded-[4px] bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>
                          ))}
                        </div>
                      )}
                    </button>
                  </ContextMenuTrigger>
                  <StyledContextMenuContent>
                    <StyledContextMenuItem onClick={() => onOpenNote(note.id)}>
                      <FileText className="h-3.5 w-3.5" />
                      Open
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onOpenRenameDialogForNote(note)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onOpenCreateNoteDialog(noteFolder(note) || undefined)}>
                      <FilePlus2 className="h-3.5 w-3.5" />
                      New note here
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onDuplicateNote(note)}>
                      <Copy className="h-3.5 w-3.5" />
                      Duplicate
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onOpenMoveDialog(note)}>
                      <FolderInput className="h-3.5 w-3.5" />
                      Move to folder
                    </StyledContextMenuItem>
                    <StyledContextMenuSeparator />
                    <StyledContextMenuItem onClick={() => onCopyNoteLink(note)}>
                      <Link2 className="h-3.5 w-3.5" />
                      Copy note link
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onCopyNotePath(note)}>
                      <FileText className="h-3.5 w-3.5" />
                      Copy markdown path
                    </StyledContextMenuItem>
                    <StyledContextMenuItem onClick={() => onRevealNote(note)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Reveal in Finder
                    </StyledContextMenuItem>
                    <StyledContextMenuSeparator />
                    <StyledContextMenuItem variant="destructive" onClick={() => onOpenDeleteDialogForNote(note)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </StyledContextMenuItem>
                  </StyledContextMenuContent>
                </ContextMenu>
              )}
            </DraggableNoteItem>
          ))}
        </>
      )}
    </div>
  )
}

function countFolderNotes(node: FolderTreeNode): number {
  return node.notes.length + node.children.reduce((sum, c) => sum + countFolderNotes(c), 0)
}

export default function NotesPage({ selectedNoteId }: NotesPageProps) {
  const { activeWorkspaceId, onCreateSession, onOpenFile, onSendMessage } = useAppShellContext()
  const [notes, setNotes] = React.useState<NoteSummary[]>([])
  // Stable insertion order for sidebar — only updated on full refreshes, not optimistic saves
  const [sidebarOrder, setSidebarOrder] = React.useState<string[]>([])
  const [searchResults, setSearchResults] = React.useState<NoteSummary[] | null>(null)
  const [activeNote, setActiveNote] = React.useState<NoteDocument | null>(null)
  const [content, setContent] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [selectedTag, setSelectedTag] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [collapsedFolders, setCollapsedFolders] = React.useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('notes:collapsed-folders') ?? '[]')) }
    catch { return new Set() }
  })
  const [wikiQuery, setWikiQuery] = React.useState<string | null>(null)
  const [wikiIndex, setWikiIndex] = React.useState(0)
  const [wikiAnchor, setWikiAnchor] = React.useState<{ x: number; y: number } | null>(null)
  const [tagDraft, setTagDraft] = React.useState('')
  const [newPropertyKey, setNewPropertyKey] = React.useState('')
  const [newPropertyValue, setNewPropertyValue] = React.useState('')
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [createTitle, setCreateTitle] = React.useState('')
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = React.useState(false)
  const [createFolderName, setCreateFolderName] = React.useState('')
  const [createInFolder, setCreateInFolder] = React.useState<string | undefined>(undefined)
  const [moveDialogOpen, setMoveDialogOpen] = React.useState(false)
  const [moveTargetNote, setMoveTargetNote] = React.useState<NoteSummary | null>(null)
  const [moveFolderName, setMoveFolderName] = React.useState('')
  const [renameDialogOpen, setRenameDialogOpen] = React.useState(false)
  const [renameTitle, setRenameTitle] = React.useState('')
  const [renameImpact, setRenameImpact] = React.useState<NoteRenameImpact | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [renameFolderDialogOpen, setRenameFolderDialogOpen] = React.useState(false)
  const [renameFolderTarget, setRenameFolderTarget] = React.useState('')
  const [renameFolderName, setRenameFolderName] = React.useState('')
  const [deleteFolderDialogOpen, setDeleteFolderDialogOpen] = React.useState(false)
  const [deleteFolderTarget, setDeleteFolderTarget] = React.useState('')
  const [externalChange, setExternalChange] = React.useState<NoteChangedPayload | null>(null)
  const externalChangeToastIdRef = React.useRef<string | number | null>(null)
  const [missingLinkTarget, setMissingLinkTarget] = React.useState<string | null>(null)
  const [allAssets, setAllAssets] = React.useState<NoteAsset[]>([])
  const [allTasks, setAllTasks] = React.useState<NoteTask[]>([])
  const [assetDialogOpen, setAssetDialogOpen] = React.useState(false)
  const [assetRenameTarget, setAssetRenameTarget] = React.useState<NoteAsset | null>(null)
  const [assetRenameName, setAssetRenameName] = React.useState('')
  const [assetBusy, setAssetBusy] = React.useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = React.useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('notes:inspector-collapsed') ?? 'true') }
    catch { return true }
  })
  const saveTimerRef = React.useRef<number | null>(null)
  const saveQueueRef = React.useRef<Promise<boolean>>(Promise.resolve(true))
  const taskCacheRef = React.useRef<Map<string, NoteTask[]>>(new Map())
  const dirtyRef = React.useRef(dirty)
  const contentRef = React.useRef(content)
  const activeNoteIdRef = React.useRef<string | null>(null)
  const richEditorRef = React.useRef<TiptapEditorHandle | null>(null)
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  React.useEffect(() => { dirtyRef.current = dirty }, [dirty])
  React.useEffect(() => { contentRef.current = content }, [content])
  React.useEffect(() => { activeNoteIdRef.current = activeNote?.id ?? null }, [activeNote?.id])

  const toggleFolder = React.useCallback((folder: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      next.has(folder) ? next.delete(folder) : next.add(folder)
      localStorage.setItem('notes:collapsed-folders', JSON.stringify([...next]))
      return next
    })
  }, [])

  const refreshNotes = React.useCallback(async () => {    if (!activeWorkspaceId) return
    const next = await window.electronAPI.listNotes(activeWorkspaceId)
    setNotes(next)
    setSidebarOrder(next.map(n => n.id))
  }, [activeWorkspaceId])

  const refreshAssets = React.useCallback(async () => {
    if (!activeWorkspaceId) {
      setAllAssets([])
      return
    }
    const next = await window.electronAPI.listNoteAssets(activeWorkspaceId)
    setAllAssets(next)
  }, [activeWorkspaceId])

  const refreshTasks = React.useCallback(async (sourceNotes?: NoteSummary[]) => {
    if (!activeWorkspaceId) {
      setAllTasks([])
      taskCacheRef.current.clear()
      return
    }
    const baseNotes = sourceNotes ?? notes
    const currentIds = new Set(baseNotes.map(n => n.id))
    for (const id of taskCacheRef.current.keys()) {
      if (!currentIds.has(id)) taskCacheRef.current.delete(id)
    }
    const toFetch = baseNotes.filter(n => !taskCacheRef.current.has(n.id))
    const results = await Promise.allSettled(
      toFetch.map(note => window.electronAPI.readNote(activeWorkspaceId, note.id))
    )
    for (const result of results) {
      if (result.status === 'fulfilled') {
        taskCacheRef.current.set(result.value.id, extractTasks(result.value, result.value.content))
      }
    }
    setAllTasks([...taskCacheRef.current.values()].flat())
  }, [activeWorkspaceId, notes])

  const openNote = React.useCallback(async (noteId: string) => {
    if (!activeWorkspaceId) return
    setLoading(true)
    try {
      const note = await window.electronAPI.readNote(activeWorkspaceId, noteId)
      setActiveNote(note)
      setContent(note.content)
      setDirty(false)
      setSaveError(null)
      setExternalChange(null)
      setTagDraft(note.tags.join(', '))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to open note')
      setActiveNote(null)
      setContent('')
      setDirty(false)
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId])

  React.useEffect(() => {
    if (!externalChange) return
    const noteId = externalChange.noteId
    externalChangeToastIdRef.current = toast('Note changed on disk', {
      description: dirtyRef.current ? 'Another process updated this note. Reload to see changes?' : undefined,
      duration: 8000,
      action: {
        label: 'Reload',
        onClick: () => { setExternalChange(null); if (noteId) void openNote(noteId) },
      },
      onDismiss: () => { setExternalChange(null) },
      onAutoClose: () => { setExternalChange(null) },
    })
    return () => {
      if (externalChangeToastIdRef.current != null) {
        toast.dismiss(externalChangeToastIdRef.current)
      }
    }
  }, [externalChange, openNote])

  React.useEffect(() => {
    refreshNotes()
    refreshAssets()
    if (!activeWorkspaceId) return
    window.electronAPI.watchNotes(activeWorkspaceId).catch(error => {
      toast.error(error instanceof Error ? error.message : 'Failed to watch notes')
    })
    const unsubscribe = window.electronAPI.onNotesChanged((rawPayload) => {
      const payload = normalizeChangedPayload(rawPayload)
      if (payload.workspaceId !== activeWorkspaceId) return

      // Internal saves are handled optimistically — only react to external changes
      // (e.g. another process edited the file, or the user ran a script)
      if (payload.reason !== 'external') return

      refreshNotes()
      refreshAssets()

      if (payload.noteId && payload.noteId === activeNoteIdRef.current) {
        if (dirtyRef.current) {
          setExternalChange(payload)
        } else {
          openNote(payload.noteId)
        }
      }
    })

    return () => {
      unsubscribe()
      window.electronAPI.unwatchNotes(activeWorkspaceId).catch(() => {})
    }
  }, [activeWorkspaceId, openNote, refreshAssets, refreshNotes])

  React.useEffect(() => {
    if (selectedNoteId) {
      openNote(selectedNoteId)
      return
    }
    setActiveNote(null)
    setContent('')
    setDirty(false)
    setSaveError(null)
  }, [selectedNoteId, openNote])

  const noteIds = React.useMemo(() => notes.map(n => n.id).join(','), [notes])
  React.useEffect(() => {
    void refreshTasks(notes)
    // Only re-run when the set of note IDs changes, not on every content/metadata update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteIds])

  const saveCurrentNote = React.useCallback(async (): Promise<boolean> => {
    if (!activeWorkspaceId || !activeNote) return true
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const noteId = activeNote.id
    const currentContent = contentRef.current
    const queued = saveQueueRef.current.then(async () => {
      setSaving(true)
      setSaveError(null)
      try {
        const saved = await window.electronAPI.saveNote(activeWorkspaceId, noteId, currentContent)
        if (activeNoteIdRef.current === noteId) {
          setActiveNote(saved)
          setDirty(false)
          setTagDraft(saved.tags.join(', '))
        }
        // Optimistically update sidebar — no refreshNotes() round-trip needed
        setNotes(prev => prev.map(n => n.id === saved.id ? saved : n))
        taskCacheRef.current.set(saved.id, extractTasks(saved, saved.content))
        setAllTasks([...taskCacheRef.current.values()].flat())
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to save note'
        setSaveError(message)
        toast.error(message)
        return false
      } finally {
        setSaving(false)
      }
    }).catch((): boolean => false)
    saveQueueRef.current = queued
    return queued
  // contentRef is a ref — intentionally excluded; activeNote.id and activeWorkspaceId are the real deps
  }, [activeWorkspaceId, activeNote])

  const flushBeforeAction = React.useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true
    return saveCurrentNote()
  }, [saveCurrentNote])

  React.useEffect(() => {
    if (!dirty || !activeWorkspaceId || !activeNote) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(async () => {
      await saveCurrentNote()
    }, 900)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [activeWorkspaceId, activeNote, dirty, saveCurrentNote])

  React.useEffect(() => {
    if (!activeWorkspaceId) return
    const q = query.trim()
    if (!q) {
      setSearchResults(null)
      return
    }

    const timer = window.setTimeout(async () => {
      try {
        const results = await window.electronAPI.searchNotes(activeWorkspaceId, q)
        setSearchResults(results)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to search notes')
      }
    }, 180)

    return () => window.clearTimeout(timer)
  }, [activeWorkspaceId, query])

  React.useEffect(() => {
    setWikiIndex(0)
  }, [wikiQuery])

  React.useEffect(() => {
    setTagDraft(activeNote?.tags.join(', ') ?? '')
  }, [activeNote?.id, activeNote?.tags])

  const visibleNotes = React.useMemo(() => {
    const filtered = filterNotes(searchResults ?? notes, searchResults ? '' : query, selectedTag)
    if (searchResults) return filtered
    // Apply stable sidebar order — new notes (not yet in order) go to front
    const orderIndex = new Map(sidebarOrder.map((id, i) => [id, i]))
    return [...filtered].sort((a, b) => {
      const ia = orderIndex.get(a.id) ?? -1
      const ib = orderIndex.get(b.id) ?? -1
      if (ia === -1 && ib === -1) return b.updatedAt - a.updatedAt
      if (ia === -1) return -1
      if (ib === -1) return 1
      return ia - ib
    })
  }, [notes, sidebarOrder, searchResults, query, selectedTag])
  const folderTree = React.useMemo(() => buildFolderTree(visibleNotes), [visibleNotes])
  const allTags = React.useMemo(() => {
    const tags = new Set<string>()
    notes.forEach(note => note.tags.forEach(tag => tags.add(tag)))
    return [...tags].sort((a, b) => a.localeCompare(b))
  }, [notes])

  const currentProperties = React.useMemo(() => activeNote?.properties ?? {}, [activeNote?.properties])
  const propertyEntries = React.useMemo(
    () => Object.entries(currentProperties).filter(([key]) => key !== 'tags'),
    [currentProperties]
  )
  const richParts = React.useMemo(() => splitFrontmatter(content), [content])
  const dailyDate = parseDailyNoteDate(activeNote?.id)
  const currentNoteAssets = React.useMemo(() => {
    const refs = new Set(activeNote?.assetRefs.map(ref => ref.replace(/^\.\//, '')) ?? [])
    return allAssets.filter(asset => refs.has(asset.relativePath))
  }, [activeNote?.assetRefs, allAssets])
  const uncreatedLinks = React.useMemo(() => {
    const targets = new Map<string, string>()
    activeNote?.links.forEach(link => {
      if (!findNoteByTarget(notes, link.target)) {
        targets.set(normalizeNoteTarget(link.target), link.target)
      }
    })
    return [...targets.values()].sort((a, b) => a.localeCompare(b))
  }, [activeNote?.links, notes])
  const orphanAssets = React.useMemo(
    () => allAssets.filter(asset => (asset.referencedBy?.length ?? 0) === 0),
    [allAssets]
  )
  const activeNoteStats = activeNote
    ? `${activeNote.links.length}↗ · ${activeNote.backlinks.length}↙ · ${content.length} chars`
    : ''
  const activeNoteTasks = React.useMemo(
    () => activeNote ? extractTasks(activeNote, content) : [],
    [activeNote, content]
  )
  const openTasks = React.useMemo(() => allTasks.filter(task => !task.checked), [allTasks])

  const wikiMatches = React.useMemo(() => {
    if (wikiQuery == null) return []
    const q = wikiQuery.toLowerCase()
    return notes
      .filter(note => note.id !== activeNote?.id)
      .filter(note => !q || note.title.toLowerCase().includes(q) || noteRelativeLabel(note).toLowerCase().includes(q))
      .slice(0, 8)
  }, [notes, activeNote?.id, wikiQuery])

  const wikiCreateLabel = wikiQuery?.trim()
  const showWikiMenu = wikiQuery != null && (wikiMatches.length > 0 || !!wikiCreateLabel)

  const handleCreate = async () => {
    if (!activeWorkspaceId || !createTitle.trim()) return
    if (!await flushBeforeAction()) return
    const note = await window.electronAPI.createNote(activeWorkspaceId, createTitle.trim(), createInFolder)
    setCreateDialogOpen(false)
    setCreateTitle('')
    setCreateInFolder(undefined)
    await refreshNotes()
    navigate(routes.view.notes(note.id))
  }

  const openCreateNoteDialog = (folder?: string) => {
    setCreateTitle('')
    setCreateInFolder(folder)
    setCreateDialogOpen(true)
  }

  const handleCreateFolder = async () => {
    if (!activeWorkspaceId || !createFolderName.trim()) return
    if (!await flushBeforeAction()) return
    const folder = stripMdExtension(createFolderName.trim()).replace(/^\/+|\/+$/g, '')
    const note = await window.electronAPI.createNote(activeWorkspaceId, 'Untitled', folder)
    setCreateFolderDialogOpen(false)
    setCreateFolderName('')
    await refreshNotes()
    navigate(routes.view.notes(note.id))
  }

  const handleDaily = async (date?: string) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const note = await window.electronAPI.getDailyNote(activeWorkspaceId, date)
    await refreshNotes()
    navigate(routes.view.notes(note.id))
  }

  const handleDailyShift = async (deltaDays: number) => {
    const baseDate = dailyDate ?? todayDateString()
    await handleDaily(shiftDateString(baseDate, deltaDays))
  }

  const openRenameDialog = async () => {
    if (!activeWorkspaceId || !activeNote) return
    if (!await flushBeforeAction()) return
    setRenameTitle(activeNote.title)
    setRenameImpact(null)
    setRenameDialogOpen(true)
  }

  const openRenameDialogForNote = async (note: NoteSummary) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const document = await window.electronAPI.readNote(activeWorkspaceId, note.id)
    setActiveNote(document)
    setContent(document.content)
    setDirty(false)
    setTagDraft(document.tags.join(', '))
    setRenameTitle(document.title)
    setRenameImpact(null)
    setRenameDialogOpen(true)
    navigate(routes.view.notes(document.id))
  }

  const openDeleteDialogForNote = async (note: NoteSummary) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const document = await window.electronAPI.readNote(activeWorkspaceId, note.id)
    setActiveNote(document)
    setContent(document.content)
    setDirty(false)
    setTagDraft(document.tags.join(', '))
    setDeleteDialogOpen(true)
    navigate(routes.view.notes(document.id))
  }

  const duplicateNote = async (note: NoteSummary) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const document = await window.electronAPI.readNote(activeWorkspaceId, note.id)
    const title = `${document.title} copy`
    const created = await window.electronAPI.createNote(activeWorkspaceId, title, noteFolder(note) || undefined)
    const saved = await window.electronAPI.saveNote(activeWorkspaceId, created.id, updateMarkdownTitle(document.content, title))
    await refreshNotes()
    navigate(routes.view.notes(saved.id))
    toast.success('Note duplicated')
  }

  const openMoveDialog = (note: NoteSummary) => {
    setMoveTargetNote(note)
    setMoveFolderName(noteFolder(note))
    setMoveDialogOpen(true)
  }

  const moveNoteToFolder = async () => {
    if (!activeWorkspaceId || !moveTargetNote) return
    if (!await flushBeforeAction()) return
    const folder = stripMdExtension(moveFolderName.trim()).replace(/^\/+|\/+$/g, '')
    if (folder === noteFolder(moveTargetNote)) {
      setMoveDialogOpen(false)
      return
    }
    const document = await window.electronAPI.readNote(activeWorkspaceId, moveTargetNote.id)
    let created: Awaited<ReturnType<typeof window.electronAPI.createNote>> | null = null
    try {
      created = await window.electronAPI.createNote(activeWorkspaceId, document.title, folder || undefined)
      const saved = await window.electronAPI.saveNote(activeWorkspaceId, created.id, document.content)
      await window.electronAPI.deleteNote(activeWorkspaceId, moveTargetNote.id)
      setMoveDialogOpen(false)
      setMoveTargetNote(null)
      setMoveFolderName('')
      await refreshNotes()
      navigate(routes.view.notes(saved.id))
      toast.success('Note moved')
    } catch (error) {
      if (created) {
        await window.electronAPI.deleteNote(activeWorkspaceId, created.id).catch(() => {})
      }
      toast.error(error instanceof Error ? error.message : 'Failed to move note')
    }
  }

  const moveSilently = async (note: NoteSummary, targetFolder: string) => {
    if (!activeWorkspaceId) return
    if (!await flushBeforeAction()) return
    const document = await window.electronAPI.readNote(activeWorkspaceId, note.id)
    let created: Awaited<ReturnType<typeof window.electronAPI.createNote>> | null = null
    try {
      created = await window.electronAPI.createNote(activeWorkspaceId, document.title, targetFolder || undefined)
      const saved = await window.electronAPI.saveNote(activeWorkspaceId, created.id, document.content)
      await window.electronAPI.deleteNote(activeWorkspaceId, note.id)
      await refreshNotes()
      navigate(routes.view.notes(saved.id))
      toast.success('Note moved')
    } catch (error) {
      if (created) await window.electronAPI.deleteNote(activeWorkspaceId, created.id).catch(() => {})
      toast.error(error instanceof Error ? error.message : 'Failed to move note')
    }
  }

  const handleSidebarDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    if (active.data.current?.type !== 'note' || over.data.current?.type !== 'folder') return
    const note = active.data.current.note as NoteSummary
    const targetFolder = over.data.current.folder as string
    if (noteFolder(note) === targetFolder) return
    void moveSilently(note, targetFolder)
  }

  const copyNoteLink = async (note: NoteSummary) => {    await navigator.clipboard.writeText(`[[${note.title}]]`)
    toast.success('Note link copied')
  }

  const openRenameFolderDialog = (folder: string) => {
    setRenameFolderTarget(folder)
    setRenameFolderName(folder.split('/').pop() ?? folder)
    setRenameFolderDialogOpen(true)
  }

  const handleRenameFolder = async () => {
    if (!activeWorkspaceId || !renameFolderTarget || !renameFolderName.trim()) return
    try {
      await window.electronAPI.renameFolderNote(activeWorkspaceId, renameFolderTarget, renameFolderName.trim())
      setRenameFolderDialogOpen(false)
      setRenameFolderTarget('')
      setRenameFolderName('')
      await refreshNotes()
      toast.success('Folder renamed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to rename folder')
    }
  }

  const openDeleteFolderDialog = (folder: string) => {
    setDeleteFolderTarget(folder)
    setDeleteFolderDialogOpen(true)
  }

  const handleDeleteFolder = async () => {
    if (!activeWorkspaceId || !deleteFolderTarget) return
    try {
      const result = await window.electronAPI.deleteFolderNote(activeWorkspaceId, deleteFolderTarget)
      setDeleteFolderDialogOpen(false)
      setDeleteFolderTarget('')
      if (activeNote && result.deletedNotes.includes(activeNote.id)) {
        setActiveNote(null)
        setContent('')
        setDirty(false)
        navigate(routes.view.notes())
      }
      await refreshNotes()
      toast.success(`Deleted folder and ${result.deletedNotes.length} note${result.deletedNotes.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete folder')
    }
  }

  const copyNotePath = async (note: NoteSummary) => {
    await navigator.clipboard.writeText(`notes/${note.relativePath}`)
    toast.success('Markdown path copied')
  }

  const revealNote = async (note: NoteSummary) => {
    await window.electronAPI.showInFolder(note.path)
  }

  const refreshRenameImpact = React.useCallback(async (title: string) => {
    if (!activeWorkspaceId || !activeNote || !title.trim() || title.trim() === activeNote.title) {
      setRenameImpact(null)
      return
    }
    try {
      const impact = await window.electronAPI.getNoteRenameImpact(activeWorkspaceId, activeNote.id, title.trim())
      setRenameImpact(impact)
    } catch {
      setRenameImpact(null)
    }
  }, [activeWorkspaceId, activeNote])

  React.useEffect(() => {
    if (!renameDialogOpen) return
    const timer = window.setTimeout(() => {
      refreshRenameImpact(renameTitle)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [renameDialogOpen, renameTitle, refreshRenameImpact])

  const handleRename = async () => {
    if (!activeWorkspaceId || !activeNote || !renameTitle.trim() || renameTitle.trim() === activeNote.title) return
    const result = await window.electronAPI.renameNote(activeWorkspaceId, activeNote.id, renameTitle.trim())
    setRenameDialogOpen(false)
    await refreshNotes()
    navigate(routes.view.notes(result.note.id))
    toast.success(`Updated ${result.updatedNotes.length} linked note${result.updatedNotes.length === 1 ? '' : 's'}`)
  }

  const handleDelete = async () => {
    if (!activeWorkspaceId || !activeNote) return
    if (!await flushBeforeAction()) return
    await window.electronAPI.deleteNote(activeWorkspaceId, activeNote.id)
    setDeleteDialogOpen(false)
    await refreshNotes()
    navigate(routes.view.notes())
  }

  const updateProperty = React.useCallback(async (key: string, value: unknown | undefined) => {
    if (!activeWorkspaceId || !activeNote) return
    if (!await flushBeforeAction()) return
    const properties = { ...activeNote.properties }
    if (value === undefined) {
      delete properties[key]
    } else {
      properties[key] = value
    }
    try {
      const updated = await window.electronAPI.updateNoteProperties(activeWorkspaceId, activeNote.id, properties)
      setActiveNote(updated)
      setContent(updated.content)
      setDirty(false)
      setSaveError(null)
      setTagDraft(updated.tags.join(', '))
      await refreshNotes()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update note properties')
    }
  }, [activeWorkspaceId, activeNote, flushBeforeAction, refreshNotes])

  const applyTags = React.useCallback(() => {
    const tags = tagDraft.split(',').map(tag => tag.trim().replace(/^#/, '')).filter(Boolean)
    void updateProperty('tags', tags)
  }, [tagDraft, updateProperty])

  const addProperty = React.useCallback(() => {
    const key = newPropertyKey.trim()
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      toast.error('Property keys can use letters, numbers, underscore, and dash')
      return
    }
    void updateProperty(key, inputToProperty(newPropertyValue))
    setNewPropertyKey('')
    setNewPropertyValue('')
  }, [newPropertyKey, newPropertyValue, updateProperty])

  const insertAtCursor = (text: string) => {
    const editor = richEditorRef.current
    if (editor) {
      editor.chain().focus().insertContent(text).run()
      return
    }
    setContent(prev => `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}${text}`)
    setDirty(true)
  }

  const importFiles = React.useCallback(async (files: File[] | FileList) => {
    if (!activeWorkspaceId || !activeNote) return
    const list = Array.from(files)
    if (list.length === 0) return
    try {
      const snippets: string[] = []
      for (const file of list) {
        const attachment = await fileToAttachment(file)
        const result = await window.electronAPI.importNoteAsset(activeWorkspaceId, attachment)
        snippets.push(result.markdown)
      }
      insertAtCursor(snippets.join('\n'))
      await refreshAssets()
      toast.success(`Imported ${list.length} asset${list.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to import asset')
    }
  }, [activeWorkspaceId, activeNote, refreshAssets])

  const handleImportAsset = async () => {
    if (!activeWorkspaceId || !activeNote) return
    const paths = await window.electronAPI.openFileDialog()
    const path = paths[0]
    if (!path) return
    const attachment = await window.electronAPI.readUserAttachment(path)
    if (!attachment) {
      toast.error('Could not read selected file')
      return
    }
    const result = await window.electronAPI.importNoteAsset(activeWorkspaceId, attachment)
    insertAtCursor(result.markdown)
    await refreshAssets()
  }

  const handleExportPdf = async () => {
    if (!activeNote || !richEditorRef.current) return
    const editorDom = richEditorRef.current.view.dom as HTMLElement
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui,sans-serif;max-width:800px;margin:2em auto;line-height:1.6;color:#111}
pre{background:#f4f4f4;padding:1em;border-radius:4px;overflow-x:auto}
code{font-family:monospace;font-size:.9em}img{max-width:100%}
h1,h2,h3{margin-top:1.5em}
</style></head><body><h1>${activeNote.title.replace(/</g,'&lt;')}</h1>${editorDom.innerHTML}</body></html>`
    const result = await window.electronAPI.exportNotePdf({ html, defaultPath: `${activeNote.title}.pdf` })
    if (!result.canceled) toast.success('Exported to PDF')
  }

  const handleRichBodyChange = (nextBody: string) => {
    setContent(mergeFrontmatter(richParts.frontmatter, nextBody))
    setDirty(true)
    setSaveError(null)
    updateWikiQueryAndAnchor()
  }

  const updateWikiQueryAndAnchor = React.useCallback(() => {
    const editor = richEditorRef.current
    const query = findRichWikiQuery(editor)
    setWikiQuery(query)
    if (query !== null && editor) {
      try {
        const coords = editor.view.coordsAtPos(editor.state.selection.from)
        const editorDom = editor.view.dom.closest('.overflow-y-auto')
        const rect = editorDom?.getBoundingClientRect() ?? { left: 0, top: 0 }
        setWikiAnchor({ x: coords.left - rect.left, y: coords.bottom - rect.top + 4 })
      } catch {
        setWikiAnchor(null)
      }
    } else {
      setWikiAnchor(null)
    }
  }, [])

  const syncRichWikiQuery = React.useCallback(() => {
    updateWikiQueryAndAnchor()
  }, [updateWikiQueryAndAnchor])

  const handleOpenNote = async (noteId: string) => {
    if (!await flushBeforeAction()) return
    navigate(routes.view.notes(noteId))
  }

  const openWikiLinkAtCursor = async () => {
    const target = findRichWikiLinkAtCursor(richEditorRef.current)
    if (!target) return
    const note = findNoteByTarget(notes, target)
    if (note) {
      await handleOpenNote(note.id)
      return
    }
    setMissingLinkTarget(target)
  }

  const completeWikiLink = (note: NoteSummary) => {
    completeWikiText(note.title)
  }

  const completeWikiText = (text: string) => {
    const editor = richEditorRef.current
    const range = findRichWikiQueryRange(editor)
    if (!editor || !range || !text.trim()) return
    editor.chain().focus().deleteRange(range).insertContent(`[[${text.trim()}]]`).run()
    setWikiQuery(null)
  }

  const createMissingLinkNote = React.useCallback(async () => {
    if (!activeWorkspaceId || !missingLinkTarget) return
    const cleanTarget = stripMdExtension(missingLinkTarget)
    const parts = cleanTarget.split('/').filter(Boolean)
    const title = parts.pop() || cleanTarget
    const created = await window.electronAPI.createNote(activeWorkspaceId, title, parts.length > 0 ? parts.join('/') : undefined)
    setMissingLinkTarget(null)
    await refreshNotes()
    navigate(routes.view.notes(created.id))
  }, [activeWorkspaceId, missingLinkTarget, refreshNotes])

  const AI_PROMPTS: Record<AIActionMode, { sessionName: string; instruction: string }> = {
    'analyze': {
      sessionName: 'Note: analyze',
      instruction: 'Analyze this note and suggest concrete next actions.',
    },
    'expand': {
      sessionName: 'Note: expand',
      instruction: 'Expand and enrich this note with additional context, examples, and detail. Write the expanded version as markdown.',
    },
    'summarize': {
      sessionName: 'Note: summarize',
      instruction: 'Write a concise 3–5 sentence summary of this note, then list key takeaways as bullet points.',
    },
    'extract-tasks': {
      sessionName: 'Note: tasks',
      instruction: 'Extract all implied and explicit action items from this note. Format as a markdown task list `- [ ] task`.',
    },
  }

  const handleAskAgent = async (mode: AIActionMode = 'analyze') => {
    if (!activeWorkspaceId || !activeNote) return
    if (!await flushBeforeAction()) return
    const { sessionName, instruction } = AI_PROMPTS[mode]
    const session = await onCreateSession(activeWorkspaceId, { name: `${sessionName}: ${activeNote.title}` })
    const prompt = [
      `Use this workspace note as context: ${activeNote.title}`,
      `Path: notes/${activeNote.relativePath}`,
      `Tags: ${activeNote.tags.length ? activeNote.tags.map(tag => `#${tag}`).join(' ') : 'none'}`,
      `Backlinks: ${activeNote.backlinks.length ? activeNote.backlinks.map(link => link.title).join(', ') : 'none'}`,
      `Open tasks: ${activeNoteTasks.filter(task => !task.checked).length}`,
      '',
      '```markdown',
      content,
      '```',
      '',
      instruction,
    ].join('\n')
    onSendMessage(session.id, prompt)
    navigate(routes.view.allSessions(session.id))
  }

  const openAssetRenameDialog = (asset: NoteAsset) => {
    setAssetRenameTarget(asset)
    setAssetRenameName(asset.name)
  }

  const handleRenameAsset = async () => {
    if (!activeWorkspaceId || !assetRenameTarget || !assetRenameName.trim()) return
    setAssetBusy(true)
    try {
      const result = await window.electronAPI.renameNoteAsset(activeWorkspaceId, assetRenameTarget.relativePath, assetRenameName.trim())
      setAssetRenameTarget(null)
      setAssetRenameName('')
      await refreshAssets()
      await refreshNotes()
      if (activeNote) await openNote(activeNote.id)
      toast.success(`Updated ${result.updatedNotes.length} note${result.updatedNotes.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to rename asset')
    } finally {
      setAssetBusy(false)
    }
  }

  const handleDeleteAsset = async (asset: NoteAsset) => {
    if (!activeWorkspaceId) return
    setAssetBusy(true)
    try {
      await window.electronAPI.deleteNoteAsset(activeWorkspaceId, asset.relativePath)
      await refreshAssets()
      await refreshNotes()
      toast.success('Asset deleted')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete asset')
    } finally {
      setAssetBusy(false)
    }
  }

  const handleCleanUnusedAssets = async () => {
    if (!activeWorkspaceId || orphanAssets.length === 0) return
    setAssetBusy(true)
    try {
      for (const asset of orphanAssets) {
        await window.electronAPI.deleteNoteAsset(activeWorkspaceId, asset.relativePath)
      }
      await refreshAssets()
      toast.success(`Deleted ${orphanAssets.length} unused asset${orphanAssets.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clean assets')
    } finally {
      setAssetBusy(false)
    }
  }

  const toggleTask = async (task: NoteTask) => {
    if (!activeWorkspaceId) return
    if (activeNote?.id === task.noteId) {
      const flushed = await flushBeforeAction()
      if (!flushed) return
    }
    const document = await window.electronAPI.readNote(activeWorkspaceId, task.noteId)
    const lines = document.content.split(/\r?\n/)
    const index = task.line - 1
    if (!lines[index]) return
    lines[index] = lines[index].replace(/\[([ xX])\]/, task.checked ? '[ ]' : '[x]')
    const saved = await window.electronAPI.saveNote(activeWorkspaceId, task.noteId, lines.join('\n'))
    if (activeNote?.id === task.noteId) {
      setActiveNote(saved)
      setContent(saved.content)
      setDirty(false)
      setTagDraft(saved.tags.join(', '))
    }
    taskCacheRef.current.delete(task.noteId)
    await refreshNotes()
    await refreshTasks()
  }

  const toggleInspector = React.useCallback(() => {
    setInspectorCollapsed(prev => {
      const next = !prev
      localStorage.setItem('notes:inspector-collapsed', JSON.stringify(next))
      return next
    })
  }, [])

  const handleRichEditorReady = React.useCallback((editor: TiptapEditorHandle | null) => {
    richEditorRef.current = editor
  }, [])

  const wikiMenu = showWikiMenu ? (
    <div
      className="absolute z-20 w-80 rounded-[8px] border border-border/70 bg-popover p-1 shadow-strong"
      style={wikiAnchor
        ? { left: Math.max(4, wikiAnchor.x), top: wikiAnchor.y }
        : { left: 24, bottom: 24 }
      }
    >
      {wikiMatches.map(note => (
        <button
          key={note.id}
          onClick={() => completeWikiLink(note)}
          className={cn(
            'w-full rounded-[5px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]',
            wikiMatches[wikiIndex]?.id === note.id && 'bg-foreground/[0.08]'
          )}
        >
          <div className="truncate text-xs font-medium">{note.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">{noteRelativeLabel(note)}</div>
        </button>
      ))}
      {wikiCreateLabel && !findNoteByTarget(notes, wikiCreateLabel) && (
        <button
          onClick={() => completeWikiText(wikiCreateLabel)}
          className="mt-1 flex w-full items-center gap-2 rounded-[5px] border-t border-border/60 px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06]"
        >
          <Plus className="h-3.5 w-3.5" />
          Link to new note "{wikiCreateLabel}"
        </button>
      )}
      <div className="border-t border-border/50 px-2 py-1 text-[10px] text-muted-foreground">
        Up/Down select · Enter insert · Esc close
      </div>
    </div>
  ) : null

  if (!activeWorkspaceId) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a workspace to use notes.</div>
  }

  return (
    <>
    <div className="flex h-full min-w-0 bg-background">
      <aside className="w-[300px] shrink-0 border-r border-border/60 flex flex-col min-h-0 bg-muted/[0.16]">
        <div className="shrink-0 px-3 py-2 border-b border-border/60">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search notes"
                className="h-7 w-full rounded-[6px] border border-border/60 bg-background pl-7 pr-2 text-xs outline-none focus:border-foreground/30"
              />
            </div>
            <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => handleDaily()} title="Daily note">
              <CalendarDays className="h-4 w-4" />
            </button>
            <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => setCreateFolderDialogOpen(true)} title="New folder">
              <FolderPlus className="h-4 w-4" />
            </button>
            <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => openCreateNoteDialog()} title="New note">
              <FilePlus2 className="h-4 w-4" />
            </button>
          </div>
          {allTags.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
              <button
                className={cn(
                  'shrink-0 rounded-[5px] px-2 py-1 text-[11px] hover:bg-foreground/[0.06]',
                  !selectedTag && 'bg-foreground/[0.08]'
                )}
                onClick={() => setSelectedTag(null)}
              >
                All
              </button>
              {allTags.map(tag => (
                <button
                  key={tag}
                  className={cn(
                    'shrink-0 rounded-[5px] px-2 py-1 text-[11px] hover:bg-foreground/[0.06]',
                    selectedTag === tag && 'bg-foreground/[0.08]'
                  )}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
        <DndContext sensors={dndSensors} onDragEnd={handleSidebarDragEnd}>
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {(folderTree.rootNotes.length > 0 || folderTree.folders.length > 0) ? (
            <>
              {/* Root-level notes (no folder) */}
              {folderTree.rootNotes.map(note => (
                <DraggableNoteItem key={note.id} note={note}>
                  {(isDragging, dragListeners) => (
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <button
                          onClick={() => handleOpenNote(note.id)}
                          style={{ contentVisibility: 'auto', containIntrinsicSize: '0 44px' }}
                          className={cn(
                            'mb-0.5 w-full rounded-[6px] px-2.5 py-1.5 text-left hover:bg-foreground/[0.05]',
                            activeNote?.id === note.id && 'bg-foreground/[0.08]',
                            isDragging && 'opacity-50'
                          )}
                          {...dragListeners}
                        >
                          <div className="flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                            <div className="min-w-0 flex-1 truncate text-sm">{note.title}</div>
                          </div>
                          {note.tags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1 pl-5">
                              {note.tags.slice(0, 3).map(tag => (
                                <span key={tag} className="rounded-[4px] bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>
                              ))}
                            </div>
                          )}
                        </button>
                      </ContextMenuTrigger>
                      <StyledContextMenuContent>
                        <StyledContextMenuItem onClick={() => handleOpenNote(note.id)}>
                          <FileText className="h-3.5 w-3.5" />
                          Open
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => openRenameDialogForNote(note)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Rename
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => openCreateNoteDialog()}>
                          <FilePlus2 className="h-3.5 w-3.5" />
                          New note here
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => duplicateNote(note)}>
                          <Copy className="h-3.5 w-3.5" />
                          Duplicate
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => openMoveDialog(note)}>
                          <FolderInput className="h-3.5 w-3.5" />
                          Move to folder
                        </StyledContextMenuItem>
                        <StyledContextMenuSeparator />
                        <StyledContextMenuItem onClick={() => copyNoteLink(note)}>
                          <Link2 className="h-3.5 w-3.5" />
                          Copy note link
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => copyNotePath(note)}>
                          <FileText className="h-3.5 w-3.5" />
                          Copy markdown path
                        </StyledContextMenuItem>
                        <StyledContextMenuItem onClick={() => revealNote(note)}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          Reveal in Finder
                        </StyledContextMenuItem>
                        <StyledContextMenuSeparator />
                        <StyledContextMenuItem variant="destructive" onClick={() => openDeleteDialogForNote(note)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </StyledContextMenuItem>
                      </StyledContextMenuContent>
                    </ContextMenu>
                  )}
                </DraggableNoteItem>
              ))}

              {/* Folder tree */}
              {folderTree.folders.map(node => (
                <FolderTreeItem
                  key={node.fullPath}
                  node={node}
                  depth={0}
                  activeNoteId={activeNote?.id}
                  collapsedFolders={collapsedFolders}
                  onToggleFolder={toggleFolder}
                  onOpenNote={handleOpenNote}
                  onOpenCreateNoteDialog={openCreateNoteDialog}
                  onOpenRenameFolder={openRenameFolderDialog}
                  onOpenDeleteFolder={openDeleteFolderDialog}
                  onOpenMoveDialog={openMoveDialog}
                  onOpenRenameDialogForNote={openRenameDialogForNote}
                  onOpenDeleteDialogForNote={openDeleteDialogForNote}
                  onDuplicateNote={duplicateNote}
                  onCopyNoteLink={copyNoteLink}
                  onCopyNotePath={copyNotePath}
                  onRevealNote={revealNote}
                />
              ))}
            </>
          ) : (
            <div className="px-3 py-10 text-center text-xs text-muted-foreground">
              {query || selectedTag ? 'No matching notes' : 'No notes yet'}
            </div>
          )}
        </div>
        </DndContext>
        <div className="shrink-0 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
          {notes.length} note{notes.length === 1 ? '' : 's'} · {allAssets.length} asset{allAssets.length === 1 ? '' : 's'}
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <div className="h-[42px] shrink-0 border-b border-border/60 px-3 flex items-center gap-2">
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <div className="truncate text-sm font-medium">{activeNote?.title ?? 'Notes'}</div>
            {activeNote && <div className="shrink-0 text-[11px] text-muted-foreground/60">{activeNoteStats}</div>}
          </div>
          {dailyDate && (
            <div className="mr-1 flex items-center gap-1">
              <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => handleDailyShift(-1)} title="Previous daily note">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground">{dailyDate}</span>
              <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center" onClick={() => handleDailyShift(1)} title="Next daily note">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <NotesAIMenu activeNote={activeNote} onAction={handleAskAgent} />
          <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center disabled:opacity-40" onClick={handleImportAsset} disabled={!activeNote} title="Attach asset">
            <Paperclip className="h-4 w-4" />
          </button>
          <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center disabled:opacity-40" onClick={handleExportPdf} disabled={!activeNote} title="Export as PDF">
            <FileDown className="h-4 w-4" />
          </button>
          <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center" onClick={openRenameDialog} disabled={!activeNote} title="Rename note">
            <Pencil className="h-4 w-4" />
          </button>
          <button className="h-7 w-7 rounded-[5px] hover:bg-destructive/10 hover:text-destructive text-muted-foreground grid place-items-center disabled:opacity-40" onClick={() => setDeleteDialogOpen(true)} disabled={!activeNote} title="Delete note">
            <Trash2 className="h-4 w-4" />
          </button>
          <span className={cn('w-20 text-right text-[11px]', saveError ? 'text-destructive' : 'text-muted-foreground')} title="Notes autosave as you type">
            {saveError ? 'Save failed' : saving ? 'Saving' : dirty ? 'Autosaving' : activeNote ? 'Saved' : ''}
          </span>
        </div>

        <div className="relative flex-1 min-h-0">
          {!activeNote ? (
            <div className="h-full grid place-items-center">
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading note...</div>
              ) : (
                <div className="w-[360px] max-w-[calc(100%-48px)] rounded-[8px] border border-border/60 bg-muted/[0.16] p-4 text-center">
                  <div className="text-sm font-medium">No note selected</div>
                  <div className="mt-1 text-xs text-muted-foreground">Open a note, create one, or start today's daily note.</div>
                  <div className="mt-3 flex justify-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleDaily()}>
                      <CalendarDays className="h-3.5 w-3.5" />
                      Daily
                    </Button>
                    <Button size="sm" onClick={() => openCreateNoteDialog()}>
                      <FilePlus2 className="h-3.5 w-3.5" />
                      New note
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              className="h-full overflow-y-auto px-6 py-6"
              onKeyDownCapture={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void openWikiLinkAtCursor()
                  return
                }
                if (!showWikiMenu) return
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setWikiIndex(index => Math.min(index + 1, Math.max(0, wikiMatches.length - 1)))
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setWikiIndex(index => Math.max(index - 1, 0))
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setWikiQuery(null)
                  return
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault()
                  const match = wikiMatches[wikiIndex]
                  if (match) completeWikiLink(match)
                  else if (wikiCreateLabel) completeWikiText(wikiCreateLabel)
                }
              }}
              onKeyUpCapture={syncRichWikiQuery}
              onMouseUpCapture={syncRichWikiQuery}
              onPasteCapture={(event) => {
                if (event.clipboardData.files.length > 0) {
                  event.preventDefault()
                  event.stopPropagation()
                  void importFiles(event.clipboardData.files)
                }
              }}
              onDropCapture={(event) => {
                if (event.dataTransfer.files.length > 0) {
                  event.preventDefault()
                  event.stopPropagation()
                  void importFiles(event.dataTransfer.files)
                }
              }}
            >
              <TiptapMarkdownEditor
                key={activeNote.id}
                content={richParts.body}
                onEditorReady={handleRichEditorReady}
                onUpdate={handleRichBodyChange}
                onWikiLinkClick={(target) => {
                  const note = findNoteByTarget(notes, target)
                  if (note) { void handleOpenNote(note.id) }
                  else { setMissingLinkTarget(target) }
                }}
                placeholder="Write note..."
                markdownEngine="legacy"
                className="mx-auto w-full max-w-[720px] min-h-full"
              />
              {richParts.frontmatter && (
                <div className="mt-4 rounded-[6px] border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                  Frontmatter is preserved. Edit tags and properties in the right panel.
                </div>
              )}
              {wikiMenu}
            </div>
          )}
        </div>
      </main>

      <NoteInspector
        activeNote={activeNote}
        content={content}
        notes={notes}
        allTasks={allTasks}
        allAssets={allAssets}
        selectedTag={selectedTag}
        tagDraft={tagDraft}
        propertyEntries={propertyEntries}
        newPropertyKey={newPropertyKey}
        newPropertyValue={newPropertyValue}
        currentNoteAssets={currentNoteAssets}
        uncreatedLinks={uncreatedLinks}
        activeNoteTasks={activeNoteTasks}
        openTasks={openTasks}
        onTagDraftChange={setTagDraft}
        onApplyTags={applyTags}
        onTagClick={(tag) => setSelectedTag(selectedTag === tag ? null : tag)}
        onUpdateProperty={updateProperty}
        onNewPropertyKeyChange={setNewPropertyKey}
        onNewPropertyValueChange={setNewPropertyValue}
        onAddProperty={addProperty}
        onOpenAssetDialog={() => setAssetDialogOpen(true)}
        onOpenFile={onOpenFile}
        onToggleTask={toggleTask}
        onOpenNote={handleOpenNote}
        onMissingLink={setMissingLinkTarget}
        collapsed={inspectorCollapsed}
        onToggleCollapsed={toggleInspector}
      />
    </div>
    <NotesDialogs
      createDialogOpen={createDialogOpen}
      createTitle={createTitle}
      createInFolder={createInFolder}
      onCreateDialogOpenChange={(open) => { setCreateDialogOpen(open); if (!open) setCreateInFolder(undefined) }}
      onCreateTitleChange={setCreateTitle}
      onCreateNote={handleCreate}
      createFolderDialogOpen={createFolderDialogOpen}
      createFolderName={createFolderName}
      onCreateFolderDialogOpenChange={setCreateFolderDialogOpen}
      onCreateFolderNameChange={setCreateFolderName}
      onCreateFolder={handleCreateFolder}
      moveDialogOpen={moveDialogOpen}
      moveTargetNote={moveTargetNote}
      moveFolderName={moveFolderName}
      onMoveDialogOpenChange={setMoveDialogOpen}
      onMoveFolderNameChange={setMoveFolderName}
      onMoveNote={moveNoteToFolder}
      renameDialogOpen={renameDialogOpen}
      renameTitle={renameTitle}
      renameImpact={renameImpact}
      activeNote={activeNote}
      onRenameDialogOpenChange={setRenameDialogOpen}
      onRenameTitleChange={setRenameTitle}
      onRenameNote={handleRename}
      deleteDialogOpen={deleteDialogOpen}
      onDeleteDialogOpenChange={setDeleteDialogOpen}
      onDeleteNote={handleDelete}
      externalChange={externalChange}
      onDismissExternalChange={() => setExternalChange(null)}
      onReloadNote={() => { const noteId = externalChange?.noteId; setExternalChange(null); if (noteId) void openNote(noteId) }}
      missingLinkTarget={missingLinkTarget}
      onDismissMissingLink={() => setMissingLinkTarget(null)}
      onCreateMissingLink={createMissingLinkNote}
      assetDialogOpen={assetDialogOpen}
      allAssets={allAssets}
      orphanAssets={orphanAssets}
      assetBusy={assetBusy}
      onAssetDialogOpenChange={setAssetDialogOpen}
      onImportAsset={handleImportAsset}
      onCleanUnusedAssets={handleCleanUnusedAssets}
      onOpenFile={onOpenFile}
      onOpenAssetRenameDialog={openAssetRenameDialog}
      onDeleteAsset={handleDeleteAsset}
      assetRenameTarget={assetRenameTarget}
      assetRenameName={assetRenameName}
      onAssetRenameTargetChange={setAssetRenameTarget}
      onAssetRenameNameChange={setAssetRenameName}
      onRenameAsset={handleRenameAsset}
      renameFolderDialogOpen={renameFolderDialogOpen}
      renameFolderTarget={renameFolderTarget}
      renameFolderName={renameFolderName}
      onRenameFolderDialogOpenChange={setRenameFolderDialogOpen}
      onRenameFolderNameChange={setRenameFolderName}
      onRenameFolder={handleRenameFolder}
      deleteFolderDialogOpen={deleteFolderDialogOpen}
      deleteFolderTarget={deleteFolderTarget}
      deleteFolderNoteCount={notes.filter(n => noteFolder(n) === deleteFolderTarget || noteFolder(n).startsWith(deleteFolderTarget + '/')).length}
      onDeleteFolderDialogOpenChange={setDeleteFolderDialogOpen}
      onDeleteFolder={handleDeleteFolder}
    />
    </>
  )
}
