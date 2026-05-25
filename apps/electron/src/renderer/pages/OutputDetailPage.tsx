import * as React from 'react'
import { AlertTriangle, ExternalLink, Eye, FileText, FolderOpen, Link2, PanelTopOpen, ReceiptText, Route } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../shared/routes'
import { StatusPill } from '@/components/outputs/OutputsListPanel'
import { OutputInlinePreview } from '@/components/outputs/OutputInlinePreview'
import { useOutputs, type OutputAssetDTO, type OutputManifestDTO } from '@/hooks/useOutputs'
import { openDemoVisualSurfaceAtom, openOutputVisualSurfaceAtom } from '@/atoms/visual-surfaces'

interface Props {
  workspaceId: string
  outputId?: string
}

type OutputsElectronAPI = typeof window.electronAPI & {
  openOutputFile?: (workspaceId: string, outputId: string, assetId?: string) => Promise<void>
  showOutputInFolder?: (workspaceId: string, outputId: string, assetId?: string) => Promise<void>
  applyVisualSurfaceEvent?: (
    workspaceId: string,
    sessionId: string,
    input: { action: 'add_image' | 'add_video'; outputId: string },
  ) => Promise<{ ok: boolean; receipt?: string; error?: string }>
}

export default function OutputDetailPage({ workspaceId, outputId }: Props) {
  const { navigate } = useNavigation()
  const { getOutput, outputs, loading, error } = useOutputs(workspaceId)
  const openOutputVisualSurface = useSetAtom(openOutputVisualSurfaceAtom)
  const openDemoVisualSurface = useSetAtom(openDemoVisualSurfaceAtom)
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
      <div className="runneros-glass-route flex h-full items-center justify-center text-sm text-white/48">
        Select an output
      </div>
    )
  }

  if (detailError || error) {
    return (
      <div className="m-5 flex items-center gap-2 rounded-[14px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        <AlertTriangle className="h-4 w-4" />
        <span>{detailError ?? error}</span>
      </div>
    )
  }

  if (!manifest || loading) {
    return <div className="runneros-glass-route flex h-full items-center justify-center text-sm text-white/50">Loading output</div>
  }

  const primary = manifest.primary ?? manifest.assets.find((asset) => asset.role === 'primary') ?? manifest.assets[0]
  const sessionId = manifest.origin.sessionId
  const canSendToCanvas = manifest.kind === 'image' || manifest.kind === 'video' || manifest.kind === 'model'

  return (
    <div className="runneros-glass-route h-full overflow-y-auto">
      <div className="runneros-page-wrap">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="runneros-page-title truncate">{manifest.title}</h1>
              <StatusPill status={manifest.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-white/48">
              <span>{formatKind(manifest.kind)}</span>
              <span>{manifest.createdAt}</span>
              <span>{originLabel(manifest)}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {sessionId && (
              <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => focusOutputSurface(workspaceId, manifest, sessionId, openOutputVisualSurface)}>
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                Focus
              </Button>
            )}
            {sessionId && canSendToCanvas && (
              <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => sendOutputToCanvas(workspaceId, manifest, sessionId, openDemoVisualSurface)}>
                <PanelTopOpen className="mr-1.5 h-3.5 w-3.5" />
                Canvas
              </Button>
            )}
            {primary && (
              <>
                <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => openAsset(workspaceId, manifest, primary)}>
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  Open
                </Button>
                <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => showAsset(workspaceId, manifest, primary)}>
                  <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                  Show
                </Button>
              </>
            )}
          </div>
        </div>

      <div className="flex max-w-5xl flex-col gap-5">
        <Section title="Preview">
          <OutputInlinePreview
            workspaceId={workspaceId}
            manifest={manifest}
            primary={primary}
          />
        </Section>

        <Section title="Summary">
          <p className="runneros-card px-3 py-2 text-sm leading-6 text-white/68">{manifest.summary || 'No summary provided.'}</p>
        </Section>

        <Section title="Assets">
          {manifest.assets.length === 0 ? (
            <EmptyLine>No assets</EmptyLine>
          ) : (
            <div className="runneros-card overflow-hidden">
              {manifest.assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => openAsset(workspaceId, manifest, asset)}
                  className="flex w-full items-center justify-between gap-3 border-b border-white/[0.06] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-white/[0.045]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-white/78">{asset.label}</span>
                    <span className="block truncate text-xs text-white/42">{asset.role} · {asset.mimeType ?? 'file'} · {asset.path}</span>
                  </span>
                  <span className="shrink-0 text-xs text-white/42">{formatBytes(asset.sizeBytes)}</span>
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
                <div key={receipt.id} className="runneros-card p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-medium text-white/78">
                      <ReceiptText className="h-4 w-4 text-white/42" />
                      {receipt.provider} · {receipt.action}
                    </div>
                    <StatusPill status={receipt.status} />
                  </div>
                  <div className="mt-1 text-xs text-white/42">{receipt.displayText || receipt.externalId || receipt.occurredAt}</div>
                  {receipt.url && <ExternalButton url={receipt.url} />}
                </div>
              ))}
              {manifest.links.map((link) => (
                <div key={link.id} className="runneros-card p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium text-white/78">
                    <Link2 className="h-4 w-4 text-white/42" />
                    {link.label}
                  </div>
                  <div className="mt-1 truncate text-xs text-white/42">{link.url}</div>
                  <ExternalButton url={link.url} />
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Provenance">
          <div className="runneros-card p-3">
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
                <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => navigate(routes.view.workflowRun(manifest.origin.workflowRunId!))}>
                  <Route className="mr-1.5 h-3.5 w-3.5" />
                  Open run
                </Button>
              )}
              {manifest.origin.sessionId && (
                <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => navigate(routes.view.allSessions(manifest.origin.sessionId!))}>
                  Open session
                </Button>
              )}
            </div>
          </div>
        </Section>
      </div>
      </div>
    </div>
  )
}

