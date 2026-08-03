import React from 'react'
import { useAtomValue } from 'jotai'
import { backgroundTasksAtomFamily, type BackgroundTask } from '../atoms/sessions'
import { AlertCircle, CheckCircle2, Code2, ExternalLink, FileText, Loader2, Play, Plus, RefreshCw, Save, Square, Trash2, XCircle } from 'lucide-react'
import { classifyFile, Markdown, ShikiCodeViewer } from '@archstudio/ui'
import { toast } from 'sonner'
import './WorkspaceTabPanels.css'

// ─── Types ────────────────────────────────────────────────────────────

export type WorkspaceArtifact = {
  id: string
  title: string
  kind: 'text' | 'markdown' | 'html' | 'json'
  content: string
  sourcePath?: string
  updatedAt: number
}

type CommonProps = {
  filePath: string | null
  onChooseFile: () => void
  onOpenExternal: (path: string) => void
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function useTextFile(path: string | null) {
  const [content, setContent] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const reload = React.useCallback(async () => {
    if (!path) return
    setLoading(true)
    setError(null)
    try { setContent(await window.electronAPI.readFile(path)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to read file') }
    finally { setLoading(false) }
  }, [path])
  React.useEffect(() => { void reload() }, [reload])
  return { content, loading, error, reload }
}

// ─── Shared UI helpers ─────────────────────────────────────────────────

function SurfaceHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return <header className="workspace-surface__header">
    <div>
      <strong>{title}</strong>
      {subtitle && <small>{subtitle}</small>}
    </div>
    {actions && <div className="workspace-surface__actions">{actions}</div>}
  </header>
}

function StateLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="workspace-state-line">{icon}<span>{children}</span></div>
}

function Empty({ icon, title, detail, action, onAction }: { icon: React.ReactNode; title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="workspace-empty">{icon}<strong>{title}</strong><p>{detail}</p>{action && onAction && <button onClick={onAction}>{action}</button>}</div>
}

function formatJson(content: string): string {
  try { return JSON.stringify(JSON.parse(content), null, 2) } catch { return content }
}

// ─── Editor panel (merges Code + Canvas) ───────────────────────────────

// File extensions that should use the read-only Shiki code viewer
// rather than the editable Tiptap markdown editor.
const CODE_FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs',
  'py', 'rs', 'go', 'rb', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'kt', 'swift', 'php', 'sql', 'sh', 'bash', 'zsh',
  'css', 'scss', 'less', 'vue', 'svelte',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'dockerfile', 'makefile', 'cmake',
])

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])
const HTML_EXTENSIONS = new Set(['html', 'htm'])
const JSON_EXTENSIONS = new Set(['json', 'json5', 'jsonc'])

function isCodeFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return CODE_FILE_EXTENSIONS.has(ext)
}

function isMarkdownFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return MARKDOWN_EXTENSIONS.has(ext)
}

function isHtmlFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return HTML_EXTENSIONS.has(ext)
}

function isJsonFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return JSON_EXTENSIONS.has(ext)
}

// Maximum file size for loading into the Tiptap editor (100KB)
const EDITOR_MAX_SIZE = 100_000

export interface EditorWorkspacePanelProps {
  filePath: string | null
  artifacts: WorkspaceArtifact[]
  selectedArtifactId: string | null
  onSelectArtifact: (id: string | null) => void
  onChooseFile: () => void
  onOpenExternal: (path: string) => void
  onSaveFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
  onCreateArtifact: () => void
  onChangeArtifact: (artifact: WorkspaceArtifact) => void
  onDeleteArtifact: (id: string) => void
  onPreview: () => void
  theme: 'light' | 'dark'
}

