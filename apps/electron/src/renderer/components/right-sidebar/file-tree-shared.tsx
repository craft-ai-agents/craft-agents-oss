import { memo, useEffect, useState } from 'react'
import { File, FileCode, FileText, Folder, FolderOpen, Image } from 'lucide-react'
import type { SessionFile } from '../../../shared/types'
import { cn } from '@/lib/utils'

/**
 * Get icon for file based on name/type (14x14px matching sidebar).
 */
export function getFileIcon(file: SessionFile, isExpanded?: boolean) {
  const iconClass = "h-3.5 w-3.5 text-muted-foreground"

  if (file.type === 'directory') {
    return isExpanded
      ? <FolderOpen className={iconClass} />
      : <Folder className={iconClass} />
  }

  const ext = file.name.split('.').pop()?.toLowerCase()

  if (ext === 'md' || ext === 'markdown') {
    return <FileText className={iconClass} />
  }

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext || '')) {
    return <Image className={iconClass} />
  }

  if (['ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'py', 'rb', 'go', 'rs'].includes(ext || '')) {
    return <FileCode className={iconClass} />
  }

  return <File className={iconClass} />
}

/**
 * Extensions that have thumbnail previews via the thumbnail:// protocol.
 * Matches the ALL_PREVIEWABLE set in thumbnail-protocol.ts.
 */
const PREVIEWABLE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'heif',
  'pdf', 'svg', 'psd', 'ai',
])

/**
 * Extensions that get lightweight image previews in web mode.
 * Excludes pdf/psd/ai/svg — not rendered as <img> thumbnails here.
 */
const WEB_PREVIEWABLE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico',
])

function getRuntimeEnvironment(): 'electron' | 'web' {
  return globalThis.window?.electronAPI?.getRuntimeEnvironment?.() ?? 'electron'
}

/**
 * Constructs a thumbnail:// protocol URL for a given file path.
 * The path is URI-encoded so it can be embedded safely in a URL.
 * Works cross-platform (macOS paths start with /, Windows with C:\).
 */
function getThumbnailUrl(filePath: string): string {
  return `thumbnail://thumb/${encodeURIComponent(filePath)}`
}

/**
 * FileThumbnail — Renders an image thumbnail with cross-fade from icon fallback.
 *
 * In Electron: loads via the custom thumbnail:// protocol (efficient 64x64 resize).
 * In Web mode: loads via readFilePreviewDataUrl RPC (server-side resized preview).
 *
 * Shows the Lucide icon immediately, then cross-fades to the thumbnail on load.
 * If loading fails, the icon stays visible — no layout shift, no error state.
 */
export const FileThumbnail = memo(function FileThumbnail({ file }: { file: SessionFile }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  // Reset state when file changes (e.g. watcher triggered re-render)
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
    setDataUrl(null)
  }, [file.path])

  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const isWebMode = getRuntimeEnvironment() === 'web'
  const previewableSet = isWebMode ? WEB_PREVIEWABLE_EXTENSIONS : PREVIEWABLE_EXTENSIONS
  const canPreview = previewableSet.has(ext)

  // Web mode: load a small preview via RPC as a base64 data URL
  useEffect(() => {
    if (!isWebMode || !canPreview || failed) return
    let cancelled = false
    window.electronAPI.readFilePreviewDataUrl(file.path, 64).then((url) => {
      if (!cancelled) setDataUrl(url)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [file.path, canPreview, failed, isWebMode])

  // Fall back to regular icon if not previewable or thumbnail failed
  if (!canPreview || failed) {
    return getFileIcon(file)
  }

  const imgSrc = isWebMode ? dataUrl : getThumbnailUrl(file.path)

  return (
    <>
      {/* Fallback icon — visible initially, fades out when thumbnail loads */}
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center transition-opacity duration-200',
          loaded ? 'opacity-0' : 'opacity-100'
        )}
      >
        {getFileIcon(file)}
      </span>
      {/* Thumbnail — fades in on successful load */}
      {imgSrc && (
        <img
          src={imgSrc}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            'absolute inset-0 h-full w-full rounded-[2px] object-cover transition-opacity duration-200',
            loaded ? 'opacity-100' : 'opacity-0'
          )}
        />
      )}
    </>
  )
})
