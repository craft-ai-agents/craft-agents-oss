import * as React from 'react'
import { AlertTriangle, ExternalLink, FileText, FolderOpen, Link2, ReceiptText, Route } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { StreamingMarkdown } from '@/components/markdown'
import { ShikiCodeViewer } from '@/components/shiki/ShikiCodeViewer'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { StatusPill } from '@/components/outputs/OutputsListPanel'
import { useOutputs, type OutputAssetDTO, type OutputManifestDTO, type OutputPreviewMode } from '@/hooks/useOutputs'

interface Props {
  workspaceId: string
  outputId?: string
}

type OutputsElectronAPI = typeof window.electronAPI & {
  openOutputFile?: (workspaceId: string, outputId: string, assetId?: string) => Promise<void>
  showOutputInFolder?: (workspaceId: string, outputId: string, assetId?: string) => Promise<void>
}

export default function OutputDetailPage({ workspaceId, outputId }: Props) {
  const { navigate } = useNavigation()
  const { getOutput, outputs, loading, error } = useOutputs(workspaceId)
  const [manifest, setManifest] = React.useState<OutputManifestDTO | null>(null)
  const [detailError, setDetailError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!outputId) {
      setManifest(null)
      setDetailError(null)
      return
    }
    let mounted = true
    setDetailError(null)
    getOutput(outputId).then((loaded) => {
      if (!mounted) return
      if (!loaded) {
        const summary = outputs.find((entry) => entry.id === outputId)
        if (summary) {
          setManifest({
            ...summary,
            summary: summary.summary ?? '',
            origin: summary.origin ?? { source: 'manual' },
            assets: summary.primary ? [summary.primary] : [],
            receipts: [],
            links: [],
          })
          return
        }
        setDetailError('Output not found.')
        return
      }
      setManifest(loaded)
    }).catch((err) => {
      if (mounted) setDetailError(err instanceof Error ? err.message : String(err))
    })
    return () => { mounted = false }
  }, [getOutput, outputId, outputs])

  if (!outputId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an output
      </div>
    )
  }

  if (detailError || error) {
    return (
      <div className="m-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <span>{detailError ?? error}</span>
      </div>
    )
  }

  if (!manifest || loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading output</div>
  }

  const primary = manifest.primary ?? manifest.assets.find((asset) => asset.role === 'primary') ?? manifest.assets[0]

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-background">
      <div className="border-b border-border/30 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold">{manifest.title}</h1>
              <StatusPill status={manifest.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>{formatKind(manifest.kind)}</span>
              <span>{manifest.createdAt}</span>
              <span>{originLabel(manifest)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {primary && (
              <>
                <Button size="sm" variant="outline" onClick={() => openAsset(workspaceId, manifest, primary)}>
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  Open
                </Button>
                <Button size="sm" variant="outline" onClick={() => showAsset(workspaceId, manifest, primary)}>
                  <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                  Show
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex max-w-5xl flex-col gap-5 p-5">
        <Section title="Preview">
          <OutputPreview manifest={manifest} primary={primary} />
        </Section>

        <Section title="Summary">
          <p className="text-sm leading-6 text-foreground/80">{manifest.summary || 'No summary provided.'}</p>
        </Section>

        <Section title="Assets">
          {manifest.assets.length === 0 ? (
            <EmptyLine>No assets</EmptyLine>
          ) : (
            <div className="overflow-hidden rounded-md border border-border/40">
              {manifest.assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => openAsset(workspaceId, manifest, asset)}
                  className="flex w-full items-center justify-between gap-3 border-b border-border/30 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-foreground/[0.02]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{asset.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{asset.role} · {asset.mimeType ?? 'file'} · {asset.path}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(asset.sizeBytes)}</span>
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Receipts and links">
          {manifest.receipts.length === 0 && manifest.links.length === 0 ? (
            <EmptyLine>No receipts or links</EmptyLine>
          ) : (
            <div className="grid gap-2">
              {manifest.receipts.map((receipt) => (
                <div key={receipt.id} className="rounded-md border border-border/40 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-medium">
                      <ReceiptText className="h-4 w-4 text-muted-foreground" />
                      {receipt.provider} · {receipt.action}
                    </div>
                    <StatusPill status={receipt.status} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{receipt.displayText || receipt.externalId || receipt.occurredAt}</div>
                  {receipt.url && <ExternalButton url={receipt.url} />}
                </div>
              ))}
              {manifest.links.map((link) => (
                <div key={link.id} className="rounded-md border border-border/40 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <Link2 className="h-4 w-4 text-muted-foreground" />
                    {link.label}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{link.url}</div>
                  <ExternalButton url={link.url} />
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Provenance">
          <div className="rounded-md border border-border/40 p-3">
            <KeyValueRows
              rows={[
                ['Source', manifest.origin.source],
                ['Workflow', manifest.origin.workflowName ?? manifest.origin.workflowSlug],
                ['Run', manifest.origin.workflowRunId],
                ['Step', manifest.origin.stepId],
                ['Session', manifest.origin.sessionId],
                ['Agent', manifest.origin.agentName ?? manifest.origin.agentSlug],
                ['Automation', manifest.origin.automationId],
              ]}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {manifest.origin.workflowRunId && (
                <Button size="sm" variant="outline" onClick={() => navigate(routes.view.workflowRun(manifest.origin.workflowRunId!))}>
                  <Route className="mr-1.5 h-3.5 w-3.5" />
                  Open run
                </Button>
              )}
              {manifest.origin.sessionId && (
                <Button size="sm" variant="outline" onClick={() => navigate(routes.view.allSessions(manifest.origin.sessionId!))}>
                  Open session
                </Button>
              )}
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}

function OutputPreview({ manifest, primary }: { manifest: OutputManifestDTO; primary?: OutputAssetDTO }) {
  const mode = manifest.preview?.mode ?? inferPreviewMode(primary)
  const inlineText = manifest.preview?.inlineText ?? null
  const [content, setContent] = React.useState<string | null>(inlineText)
  const [dataUrl, setDataUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const assetPath = primary ? resolveAssetPath(manifest, primary) : null

  // Image-mode effect: load the asset as a data URL.
  React.useEffect(() => {
    if (inlineText || !assetPath || mode !== 'image') return
    let mounted = true
    setError(null)
    setDataUrl(null)
    window.electronAPI.readFileDataUrl(assetPath).then((url) => {
      if (mounted) setDataUrl(url)
    }).catch((err) => {
      if (mounted) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { mounted = false }
  }, [assetPath, inlineText, mode])

  // Text-based modes (markdown / text / json / receipt): read the file as text.
  React.useEffect(() => {
    if (inlineText) {
      setContent(inlineText)
      return
    }
    if (!assetPath) return
    if (mode !== 'markdown' && mode !== 'text' && mode !== 'json' && mode !== 'receipt') return
    let mounted = true
    setError(null)
    window.electronAPI.readFile(assetPath).then((text) => {
      if (mounted) setContent(text)
    }).catch((err) => {
      if (mounted) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { mounted = false }
  }, [assetPath, inlineText, mode])

  if (error) return <EmptyLine>Preview unavailable: {error}</EmptyLine>
  if (mode === 'image' && dataUrl) {
    return <img src={dataUrl} alt={primary?.label ?? manifest.title} className="max-h-[520px] rounded-md border border-border/40 object-contain" />
  }
  if (mode === 'markdown' && content) {
    return <div className="rounded-md border border-border/40 p-4"><StreamingMarkdown content={content} isStreaming={false} mode="minimal" /></div>
  }
  if (mode === 'json' && content) {
    return <ShikiCodeViewer code={formatJson(content)} language="json" className="max-h-[520px] overflow-auto rounded-md border border-border/40" />
  }
  if ((mode === 'text' || mode === 'receipt') && content) {
    return <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md border border-border/40 bg-foreground/[0.02] p-3 text-xs">{content}</pre>
  }
  if (mode === 'external-link' && manifest.links[0]) {
    return <ExternalButton url={manifest.links[0].url} />
  }
  return <EmptyLine>No preview available</EmptyLine>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-border/40 px-3 py-2 text-sm text-muted-foreground">{children}</div>
}

function ExternalButton({ url }: { url: string }) {
  return (
    <Button size="sm" variant="outline" className="mt-2" onClick={() => window.electronAPI.openUrl(url)}>
      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
      Open link
    </Button>
  )
}

function KeyValueRows({ rows }: { rows: Array<[string, unknown]> }) {
  return (
    <div className="grid gap-1 text-sm">
      {rows.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => (
        <div key={label} className="grid grid-cols-[120px_1fr] gap-3">
          <div className="text-muted-foreground">{label}</div>
          <div className="min-w-0 break-words font-mono text-xs">{String(value)}</div>
        </div>
      ))}
    </div>
  )
}

function openAsset(workspaceId: string, manifest: OutputManifestDTO, asset: OutputAssetDTO) {
  const electronAPI = window.electronAPI as OutputsElectronAPI
  if (typeof electronAPI.openOutputFile !== 'function') {
    reportActionError(new Error('openOutputFile bridge is unavailable; cannot open asset.'))
    return
  }
  electronAPI.openOutputFile(workspaceId, manifest.id, asset.id).catch(reportActionError)
}

function showAsset(workspaceId: string, manifest: OutputManifestDTO, asset: OutputAssetDTO) {
  const electronAPI = window.electronAPI as OutputsElectronAPI
  if (typeof electronAPI.showOutputInFolder !== 'function') {
    reportActionError(new Error('showOutputInFolder bridge is unavailable; cannot reveal asset.'))
    return
  }
  electronAPI.showOutputInFolder(workspaceId, manifest.id, asset.id).catch(reportActionError)
}

function reportActionError(err: unknown) {
  toast.error(err instanceof Error ? err.message : String(err))
}

/**
 * Resolves a bundle-relative asset path for renderer-side reads (preview only).
 * Returns null when the path is relative and we don't have a manifest base —
 * in that case the bridge methods (`openOutputFile` / `showOutputInFolder`)
 * are the only safe path. Absolute paths are returned as-is.
 */
function resolveAssetPath(manifest: OutputManifestDTO, asset: OutputAssetDTO): string | null {
  if (!asset.path) return null
  if (asset.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(asset.path)) return asset.path
  const base = manifest.bundlePath ?? manifest.directoryPath
  if (!base) return null
  return `${base.replace(/[\\/]$/, '')}/${asset.path}`
}

function inferPreviewMode(asset?: OutputAssetDTO): OutputPreviewMode {
  const mime = asset?.mimeType ?? ''
  const path = asset?.path ?? ''
  if (mime.includes('markdown') || path.endsWith('.md')) return 'markdown'
  if (mime.includes('json') || path.endsWith('.json')) return 'json'
  if (mime.startsWith('image/')) return 'image'
  return 'text'
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content
  }
}

function formatKind(kind: string): string {
  return kind.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function originLabel(manifest: OutputManifestDTO): string {
  return manifest.origin.workflowName
    ?? manifest.origin.agentName
    ?? manifest.origin.workflowSlug
    ?? manifest.origin.agentSlug
    ?? formatKind(manifest.origin.source)
}

function formatBytes(size?: number): string {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