export function EditorWorkspacePanel({
  filePath,
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
  onChooseFile,
  onOpenExternal,
  onSaveFile,
  onCreateArtifact,
  onChangeArtifact,
  onDeleteArtifact,
  onPreview,
  theme,
}: EditorWorkspacePanelProps) {
  const selectedArtifact = artifacts.find((a) => a.id === selectedArtifactId) ?? null
  // If an artifact is selected, edit that. Otherwise edit the file.
  const editingArtifact = selectedArtifact !== null
  const editingPath = editingArtifact ? null : filePath

  // File content (only loaded when editing a file, not an artifact)
  const { content: fileContent, loading: fileLoading, error: fileError, reload: reloadFile } = useTextFile(editingPath)

  // Determine the editor mode and content
  let editorContent = ''
  let editorTitle = 'Untitled'
  let editorMode: 'tiptap' | 'shiki' | 'none' = 'none'

  if (editingArtifact) {
    editorContent = selectedArtifact!.content
    editorTitle = selectedArtifact!.title
    editorMode = 'tiptap' // Artifacts are always editable via Tiptap
  } else if (editingPath) {
    editorContent = fileContent
    editorTitle = basename(editingPath)
    if (isMarkdownFile(editingPath) || isHtmlFile(editingPath) || isJsonFile(editingPath)) {
      editorMode = 'tiptap'
    } else if (isCodeFile(editingPath)) {
      editorMode = 'shiki'
    } else {
      editorMode = 'shiki' // Default to read-only viewer for unknown types
    }
  }

  // Dirty state tracking
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const currentContentRef = React.useRef(editorContent)

  // Reset dirty state when switching targets
  React.useEffect(() => {
    setDirty(false)
    currentContentRef.current = editorContent
  }, [editingArtifact ? selectedArtifact!.id : editingPath])

  const handleContentChange = React.useCallback((newContent: string) => {
    currentContentRef.current = newContent
    if (editingArtifact) {
      onChangeArtifact({ ...selectedArtifact!, content: newContent, updatedAt: Date.now() })
    }
    setDirty(newContent !== editorContent)
  }, [editingArtifact, selectedArtifact, onChangeArtifact, editorContent])

  const handleSave = React.useCallback(async () => {
    if (!editingPath || !dirty) return
    setSaving(true)
    try {
      const result = await onSaveFile(editingPath, currentContentRef.current)
      if (result.success) {
        toast.success('File saved')
        setDirty(false)
      } else {
        toast.error(result.error || 'Save failed')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editingPath, dirty, onSaveFile])

  // Large file fallback
  const tooLarge = editingPath && fileContent.length > EDITOR_MAX_SIZE

  // Empty state: nothing selected
  if (!editingArtifact && !editingPath) {
    return <div className="editor-workspace">
      <aside className="editor-list">
        <button className="editor-list__new" onClick={onChooseFile}><FileText size={14}/> Open file…</button>
        <button className="editor-list__new" onClick={onCreateArtifact}><Plus size={14}/> New artifact</button>
        {artifacts.length > 0 && <>
          <span className="editor-list__section">Artifacts</span>
          {artifacts.map((item) => (
            <button key={item.id} className={item.id === selectedArtifactId ? 'is-active' : ''} onClick={() => onSelectArtifact(item.id)}>
              <FileText size={14}/><span>{item.title}</span>
            </button>
          ))}
        </>}
      </aside>
      <Empty icon={<Code2 />} title="Nothing to edit" detail="Open a file from the Files rail or create a new artifact to start editing." action="Choose file" onAction={onChooseFile} />
    </div>
  }

  return <div className="editor-workspace">
    {/* Sidebar */}
    <aside className="editor-list">
      <button className="editor-list__new" onClick={onChooseFile}><FileText size={14}/> Open file…</button>
      <button className="editor-list__new" onClick={onCreateArtifact}><Plus size={14}/> New artifact</button>

      {filePath && (
        <button className={!editingArtifact ? 'is-active' : ''} onClick={() => onSelectArtifact(null)}>
          <Code2 size={14}/><span>{basename(filePath)}</span>
        </button>
      )}

      {artifacts.length > 0 && <>
        <span className="editor-list__section">Artifacts</span>
        {artifacts.map((item) => (
          <button key={item.id} className={item.id === selectedArtifactId ? 'is-active' : ''} onClick={() => onSelectArtifact(item.id)}>
            <FileText size={14}/><span>{item.title}</span>
          </button>
        ))}
      </>}
    </aside>

    {/* Main editor area */}
    <section className="workspace-surface">
      <SurfaceHeader
        title={editorTitle}
        subtitle={editingArtifact ? `${selectedArtifact!.kind} artifact` : editingPath ?? ''}
        actions={<>
          {editorMode === 'shiki' && editingPath && (
            <button onClick={() => void reloadFile()} title="Reload"><RefreshCw size={14}/> Reload</button>
          )}
          {editorMode === 'tiptap' && editingPath && (
            <button onClick={handleSave} disabled={!dirty || saving} className={dirty ? 'editor-save--dirty' : ''}>
              <Save size={14}/> {saving ? 'Saving…' : dirty ? 'Save*' : 'Save'}
            </button>
          )}
          <button onClick={onPreview}><Play size={14}/> Preview</button>
          {editingArtifact && (
            <button className="danger" onClick={() => { if (window.confirm('Delete this artifact?')) onDeleteArtifact(selectedArtifact!.id) }}>
              <Trash2 size={14}/> Delete
            </button>
          )}
          {editingPath && (
            <button onClick={() => onOpenExternal(editingPath)}><ExternalLink size={14}/> Edit externally</button>
          )}
        </>}
      />

      <div className="workspace-surface__body">
        {editingPath && fileLoading ? (
          <StateLine icon={<Loader2 className="spin"/>}>Reading file…</StateLine>
        ) : editingPath && fileError ? (
          <StateLine icon={<AlertCircle/>}>{fileError}</StateLine>
        ) : tooLarge ? (
          <StateLine icon={<AlertCircle/>}>File is too large for the inline editor ({(fileContent.length / 1024).toFixed(0)}KB). Use "Edit externally" to open it in your default editor.</StateLine>
        ) : editorMode === 'shiki' ? (
          <div className="editor-shiki-wrapper">
            <ShikiCodeViewer
              code={editorContent}
              filePath={editingPath ?? undefined}
              theme={theme}
              className="editor-shiki"
            />
          </div>
        ) : editorMode === 'tiptap' ? (
          <div className="editor-tiptap-wrapper">
            {/* Artifact metadata controls */}
            {editingArtifact && (
              <div className="editor-artifact-meta">
                <input
                  aria-label="Artifact title"
                  value={selectedArtifact!.title}
                  onChange={(e) => onChangeArtifact({ ...selectedArtifact!, title: e.target.value, updatedAt: Date.now() })}
                  className="editor-artifact-title"
                />
                <select
                  aria-label="Artifact type"
                  value={selectedArtifact!.kind}
                  onChange={(e) => onChangeArtifact({ ...selectedArtifact!, kind: e.target.value as WorkspaceArtifact['kind'], updatedAt: Date.now() })}
                  className="editor-artifact-kind"
                >
                  <option value="text">Text</option>
                  <option value="markdown">Markdown</option>
                  <option value="html">HTML</option>
                  <option value="json">JSON</option>
                </select>
              </div>
            )}
            {/* Use Markdown viewer for read-only display of the current content,
                or a plain textarea for editing when Tiptap is not suitable */}
            <EditorContentArea
              content={editorContent}
              kind={editingArtifact ? selectedArtifact!.kind : isMarkdownFile(editingPath!) ? 'markdown' : isHtmlFile(editingPath!) ? 'html' : isJsonFile(editingPath!) ? 'json' : 'text'}
              editable={!editingPath || isMarkdownFile(editingPath) || isHtmlFile(editingPath) || isJsonFile(editingPath)}
              onChange={handleContentChange}
            />
            {editingArtifact && (
              <span className="editor-artifact-saved"><Save size={12}/> Saved locally for this session</span>
            )}
          </div>
        ) : (
          <Empty icon={<Code2 />} title="Nothing to edit" detail="Select a file or artifact from the sidebar." action="Choose file" onAction={onChooseFile} />
        )}
      </div>
    </section>
  </div>
}

// ─── Editor content area ───────────────────────────────────────────────
// Uses a plain textarea for editing (reliable, handles all file types),
// but renders a live Markdown preview alongside for markdown content.

function EditorContentArea({
  content,
  kind,
  editable,
  onChange,
}: {
  content: string
  kind: 'text' | 'markdown' | 'html' | 'json'
  editable: boolean
  onChange: (content: string) => void
}) {
  if (!editable) {
    // Read-only: show formatted content
    if (kind === 'json') {
      return <pre className="workspace-code"><code>{formatJson(content)}</code></pre>
    }
    return <pre className="workspace-code"><code>{content}</code></pre>
  }

  // Editable: use a textarea for all content types.
  // For JSON, auto-format on blur.
  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (kind === 'json') {
      try {
        const formatted = JSON.stringify(JSON.parse(e.target.value), null, 2)
        onChange(formatted)
        e.target.value = formatted
      } catch {
        // Invalid JSON — keep as-is
      }
    }
  }

  return <textarea
    className="editor-textarea"
    value={content}
    onChange={(e) => onChange(e.target.value)}
    onBlur={handleBlur}
    spellCheck={false}
    placeholder={kind === 'markdown' ? '# Write markdown here…' : kind === 'json' ? '{}' : 'Type here…'}
  />
}

// ─── Preview panel (fixed: uses real Markdown + Shiki renderers) ────────

export function PreviewWorkspacePanel({
  filePath,
  artifact,
  onChooseFile,
  onOpenExternal,
  theme,
}: Pick<CommonProps, 'filePath' | 'onChooseFile' | 'onOpenExternal'> & {
  artifact?: WorkspaceArtifact | null
  theme: 'light' | 'dark'
}) {
  const effectivePath = artifact ? null : filePath
  const classification = effectivePath ? classifyFile(effectivePath) : null
  const { content, loading, error, reload } = useTextFile(
    effectivePath && classification?.type !== 'image' && classification?.type !== 'pdf' ? effectivePath : null
  )
  const [dataUrl, setDataUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    setDataUrl(null)
    if (!effectivePath || classification?.type !== 'image') return
    void window.electronAPI.readFileDataUrl(effectivePath).then(setDataUrl).catch(() => setDataUrl(null))
  }, [effectivePath, classification?.type])

  if (!effectivePath && !artifact) {
    return <Empty icon={<Play />} title="Nothing selected to preview" detail="Select a file in the Editor or double-click one in the Files rail." action="Choose file" onAction={onChooseFile} />
  }

  // Artifact preview
  if (artifact) {
    const previewContent = artifact.content
    return <section className="workspace-surface">
      <SurfaceHeader title={artifact.title} subtitle={`${artifact.kind} Canvas preview`} />
      <div className="workspace-preview">
        {artifact.kind === 'html' ? (
          <iframe title={artifact.title} sandbox="" srcDoc={previewContent} />
        ) : artifact.kind === 'markdown' ? (
          <article className="workspace-document workspace-document--markdown">
            <Markdown mode="full">{previewContent}</Markdown>
          </article>
        ) : artifact.kind === 'json' ? (
          <pre className="workspace-code"><code>{formatJson(previewContent)}</code></pre>
        ) : (
          <article className="workspace-document"><pre>{previewContent}</pre></article>
        )}
      </div>
    </section>
  }

  // File preview
  const type = classification?.type
  const path = effectivePath!

  return <section className="workspace-surface">
    <SurfaceHeader
      title={basename(path)}
      subtitle={type ? `${type} preview` : 'Preview unavailable'}
      actions={<>
        <button onClick={() => void reload()}><RefreshCw size={14}/> Refresh</button>
        <button onClick={() => onOpenExternal(path)}><ExternalLink size={14}/> Open externally</button>
      </>}
    />
    <div className="workspace-preview">
      {type === 'image' ? (
        dataUrl ? <img src={dataUrl} alt={basename(path)} /> : <StateLine icon={<Loader2 className="spin"/>}>Loading image…</StateLine>
      ) : type === 'pdf' ? (
        <StateLine icon={<FileText/>}>PDF preview is available from the file overlay. Open the file to inspect it.</StateLine>
      ) : loading ? (
        <StateLine icon={<Loader2 className="spin"/>}>Rendering preview…</StateLine>
      ) : error ? (
        <StateLine icon={<AlertCircle/>}>{error}</StateLine>
      ) : type === 'markdown' ? (
        <article className="workspace-document workspace-document--markdown">
          <Markdown mode="full">{content}</Markdown>
        </article>
      ) : path.toLowerCase().endsWith('.html') ? (
        <iframe title={basename(path)} sandbox="" srcDoc={content} />
      ) : type === 'json' ? (
        <pre className="workspace-code"><code>{formatJson(content)}</code></pre>
      ) : type && type === 'code' ? (
        <div className="editor-shiki-wrapper">
          <ShikiCodeViewer code={content} filePath={path} theme={theme} className="editor-shiki" />
        </div>
      ) : type ? (
        <pre className="workspace-code"><code>{content}</code></pre>
      ) : (
        <StateLine icon={<AlertCircle/>}>This file type cannot be previewed here.</StateLine>
      )}
    </div>
  </section>
}

