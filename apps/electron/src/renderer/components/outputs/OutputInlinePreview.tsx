import * as React from 'react'
import { AlertTriangle, ExternalLink, FileText, Link2, Presentation, ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StreamingMarkdown } from '@/components/markdown'
import { ShikiCodeViewer } from '@/components/shiki/ShikiCodeViewer'
import { OutputWebPreview } from './OutputWebPreview'
import { resolveWebPreviewTarget } from './web-preview'
import { resolvePresentationPreviewAsset } from './presentation-preview'
import { buildRunnerOutputAssetUrl } from '@craft-agent/shared/outputs/web-preview'
import type { OutputAssetDTO, OutputManifestDTO, OutputPreviewMode } from '@/hooks/useOutputs'

const OutputModelPreview = React.lazy(() => import('./OutputModelPreview').then((module) => ({ default: module.OutputModelPreview })))
const OutputExcalidrawPreview = React.lazy(() => import('./OutputExcalidrawPreview').then((module) => ({ default: module.OutputExcalidrawPreview })))

export type OutputPreviewSettledHandler = (status: 'ready' | 'error') => void

interface OutputInlinePreviewProps {
  workspaceId: string
  manifest: OutputManifestDTO
  primary?: OutputAssetDTO
  className?: string
  compact?: boolean
  onPreviewSettled?: OutputPreviewSettledHandler
}

type OutputsElectronAPI = typeof window.electronAPI & {
  readOutputAssetText?: (workspaceId: string, outputId: string, assetId?: string) => Promise<string>
  readOutputAssetDataUrl?: (workspaceId: string, outputId: string, assetId?: string) => Promise<string>
}

