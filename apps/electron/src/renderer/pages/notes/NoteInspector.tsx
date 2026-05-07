import * as React from 'react'
import { Check, CheckSquare2, ChevronLeft, ChevronRight, FileText, Link2, ListChecks, Paperclip, Plus, Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NoteAsset, NoteDocument, NoteSummary } from '../../../shared/types'

// ---------------------------------------------------------------------------
// Types shared between inspector and dialogs
// ---------------------------------------------------------------------------

export type NoteTask = {
  noteId: string
  noteTitle: string
  line: number
  text: string
  checked: boolean
}

export function noteRelativeLabel(note: Pick<NoteSummary, 'relativePath'>): string {
  return note.relativePath.replace(/\.md$/i, '')
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function resolveNoteAssetPath(note: NoteDocument, ref: string): string {
  if (/^\/|^[A-Za-z]:[\\/]/.test(ref)) return ref
  const normalized = ref.replace(/^\.\//, '')
  const noteRootPath = note.path.endsWith(note.relativePath.replace(/\//g, '/'))
    ? note.path.slice(0, -note.relativePath.length).replace(/[\\/]$/, '')
    : note.path.replace(/[\\/][^\\/]+$/, '')
  if (normalized.startsWith('assets/')) return `${noteRootPath}/${normalized}`
  return `${note.path.replace(/[\\/][^\\/]+$/, '')}/${normalized}`
}

// ---------------------------------------------------------------------------
// AssetThumbnail — uses thumbnail:// protocol in Electron for efficient resize
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

export function AssetThumbnail({ asset, size = 'sm' }: { asset: NoteAsset; size?: 'sm' | 'md' }) {
  const [failed, setFailed] = React.useState(false)
  const ext = asset.name.split('.').pop()?.toLowerCase() ?? ''
  const dim = size === 'md' ? 'h-10 w-10' : 'h-7 w-7'

  if (!failed && IMAGE_EXTS.has(ext)) {
    return (
      <img
        src={`thumbnail://thumb/${encodeURIComponent(asset.path)}`}
        className={cn(dim, 'rounded object-cover shrink-0 border border-border/40')}
        alt=""
        onError={() => setFailed(true)}
      />
    )
  }
  if (ext === 'pdf') return <FileText className="h-4 w-4 shrink-0 text-destructive/70" />
  return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
}

// ---------------------------------------------------------------------------
// NoteInspector
// ---------------------------------------------------------------------------

export interface NoteInspectorProps {
  activeNote: NoteDocument | null
  content: string
  notes: NoteSummary[]
  allTasks: NoteTask[]
  allAssets: NoteAsset[]
  selectedTag: string | null
  tagDraft: string
  propertyEntries: [string, unknown][]
  newPropertyKey: string
  newPropertyValue: string
  currentNoteAssets: NoteAsset[]
  uncreatedLinks: string[]
  activeNoteTasks: NoteTask[]
  openTasks: NoteTask[]
  onTagDraftChange(v: string): void
  onApplyTags(): void
  onTagClick(tag: string): void
  onUpdateProperty(key: string, value: unknown | undefined): void
  onNewPropertyKeyChange(v: string): void
  onNewPropertyValueChange(v: string): void
  onAddProperty(): void
  onOpenAssetDialog(): void
  onOpenFile(path: string): void
  onToggleTask(task: NoteTask): void
  onOpenNote(noteId: string): void
  onMissingLink(target: string): void
  collapsed?: boolean
  onToggleCollapsed?(): void
}

function propertyToInput(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(', ') : String(value ?? '')
}

function inputToProperty(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed.includes(',')) return trimmed.split(',').map(part => part.trim()).filter(Boolean)
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return trimmed.replace(/^['"]|['"]$/g, '')
}

export function NoteInspector({
  activeNote,
  allAssets,
  selectedTag,
  tagDraft,
  propertyEntries,
  newPropertyKey,
  newPropertyValue,
  currentNoteAssets,
  uncreatedLinks,
  activeNoteTasks,
  openTasks,
  onTagDraftChange,
  onApplyTags,
  onTagClick,
  onUpdateProperty,
  onNewPropertyKeyChange,
  onNewPropertyValueChange,
  onAddProperty,
  onOpenAssetDialog,
  onOpenFile,
  onToggleTask,
  onOpenNote,
  onMissingLink,
  collapsed = false,
  onToggleCollapsed,
}: NoteInspectorProps) {
  if (collapsed) {
    return (
      <aside className="w-8 shrink-0 border-l border-border/60 bg-muted/[0.12] flex flex-col items-center pt-2">
        <button
          className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center text-muted-foreground"
          onClick={onToggleCollapsed}
          title="Expand inspector"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </aside>
    )
  }

  if (!activeNote) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-border/60 overflow-y-auto bg-muted/[0.12] p-3">
        <div className="mb-2 flex items-center justify-end">
          <button
            className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center text-muted-foreground"
            onClick={onToggleCollapsed}
            title="Collapse inspector"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="rounded-[8px] border border-dashed border-border/70 bg-background/50 p-4 text-center">
          <div className="text-sm font-medium">Note inspector</div>
          <div className="mt-1 text-xs text-muted-foreground">Tags, properties, assets, unresolved links, and backlinks appear here.</div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-[320px] shrink-0 border-l border-border/60 overflow-y-auto bg-muted/[0.12] p-3">
      <div className="mb-3 flex items-center justify-end">
        <button
          className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center text-muted-foreground"
          onClick={onToggleCollapsed}
          title="Collapse inspector"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {/* Tags */}
      <section className="mb-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Tag className="h-3.5 w-3.5" />
          Tags
        </div>
        <div className="mb-2 flex gap-1.5">
          <input
            value={tagDraft}
            onChange={(e) => onTagDraftChange(e.target.value)}
            onBlur={onApplyTags}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); onApplyTags() } }}
            placeholder="tag-a, tag-b"
            className="h-7 min-w-0 flex-1 rounded-[6px] border border-border/60 bg-background px-2 text-xs outline-none focus:border-foreground/30"
          />
          <button className="h-7 rounded-[5px] px-2 text-xs hover:bg-foreground/[0.06]" onClick={onApplyTags}>
            Apply
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {activeNote.tags.length ? activeNote.tags.map(tag => (
            <button
              key={tag}
              className={cn(
                'rounded-[5px] bg-foreground/[0.06] px-2 py-1 text-[11px] hover:bg-foreground/[0.1]',
                selectedTag === tag && 'bg-foreground/[0.12]'
              )}
              onClick={() => onTagClick(tag)}
            >
              #{tag}
            </button>
          )) : <span className="text-xs text-muted-foreground">None</span>}
        </div>
      </section>

      {/* Tasks */}
      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CheckSquare2 className="h-3.5 w-3.5" />
            Tasks
          </div>
          <span className="text-[11px] text-muted-foreground">{openTasks.length} open</span>
        </div>
        <div className="space-y-1">
          {(activeNoteTasks.length ? activeNoteTasks : openTasks.slice(0, 8)).map(task => (
            <button
              key={`${task.noteId}:${task.line}:${task.text}`}
              onClick={() => onToggleTask(task)}
              className="flex w-full items-start gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
            >
              <span className={cn(
                'mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] border border-border/80',
                task.checked && 'bg-foreground text-background'
              )}>
                {task.checked && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-xs', task.checked && 'text-muted-foreground line-through')}>{task.text}</span>
                {task.noteId !== activeNote.id && <span className="block truncate text-[11px] text-muted-foreground">{task.noteTitle}</span>}
              </span>
            </button>
          ))}
          {activeNoteTasks.length === 0 && openTasks.length === 0 && (
            <span className="text-xs text-muted-foreground">No markdown tasks</span>
          )}
        </div>
      </section>

      {/* Properties */}
      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">Properties</div>
          <span className="text-[11px] text-muted-foreground">frontmatter</span>
        </div>
        <div className="space-y-1.5">
          {propertyEntries.length > 0 ? propertyEntries.map(([key, value]) => (
            <div key={key} className="rounded-[6px] bg-background/80 px-2 py-1.5 ring-1 ring-border/50">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="truncate text-[11px] text-muted-foreground">{key}</div>
                <button
                  className="grid h-5 w-5 place-items-center rounded-[4px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onUpdateProperty(key, undefined)}
                  title={`Remove ${key}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <input
                key={`${activeNote.id}:${key}:${propertyToInput(value)}`}
                defaultValue={propertyToInput(value)}
                onBlur={(e) => onUpdateProperty(key, inputToProperty(e.target.value))}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                className="h-7 w-full rounded-[5px] border border-border/50 bg-background px-2 text-xs outline-none focus:border-foreground/30"
              />
            </div>
          )) : <span className="text-xs text-muted-foreground">None</span>}
        </div>
        <div className="mt-2 rounded-[6px] border border-dashed border-border/70 bg-background/50 p-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Plus className="h-3 w-3" />
            Add property
          </div>
          <div className="flex gap-1.5">
            <input
              value={newPropertyKey}
              onChange={(e) => onNewPropertyKeyChange(e.target.value)}
              placeholder="key"
              className="h-7 min-w-0 flex-1 rounded-[5px] border border-border/50 bg-background px-2 text-xs outline-none focus:border-foreground/30"
            />
            <input
              value={newPropertyValue}
              onChange={(e) => onNewPropertyValueChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onAddProperty() }}
              placeholder="value"
              className="h-7 min-w-0 flex-1 rounded-[5px] border border-border/50 bg-background px-2 text-xs outline-none focus:border-foreground/30"
            />
            <button className="h-7 w-7 rounded-[5px] hover:bg-foreground/[0.06] grid place-items-center" onClick={onAddProperty} title="Add property">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Assets */}
      <section className="mb-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />
            Assets
          </div>
          <button
            className="h-6 rounded-[5px] px-2 text-[11px] hover:bg-foreground/[0.06]"
            onClick={onOpenAssetDialog}
          >
            Manage
          </button>
        </div>
        <div className="space-y-1">
          {currentNoteAssets.length ? currentNoteAssets.map(asset => (
            <button
              key={asset.relativePath}
              className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
              onClick={() => onOpenFile(asset.path)}
            >
              <AssetThumbnail asset={asset} size="sm" />
              <span className="min-w-0 flex-1 truncate text-xs">{asset.name}</span>
              <span className="text-[10px] text-muted-foreground">{formatBytes(asset.size)}</span>
            </button>
          )) : activeNote.assetRefs.length ? activeNote.assetRefs.map(ref => (
            <button
              key={ref}
              className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
              onClick={() => onOpenFile(resolveNoteAssetPath(activeNote, ref))}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs">{ref}</span>
            </button>
          )) : <span className="text-xs text-muted-foreground">No assets</span>}
        </div>
      </section>

      {/* Uncreated links */}
      <section className="mb-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" />
          Uncreated links
        </div>
        <div className="space-y-1">
          {uncreatedLinks.length ? uncreatedLinks.map(target => (
            <button
              key={target}
              onClick={() => onMissingLink(target)}
              className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
            >
              <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs">{target}</span>
            </button>
          )) : <span className="text-xs text-muted-foreground">All wiki links resolve</span>}
        </div>
      </section>

      {/* Backlinks */}
      <section>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          Backlinks
        </div>
        <div className="space-y-1">
          {activeNote.backlinks.length ? activeNote.backlinks.map((backlink, index) => (
            <button
              key={`${backlink.noteId}-${index}`}
              onClick={() => onOpenNote(backlink.noteId)}
              className="w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]"
            >
              <div className="truncate text-xs font-medium">{backlink.title}</div>
              <div className="line-clamp-2 text-[11px] text-muted-foreground">{backlink.preview}</div>
            </button>
          )) : <span className="text-xs text-muted-foreground">No backlinks</span>}
        </div>
      </section>
    </aside>
  )
}