// ─── Tasks panel (unchanged) ────────────────────────────────────────────

export function TasksWorkspacePanel({ sessionId, onOpenOutput }: { sessionId: string | null; onOpenOutput: (path: string) => void }) {
  const tasks = useAtomValue(backgroundTasksAtomFamily(sessionId ?? '__none__'))
  if (!sessionId) return <Empty icon={<Square/>} title="No active chat" detail="Open a chat to see its background jobs and task output." />
  if (tasks.length === 0) return <Empty icon={<CheckCircle2/>} title="No background tasks" detail="Agent and shell jobs launched from this chat will appear here with live status." />
  return <section className="tasks-workspace"><SurfaceHeader title="Session tasks" subtitle={`${tasks.length} tracked background job${tasks.length === 1 ? '' : 's'}`} />
    <div className="tasks-workspace__list">{tasks.map((task) => <TaskRow key={task.id} task={task} sessionId={sessionId} onOpenOutput={onOpenOutput}/>)}</div>
  </section>
}

function TaskRow({ task, sessionId, onOpenOutput }: { task: BackgroundTask; sessionId: string; onOpenOutput: (path: string) => void }) {
  const icon = task.status === 'running' ? <Loader2 className="spin"/> : task.status === 'completed' ? <CheckCircle2/> : task.status === 'failed' || task.status === 'orphaned' ? <XCircle/> : <Square/>
  const stop = async () => { const result = await window.electronAPI.killShell(sessionId, task.id); result.success ? toast.success('Task stopped') : toast.error(result.error || 'Could not stop task') }
  return <article className="task-row"><span className={`task-row__status is-${task.status}`}>{icon}</span><div><strong>{task.intent || `${task.type} task`}</strong><small>{task.id} · {task.status} · {Math.max(task.elapsedSeconds, Math.round((Date.now() - task.startTime) / 1000))}s</small>{task.summary && <p>{task.summary}</p>}</div><div className="task-row__actions">{task.outputFile && <button onClick={() => onOpenOutput(task.outputFile!)}>Open output</button>}{task.status === 'running' && task.type === 'shell' && <button className="danger" onClick={() => void stop()}>Stop</button>}</div></article>
}