export function OutputInlinePreview({
  workspaceId,
  manifest,
  primary,
  className,
  compact = false,
  onPreviewSettled,
}: OutputInlinePreviewProps) {
  const previewAsset = resolvePreviewAsset(manifest, primary)
  const mode = manifest.preview?.mode ?? inferPreviewMode(previewAsset)
  const presentationPreviewAsset = mode === 'presentation'
    ? resolvePresentationPreviewAsset(manifest, previewAsset, inferPreviewMode)
    : undefined
  const blockedWebPreviewOrigins = React.useMemo(() => getBlockedWebPreviewOrigins(), [])
  const webPreviewTarget = resolveWebPreviewTarget(manifest, { blockedOrigins: blockedWebPreviewOrigins })
  const inlineText = manifest.preview?.inlineText ?? null
  const assetId = manifest.preview?.assetId ?? previewAsset?.id
  const shouldReadAssetData = Boolean(assetId && (mode === 'image' || mode === 'video' || mode === 'audio'))
  const shouldReadAssetText = Boolean(assetId && (mode === 'markdown' || mode === 'text' || mode === 'json' || mode === 'receipt' || mode === 'excalidraw'))
  const [content, setContent] = React.useState<string | null>(shouldReadAssetText ? null : inlineText)
  const [dataUrl, setDataUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const electronAPI = window.electronAPI as OutputsElectronAPI
  const hasStaticPreview = Boolean(
    (mode === 'image' || mode === 'video' || mode === 'audio') && dataUrl
    || (mode === 'markdown' || mode === 'json' || mode === 'text' || mode === 'receipt') && content !== null
    || mode === 'receipt' && manifest.receipts.length > 0
    || (mode === 'external-link' || mode === 'web' || manifest.links.length > 0) && manifest.links[0],
  )

  React.useEffect(() => {
    setContent(shouldReadAssetText ? null : inlineText)
    setDataUrl(null)
    setError(null)
  }, [assetId, inlineText, manifest.id, mode, shouldReadAssetText])

  React.useEffect(() => {
    if (!assetId || !shouldReadAssetData) return
    if (typeof electronAPI.readOutputAssetDataUrl !== 'function') {
      setError('Output asset preview is unavailable in this window.')
      return
    }
    let mounted = true
    setError(null)
    setDataUrl(null)
    electronAPI.readOutputAssetDataUrl(workspaceId, manifest.id, assetId).then((url) => {
      if (mounted) setDataUrl(url)
    }).catch((err) => {
      if (mounted) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { mounted = false }
  }, [assetId, electronAPI, manifest.id, shouldReadAssetData, workspaceId])

  React.useEffect(() => {
    if (!assetId || !shouldReadAssetText) return
    if (typeof electronAPI.readOutputAssetText !== 'function') {
      setError('Output text preview is unavailable in this window.')
      return
    }
    let mounted = true
    setError(null)
    electronAPI.readOutputAssetText(workspaceId, manifest.id, assetId).then((text) => {
      if (mounted) setContent(text)
    }).catch((err) => {
      if (mounted) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { mounted = false }
  }, [assetId, electronAPI, manifest.id, shouldReadAssetText, workspaceId])

  React.useEffect(() => {
    if (webPreviewTarget) return
    if (mode === 'presentation' && !presentationPreviewAsset) {
      onPreviewSettled?.('error')
      return
    }
    if (error) {
      onPreviewSettled?.('error')
      return
    }
    if (hasStaticPreview || (!assetId && !shouldReadAssetData && !shouldReadAssetText)) {
      onPreviewSettled?.('ready')
    }
  }, [assetId, error, hasStaticPreview, mode, onPreviewSettled, presentationPreviewAsset, shouldReadAssetData, shouldReadAssetText, webPreviewTarget])

  if (error) {
    return (
      <EmptyPreview className={className}>
        <AlertTriangle className="h-4 w-4" />
        <span>Preview unavailable: {error}</span>
      </EmptyPreview>
    )
  }

  if (webPreviewTarget) {
    return (
      <div className="h-full min-h-0 w-full overflow-hidden">
        <OutputWebPreview target={webPreviewTarget} className="h-full min-h-0" onPreviewSettled={onPreviewSettled} />
      </div>
    )
  }

  if (mode === 'image' && dataUrl) {
    return (
      <div className={className}>
        <img
          src={dataUrl}
          alt={previewAsset?.label ?? manifest.title}
          className="max-h-full w-full rounded-md object-contain"
        />
      </div>
    )
  }

  if (mode === 'video' && dataUrl) {
    return (
      <div className={className}>
        <video src={dataUrl} controls className="max-h-full w-full rounded-md" />
      </div>
    )
  }

  if (mode === 'audio' && dataUrl) {
    return (
      <div className={className}>
        <audio src={dataUrl} controls className="w-full" />
      </div>
    )
  }

  if (mode === 'model' && previewAsset) {
    return (
      <React.Suspense fallback={<EmptyPreview className={className}><span>Loading model viewer...</span></EmptyPreview>}>
        <OutputModelPreview
          url={buildRunnerOutputAssetUrl(workspaceId, manifest.id, previewAsset.path)}
          label={previewAsset.label ?? manifest.title}
          className={className}
          onPreviewSettled={onPreviewSettled}
        />
      </React.Suspense>
    )
  }

  if (mode === 'pdf' && previewAsset) {
    return (
      <div className={className ?? 'h-full min-h-[420px] w-full overflow-hidden rounded-md bg-black'}>
        <iframe
          src={buildRunnerOutputAssetUrl(workspaceId, manifest.id, previewAsset.path)}
          title={previewAsset.label ?? manifest.title}
          className="h-full min-h-[420px] w-full border-0 bg-black"
          onLoad={() => onPreviewSettled?.('ready')}
        />
      </div>
    )
  }

  if (mode === 'excalidraw' && content) {
    return (
      <React.Suspense fallback={<EmptyPreview className={className}><span>Loading Excalidraw preview...</span></EmptyPreview>}>
        <OutputExcalidrawPreview
          content={content}
          label={previewAsset?.label ?? manifest.title}
          className={className}
          onPreviewSettled={onPreviewSettled}
        />
      </React.Suspense>
    )
  }

  if (mode === 'presentation') {
    const renderedAsset = presentationPreviewAsset
    if (renderedAsset) {
      const renderedMode = inferPreviewMode(renderedAsset)
      const renderedUrl = buildRunnerOutputAssetUrl(workspaceId, manifest.id, renderedAsset.path)
      if (renderedMode === 'pdf') {
        return (
          <div className={className ?? 'h-full min-h-[420px] w-full overflow-hidden rounded-md bg-black'}>
            <iframe
              src={renderedUrl}
              title={renderedAsset.label ?? manifest.title}
              className="h-full min-h-[420px] w-full border-0 bg-black"
              onLoad={() => onPreviewSettled?.('ready')}
            />
          </div>
        )
      }
      if (renderedMode === 'image') {
        return (
          <div className={className ?? 'flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-md bg-black'}>
            <img
              src={renderedUrl}
              alt={renderedAsset.label ?? manifest.title}
              className="max-h-full w-full object-contain"
              onLoad={() => onPreviewSettled?.('ready')}
              onError={() => onPreviewSettled?.('error')}
            />
          </div>
        )
      }
    }

    return (
      <EmptyPreview className={className}>
        <Presentation className="h-4 w-4" />
        <span>Deck preview needs an HTML, PDF, or image preview asset.</span>
      </EmptyPreview>
    )
  }

  if (mode === 'markdown' && content) {
    return (
      <div className={className}>
        <div className={compact ? 'text-sm leading-6' : 'runneros-card p-4'}>
          <StreamingMarkdown content={content} isStreaming={false} mode="minimal" />
        </div>
      </div>
    )
  }

  if (mode === 'json' && content) {
    return (
      <ShikiCodeViewer
        code={formatJson(content)}
        language="json"
        className={className ?? 'max-h-[520px] overflow-auto rounded-[13px] border border-white/[0.08]'}
      />
    )
  }

  if ((mode === 'text' || mode === 'receipt') && content) {
    return (
      <pre className={className ?? 'runneros-card max-h-[520px] overflow-auto whitespace-pre-wrap p-3 text-xs text-white/68'}>
        {content}
      </pre>
    )
  }

  if (mode === 'receipt' && manifest.receipts.length > 0) {
    return (
      <div className={className ?? 'grid gap-2'}>
        {manifest.receipts.map((receipt) => (
          <div key={receipt.id} className="rounded-md border border-white/[0.08] bg-white/[0.035] p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-white/78">
              <ReceiptText className="h-4 w-4 text-white/42" />
              {receipt.provider} · {receipt.action}
            </div>
            <div className="mt-1 text-xs text-white/42">{receipt.displayText || receipt.externalId || receipt.occurredAt}</div>
          </div>
        ))}
      </div>
    )
  }

  if ((mode === 'external-link' || mode === 'web' || manifest.links.length > 0) && manifest.links[0]) {
    return (
      <div className={className ?? 'rounded-md border border-white/[0.08] bg-white/[0.035] p-3'}>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white/78">
          <Link2 className="h-4 w-4 text-white/42" />
          {manifest.links[0].label}
        </div>
        <Button size="sm" variant="outline" onClick={() => window.electronAPI.openUrl(manifest.links[0]!.url)}>
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
          Open link
        </Button>
      </div>
    )
  }

  return (
    <EmptyPreview className={className}>
      <FileText className="h-4 w-4" />
      <span>No preview available</span>
    </EmptyPreview>
  )
}

function resolvePreviewAsset(manifest: OutputManifestDTO, primary?: OutputAssetDTO): OutputAssetDTO | undefined {
  if (manifest.preview?.assetId) {
    return manifest.assets.find((asset) => asset.id === manifest.preview?.assetId)
  }
  return primary ?? manifest.primary ?? manifest.assets.find((asset) => asset.role === 'primary') ?? manifest.assets[0]
}

function inferPreviewMode(asset?: OutputAssetDTO): OutputPreviewMode {
  const mime = asset?.mimeType ?? ''
  const path = asset?.path.toLowerCase() ?? ''
  if (mime.includes('markdown') || path.endsWith('.md') || path.endsWith('.markdown')) return 'markdown'
  if (mime.includes('json') || path.endsWith('.json')) return 'json'
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg)$/.test(path)) return 'image'
  if (mime.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/.test(path)) return 'video'
  if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/.test(path)) return 'audio'
  if (mime === 'model/gltf-binary' || mime === 'model/gltf+json' || /\.(glb|gltf)$/.test(path)) return 'model'
  if (mime === 'application/pdf' || path.endsWith('.pdf')) return 'pdf'
  if (mime === 'application/vnd.excalidraw+json' || path.endsWith('.excalidraw')) return 'excalidraw'
  if (isPresentationAsset(asset)) return 'presentation'
  return 'text'
}

function isPresentationAsset(asset?: OutputAssetDTO): boolean {
  const mime = asset?.mimeType ?? ''
  const path = asset?.path.toLowerCase() ?? ''
  return mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    || mime === 'application/vnd.ms-powerpoint'
    || mime === 'application/vnd.oasis.opendocument.presentation'
    || /\.(pptx?|odp)$/.test(path)
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content
  }
}

function EmptyPreview({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className ?? 'runneros-card flex items-center gap-2 px-3 py-2 text-sm text-white/45'}>
      {children}
    </div>
  )
}

function getBlockedWebPreviewOrigins(): string[] {
  if (typeof window === 'undefined') return []
  const { hostname, origin, port, protocol } = window.location
  if (protocol !== 'http:' && protocol !== 'https:') return []
  const origins = new Set([origin])
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1') {
    const suffix = port ? `:${port}` : ''
    origins.add(`${protocol}//localhost${suffix}`)
    origins.add(`${protocol}//127.0.0.1${suffix}`)
    origins.add(`${protocol}//[::1]${suffix}`)
  }
  return [...origins]
}
