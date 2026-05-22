import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Image as ImageIcon, Layers, Maximize2, Minimize2, PanelRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  collapseVisualSidecarAtom,
  closeVisualSidecarAtom,
  focusVisualSidecarAtom,
  visualSidecarAtom,
} from '@/atoms/visual-surfaces'

interface VisualSurfacePanelProps {
  presentation: 'inline' | 'overlay' | 'rollup'
}

const PREVIEW_NODES = [
  { label: 'Brief', x: 11, y: 18, tone: 'bg-sky-400/25 border-sky-300/40' },
  { label: 'Draft', x: 49, y: 30, tone: 'bg-emerald-400/20 border-emerald-300/40' },
  { label: 'Media', x: 24, y: 62, tone: 'bg-amber-400/20 border-amber-300/40' },
  { label: 'Review', x: 64, y: 68, tone: 'bg-fuchsia-400/20 border-fuchsia-300/40' },
]

export function VisualSurfacePanel({ presentation }: VisualSurfacePanelProps) {
  const { activeSurface, isCollapsed, focusedAt } = useAtomValue(visualSidecarAtom)
  const focusSidecar = useSetAtom(focusVisualSidecarAtom)
  const collapseSidecar = useSetAtom(collapseVisualSidecarAtom)
  const closeSidecar = useSetAtom(closeVisualSidecarAtom)
  const focusPulseKey = focusedAt ?? 0

  if (!activeSurface) return null

  if (isCollapsed) {
    return (
      <aside
        data-visual-sidecar="collapsed"
        className={cn(
          'z-[8] shrink-0',
          presentation === 'inline'
            ? 'flex h-full w-11 items-center justify-center'
            : presentation === 'rollup'
              ? 'relative z-[1] flex h-11 w-full items-center justify-center'
            : 'absolute right-2 top-[22px] flex h-11 w-11 items-center justify-center',
        )}
      >
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label="Focus visual sidecar"
          className="size-9 rounded-md border border-border/60 bg-background/90 shadow-modal-small backdrop-blur"
          onClick={focusSidecar}
        >
          <PanelRight className="h-4 w-4" />
        </Button>
      </aside>
    )
  }

  return (
    <aside
      key={focusPulseKey}
      data-visual-sidecar="open"
      data-visual-sidecar-mode={presentation}
      className={cn(
        'z-[7] flex h-full min-h-0 shrink-0 animate-in fade-in-0 duration-150',
        presentation === 'inline'
          ? 'w-[clamp(420px,30vw,560px)]'
          : presentation === 'rollup'
            ? 'relative h-[min(64vh,560px)] w-full'
          : 'absolute bottom-[150px] right-2 top-[56px] h-auto w-[min(430px,calc(100%_-_16px))]',
      )}
    >
      <div
        className={cn(
          'flex h-full min-h-0 w-full flex-col overflow-hidden',
          presentation === 'rollup'
            ? 'bg-transparent'
            : 'runneros-glass-panel-strong rounded-[12px] border border-border/70 shadow-modal-small',
        )}
      >
        <header className={cn(
          'flex h-12 shrink-0 items-center gap-2 px-3',
          presentation === 'rollup' ? 'border-b border-border/35' : 'border-b border-border/45',
        )}>
          <div className="flex size-7 items-center justify-center rounded-md bg-foreground/6 text-foreground">
            <Layers className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium leading-5">{activeSurface.title}</div>
            <div className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
              <span className="capitalize">{activeSurface.kind}</span>
              <span className="size-1 rounded-full bg-muted-foreground/40" />
              <span className="capitalize">{activeSurface.status}</span>
            </div>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Collapse visual sidecar"
            className="size-8"
            onClick={collapseSidecar}
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Close visual sidecar"
            className="size-8"
            onClick={closeSidecar}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <div className={cn(
            'relative min-h-[220px] flex-1 overflow-hidden bg-background/65',
            presentation === 'rollup'
              ? 'rounded-md border border-border/45'
              : 'rounded-lg border border-border/60',
          )}>
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
              <span className="min-w-0 truncate">Renderer placeholder. Canvas and media attach in later phases.</span>
            </div>
          </div>

          <div className={cn(
            'grid shrink-0 grid-cols-3 gap-2',
            presentation === 'rollup' && 'hidden @md/panel:grid',
          )}>
            {['Artifacts', 'Canvas', 'Media'].map((label) => (
              <div key={label} className="rounded-md border border-border/55 bg-foreground/[0.025] px-2.5 py-2">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="mt-0.5 text-sm font-medium">0</div>
              </div>
            ))}
          </div>

          {presentation === 'rollup' ? null : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 shrink-0 justify-center"
              onClick={focusSidecar}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Focus visual
            </Button>
          )}
        </div>
      </div>
    </aside>
  )
}
