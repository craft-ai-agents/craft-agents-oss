import React from 'react'
import { useAtomValue } from 'jotai'
import { backgroundTasksAtomFamily, type BackgroundTask } from '../atoms/sessions'
import { AlertCircle, CheckCircle2, Code2, ExternalLink, FileText, Image, Loader2, Play, Plus, RefreshCw, Save, Square, Trash2, XCircle } from 'lucide-react'
import { classifyFile } from '@craft-agent/ui'
import { toast } from 'sonner'
import './WorkspaceTabPanels.css'

export type WorkspaceArtifact = {
  id: string
  title: string
  kind: 'text' | 'markdown' | 'html' | 'json'
  content: string
  sourcePath?: string
  updatedAt: number
}

type FileSurfaceProps = {
  filePath: string | null
  onChooseFile: () => void
  onPreview: () => void
  onOpenExternal: (path: string) => void
  onAddToCanvas: (artifact: WorkspaceArtifact) => void
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

export function CodeWorkspacePanel({ filePath, onChooseFile, onPreview, onOpenExternal, onAddToCanvas }: FileSurfaceProps) {
  const { content, loading, error, reload } = useTextFile(filePath)
  if (!filePath) return <Empty icon={<Code2 />} title="Choose a workspace file" detail="Double-click a file in the Files rail, or choose one from your computer." action="Choose file" onAction={onChooseFile} />
  return <section className="workspace-surface">
    <SurfaceHeader title={basename(filePath)} subtitle={filePath} actions={<>
      <button onClick={() => void reload()} title="Reload"><RefreshCw size={14}/> Reload</button>
      <button onClick={onPreview}><Play size={14}/> Preview</button>
      <button onClick={() => onAddToCanvas({ id: crypto.randomUUID(), title: basename(filePath), kind: filePath.toLowerCase().endsWith('.md') ? 'markdown' : filePath.toLowerCase().endsWith('.html') ? 'html' : filePath.toLowerCase().endsWith('.json') ? 'json' : 'text', content, sourcePath: filePath, updatedAt: Date.now() })}><Plus size={14}/> Canvas</button>
      <button onClick={() => onOpenExternal(filePath)}><ExternalLink size={14}/> Edit externally</button>
    </>} />
    <div className="workspace-surface__body">
      {loading ? <StateLine icon={<Loader2 className="spin"/>}>Reading file…</StateLine> : error ? <StateLine icon={<AlertCircle/>}>{error}</StateLine> : <pre className="workspace-code"><code>{content}</code></pre>}
    </div>
  </section>
}

export function PreviewWorkspacePanel({ filePath, artifact, onChooseFile, onOpenExternal }: Pick<FileSurfaceProps, 'filePath'|'onChooseFile'|'onOpenExternal'> & { artifact?: WorkspaceArtifact | null }) {
  const effectivePath = artifact ? null : filePath
  const classification = effectivePath ? classifyFile(effectivePath) : null
  const { content, loading, error, reload } = useTextFile(effectivePath && classification?.type !== 'image' && classification?.type !== 'pdf' ? effectivePath : null)
  const [dataUrl, setDataUrl] = React.useState<string | null>(null)
  React.useEffect(() => {
    setDataUrl(null)
    if (!effectivePath || classification?.type !== 'image') return
    void window.electronAPI.readFileDataUrl(effectivePath).then(setDataUrl).catch(() => setDataUrl(null))
  }, [effectivePath, classification?.type])
  if (!effectivePath && !artifact) return <Empty icon={<Play />} title="Nothing selected to preview" detail="Select a file in Code or double-click one in the Files rail." action="Choose file" onAction={onChooseFile} />
  if (artifact) return <section className="workspace-surface"><SurfaceHeader title={artifact.title} subtitle={`${artifact.kind} Canvas preview`} /><div className="workspace-preview">{artifact.kind === 'html' ? <iframe title={artifact.title} sandbox="" srcDoc={artifact.content}/> : artifact.kind === 'json' ? <pre>{formatJson(artifact.content)}</pre> : <article className="workspace-document"><pre>{artifact.content}</pre></article>}</div></section>
  const type = classification?.type
  const path = effectivePath!
  return <section className="workspace-surface">
    <SurfaceHeader title={basename(path)} subtitle={type ? `${type} preview` : 'Preview unavailable'} actions={<>
      <button onClick={() => void reload()}><RefreshCw size={14}/> Refresh</button>
      <button onClick={() => onOpenExternal(path)}><ExternalLink size={14}/> Open externally</button>
    </>} />
    <div className="workspace-preview">
      {type === 'image' ? (dataUrl ? <img src={dataUrl} alt={basename(path)}/> : <StateLine icon={<Loader2 className="spin"/>}>Loading image…</StateLine>)
        : type === 'pdf' ? <StateLine icon={<FileText/>}>PDF preview is available from the file overlay. Open the file to inspect it.</StateLine>
        : loading ? <StateLine icon={<Loader2 className="spin"/>}>Rendering preview…</StateLine>
        : error ? <StateLine icon={<AlertCircle/>}>{error}</StateLine>
        : type === 'markdown' ? <article className="workspace-document"><pre>{content}</pre></article>
        : path.toLowerCase().endsWith('.html') ? <iframe title={basename(path)} sandbox="" srcDoc={content}/>
        : type === 'json' ? <pre>{formatJson(content)}</pre>
        : type ? <pre>{content}</pre>
        : <StateLine icon={<AlertCircle/>}>This file type cannot be previewed here.</StateLine>}
    </div>
  </section>
}

export function CanvasWorkspacePanel({ artifacts, selectedId, onSelect, onChange, onCreate, onDelete, onPreview }: {
  artifacts: WorkspaceArtifact[]; selectedId: string | null; onSelect: (id: string) => void; onChange: (artifact: WorkspaceArtifact) => void; onCreate: () => void; onDelete: (id: string) => void; onPreview: (artifact: WorkspaceArtifact) => void
}) {
  const selected = artifacts.find((item) => item.id === selectedId) ?? artifacts[0]
  return <div className="canvas-workspace">
    <aside className="canvas-list">
      <button className="canvas-list__new" onClick={onCreate}><Plus size={14}/> New artifact</button>
      {artifacts.map((item) => <button key={item.id} className={item.id === selected?.id ? 'is-active' : ''} onClick={() => onSelect(item.id)}><FileText size={14}/><span>{item.title}</span></button>)}
    </aside>
    {selected ? <section className="workspace-surface">
      <SurfaceHeader title={selected.title} subtitle={`${selected.kind} artifact`} actions={<>
        <button onClick={() => onPreview(selected)}><Play size={14}/> Preview</button>
        <button className="danger" onClick={() => onDelete(selected.id)}><Trash2 size={14}/> Delete</button>
      </>} />
      <div className="canvas-editor">
        <input aria-label="Artifact title" value={selected.title} onChange={(e) => onChange({ ...selected, title: e.target.value, updatedAt: Date.now() })}/>
        <select aria-label="Artifact type" value={selected.kind} onChange={(e) => onChange({ ...selected, kind: e.target.value as WorkspaceArtifact['kind'], updatedAt: Date.now() })}><option value="text">Text</option><option value="markdown">Markdown</option><option value="html">HTML</option><option value="json">JSON</option></select>
        <textarea aria-label="Artifact content" value={selected.content} onChange={(e) => onChange({ ...selected, content: e.target.value, updatedAt: Date.now() })}/>
        <span className="canvas-editor__saved"><Save size={12}/> Saved locally for this session</span>
      </div>
    </section> : <Empty icon={<Image/>} title="Canvas is empty" detail="Create an artifact or send a file here from Code." action="New artifact" onAction={onCreate}/>} 
  </div>
}

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

function SurfaceHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) { return <header className="workspace-surface__header"><div><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>{actions && <div className="workspace-surface__actions">{actions}</div>}</header> }
function StateLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) { return <div className="workspace-state-line">{icon}<span>{children}</span></div> }
function Empty({ icon, title, detail, action, onAction }: { icon: React.ReactNode; title: string; detail: string; action?: string; onAction?: () => void }) { return <div className="workspace-empty">{icon}<strong>{title}</strong><p>{detail}</p>{action && onAction && <button onClick={onAction}>{action}</button>}</div> }
function formatJson(content: string): string { try { return JSON.stringify(JSON.parse(content), null, 2) } catch { return content } }
