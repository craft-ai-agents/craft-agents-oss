import * as React from 'react'
import { Box, FileImage, FileSpreadsheet, FileText, Presentation, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SessionFile } from '../../../shared/types'
import { useAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { restoreSessionFileWatch } from './session-files-watch'
const CanvasModelPreview = React.lazy(() => import('../canvas/CanvasModelPreview'))

const ARTIFACT_EXTENSIONS = new Set([
  'md', 'txt', 'pdf', 'doc', 'docx', 'html',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
  'csv', 'xls', 'xlsx', 'ppt', 'pptx',
  'glb',
])

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
const SHEET_EXTENSIONS = new Set(['csv', 'xls', 'xlsx'])
const PRESENTATION_EXTENSIONS = new Set(['ppt', 'pptx'])
const OUTPUT_DIRECTORY_NAMES = new Set(['data', 'output', 'outputs', 'artifacts', 'deliverables'])
const CONTROL_FILE_NAMES = new Set([
  'deliverable-brief.md',
  'deliverable-manifest.json',
  '需求确认单.md',
  '材料完整性检查.md',
])

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function collectSessionArtifacts(files: SessionFile[]): SessionFile[] {
  const result: SessionFile[] = []
  const visit = (entries: SessionFile[]) => {
    for (const entry of entries) {
      if (entry.type === 'directory') visit(entry.children ?? [])
      else if (
        !CONTROL_FILE_NAMES.has(entry.name.toLowerCase())
        && ARTIFACT_EXTENSIONS.has(extension(entry.name))
      ) result.push(entry)
    }
  }

  // Generated deliverables are required to live in the session data/output
  // folder. This prevents uploaded source material under attachments/ from
  // being presented to the user as an agent-produced result.
  const outputDirectories = files.filter(
    entry => entry.type === 'directory' && OUTPUT_DIRECTORY_NAMES.has(entry.name.toLowerCase())
  )
  if (outputDirectories.length > 0) {
    for (const directory of outputDirectories) visit(directory.children ?? [])
  } else {
    // Compatibility for older sessions that wrote deliverables at the root.
    visit(files.filter(entry => entry.type === 'file'))
  }
  return result
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function ArtifactIcon({ name }: { name: string }) {
  const ext = extension(name)
  if (ext === 'glb') return <Box className="h-4 w-4" />
  if (IMAGE_EXTENSIONS.has(ext)) return <FileImage className="h-4 w-4" />
  if (SHEET_EXTENSIONS.has(ext)) return <FileSpreadsheet className="h-4 w-4" />
  if (PRESENTATION_EXTENSIONS.has(ext)) return <Presentation className="h-4 w-4" />
  return <FileText className="h-4 w-4" />
}

function ArtifactThumbnail({ file }: { file: SessionFile }) {
  const [src, setSrc] = React.useState<string | null>(null)
  const ext = extension(file.name)

  React.useEffect(() => {
    let cancelled = false
    if (!IMAGE_EXTENSIONS.has(ext)) {
      setSrc(null)
      return
    }
    void window.electronAPI.readFilePreviewDataUrl(file.path, 180).then(url => {
      if (!cancelled) setSrc(url)
    }).catch(() => {
      if (!cancelled) setSrc(null)
    })
    return () => { cancelled = true }
  }, [ext, file.path])

  if (!src) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04] text-foreground/45">
        <ArtifactIcon name={file.name} />
      </div>
    )
  }

  return <img src={src} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
}

interface SessionArtifactsSectionProps {
  sessionId: string | null
  isProcessing?: boolean
  className?: string
}

/** Business-facing view of files produced by a session. The raw directory tree
 * remains available in the Files tab; this view intentionally shows only
 * previewable deliverables. */
export function SessionArtifactsSection({ sessionId, isProcessing, className }: SessionArtifactsSectionProps) {
  const { t } = useTranslation()
  const { onOpenFile } = useAppShellContext()
  const [files, setFiles] = React.useState<SessionFile[]>([])
  const [loading, setLoading] = React.useState(false)
  const [modelPreview, setModelPreview] = React.useState<string | null>(null)
  React.useEffect(() => setModelPreview(null), [sessionId])

  const loadFiles = React.useCallback(async () => {
    if (!sessionId) {
      setFiles([])
      return
    }
    setLoading(true)
    try {
      const entries = await window.electronAPI.getSessionFiles(sessionId)
      setFiles(collectSessionArtifacts(entries))
    } catch (error) {
      console.error('[SessionArtifacts] Failed to load session artifacts:', error)
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  React.useEffect(() => {
    void loadFiles()
    if (!sessionId) return
    void window.electronAPI.watchSessionFiles(sessionId)
    const offFiles = window.electronAPI.onSessionFilesChanged(changedId => {
      if (changedId === sessionId) void loadFiles()
    })
    const offReconnect = window.electronAPI.onReconnected(() => {
      void restoreSessionFileWatch(sessionId, loadFiles)
    })
    return () => {
      offFiles()
      offReconnect()
      void window.electronAPI.unwatchSessionFiles()
    }
  }, [sessionId, loadFiles])

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {modelPreview && <React.Suspense fallback={<p role="status">正在载入3D预览…</p>}><CanvasModelPreview path={modelPreview} onClose={() => setModelPreview(null)} /></React.Suspense>}
      {isProcessing && (
        <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg bg-accent/5 px-3 py-2 text-xs text-foreground/65 shadow-tinted">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" />
          {t('rightDock.artifactsGenerating')}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!sessionId ? (
          <EmptyState text={t('rightDock.selectSession')} />
        ) : loading && files.length === 0 ? (
          <EmptyState text={t('chat.sessionFilesLoading')} />
        ) : files.length === 0 ? (
          <EmptyState text={t('rightDock.artifactsEmpty')} />
        ) : (
          <div className="grid gap-2">
            {files.map(file => (
              <button
                key={file.path}
                type="button"
                onClick={() => extension(file.name) === 'glb' ? setModelPreview(file.path) : onOpenFile(file.path)}
                className="flex w-full items-center gap-3 rounded-xl bg-background p-2 text-left shadow-minimal transition-colors hover:bg-foreground/[0.025]"
              >
                <ArtifactThumbnail file={file} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{file.name}</span>
                  <span className="mt-0.5 block text-[11px] text-foreground/40">
                    {extension(file.name).toUpperCase()}{file.size ? ` · ${formatFileSize(file.size)}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-36 items-center justify-center px-5 text-center text-xs leading-5 text-foreground/40">
      {text}
    </div>
  )
}
