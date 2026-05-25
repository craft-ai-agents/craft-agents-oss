import * as React from 'react'
import { Image as ImageIcon } from 'lucide-react'
import type { VisualSurfaceKind } from '@craft-agent/shared/visual-surfaces'
import { OutputInlinePreview } from '@/components/outputs/OutputInlinePreview'
import { cn } from '@/lib/utils'
import { VisualBoardSurface } from './VisualBoardSurface'
import {
  selectVisualSurfaceAdapter,
  type VisualSurfaceAdapterContext,
} from './VisualSurfaceAdapterRegistry'

export type { VisualSurfaceAdapterContext } from './VisualSurfaceAdapterRegistry'
export { selectVisualSurfaceAdapter } from './VisualSurfaceAdapterRegistry'

const PREVIEW_NODES = [
  { label: 'Brief', x: 11, y: 18, tone: 'bg-sky-400/25 border-sky-300/40' },
  { label: 'Draft', x: 49, y: 30, tone: 'bg-emerald-400/20 border-emerald-300/40' },
  { label: 'Media', x: 24, y: 62, tone: 'bg-amber-400/20 border-amber-300/40' },
  { label: 'Review', x: 64, y: 68, tone: 'bg-fuchsia-400/20 border-fuchsia-300/40' },
]

export function renderVisualSurfaceAdapter(context: VisualSurfaceAdapterContext): React.ReactNode {
  const adapter = selectVisualSurfaceAdapter(context)

  if (adapter.id === 'canvas-board') {
    return (
      <VisualBoardSurface
        workspaceId={context.workspaceId}
        sessionId={context.sessionId!}
        outputs={context.sessionOutputs}
        onOpenOutput={context.onOpenOutput}
        refreshKey={context.boardOutput?.updatedAt}
      />
    )
  }

  if ((adapter.id === 'output-preview' || adapter.id === 'browser-preview') && context.selectedManifest) {
    const manifest = context.selectedManifest
    return (
      <OutputInlinePreview
        workspaceId={context.workspaceId}
        manifest={manifest}
        primary={manifest.primary ?? manifest.assets.find((asset) => asset.role === 'primary') ?? manifest.assets[0]}
        compact
        className="flex h-full min-h-0 w-full items-center justify-center overflow-auto p-3 text-white/72"
        onPreviewSettled={context.onPreviewSettled}
      />
    )
  }

  return <UnsupportedSurface error={context.manifestError} kind={context.surface.kind} />
}

function UnsupportedSurface({ error, kind }: { error: string | null; kind: VisualSurfaceKind }) {
  const message = error ?? (kind === 'canvas' ? 'No session output yet. Generated outputs will appear here.' : `${kind} surfaces are not implemented yet.`)
  return (
    <>
      <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--foreground)/0.06)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--foreground)/0.06)_1px,transparent_1px)] bg-[size:28px_28px]" />
      <svg className="absolute inset-0 h-full w-full text-foreground/18" aria-hidden="true">
        <line x1="24%" y1="28%" x2="53%" y2="38%" stroke="currentColor" strokeWidth="1.4" />
        <line x1="31%" y1="68%" x2="53%" y2="38%" stroke="currentColor" strokeWidth="1.4" />
        <line x1="53%" y1="38%" x2="70%" y2="73%" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      {PREVIEW_NODES.map((node) => (
        <div
          key={node.label}
          className={cn(
            'absolute flex h-10 min-w-20 items-center justify-center rounded-md border px-3 text-xs font-medium shadow-xs backdrop-blur',
            node.tone,
          )}
          style={{ left: `${node.x}%`, top: `${node.y}%` }}
        >
          {node.label}
        </div>
      ))}
      <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 rounded-md border border-border/55 bg-background/82 px-2.5 py-2 text-xs text-muted-foreground backdrop-blur">
        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{message}</span>
      </div>
    </>
  )
}