function focusOutputSurface(
  workspaceId: string,
  manifest: OutputManifestDTO,
  sessionId: string,
  openOutputVisualSurface: (input: {
    workspaceId: string
    sessionId: string
    outputId: string
    title: string
    kind: OutputManifestDTO['kind']
    createdAt: string
    updatedAt?: string
  }) => void,
) {
  openOutputVisualSurface({
    workspaceId,
    sessionId,
    outputId: manifest.id,
    title: manifest.title,
    kind: manifest.kind,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  })
}

async function sendOutputToCanvas(
  workspaceId: string,
  manifest: OutputManifestDTO,
  sessionId: string,
  openDemoVisualSurface: (input: { workspaceId: string; sessionId: string }) => void,
) {
  const action = manifest.kind === 'image'
    ? 'add_image'
    : manifest.kind === 'video'
      ? 'add_video'
      : 'pin_output'
  const api = window.electronAPI as OutputsElectronAPI
  if (typeof api.applyVisualSurfaceEvent !== 'function') {
    toast.error('Canvas action is unavailable in this window.')
    return
  }
  try {
    const result = await api.applyVisualSurfaceEvent(workspaceId, sessionId, { action, outputId: manifest.id })
    if (!result.ok) {
      toast.error(result.error ?? 'Could not send output to Canvas.')
      return
    }
    openDemoVisualSurface({ workspaceId, sessionId })
    toast.success(result.receipt ?? 'Sent output to Canvas.')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-white/82">{title}</h2>
      {children}
    </section>
  )
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="runneros-card px-3 py-2 text-sm text-white/45">{children}</div>
}

function ExternalButton({ url }: { url: string }) {
  return (
    <Button size="sm" variant="outline" className="mt-2 border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => window.electronAPI.openUrl(url)}>
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
          <div className="text-white/42">{label}</div>
          <div className="min-w-0 break-words font-mono text-xs text-white/68">{String(value)}</div>
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
