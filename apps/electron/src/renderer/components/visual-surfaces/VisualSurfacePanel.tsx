import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Layers, Maximize2, PanelRight, PanelTopOpen } from 'lucide-react'
import { VISUAL_BOARD_TAG } from '@craft-agent/shared/visual-board'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useOutputs, type OutputManifestDTO, type OutputSummaryDTO } from '@/hooks/useOutputs'
import {
  focusVisualSidecarAtom,
  openDemoVisualSurfaceAtom,
  openOutputVisualSurfaceAtom,
  visualSidecarAtom,
} from '@/atoms/visual-surfaces'
import { renderVisualSurfaceAdapter, type VisualSurfaceAdapterContext } from './VisualSurfaceAdapters'
import { toast } from 'sonner'

interface VisualSurfacePanelProps {
  presentation: 'inline' | 'overlay' | 'rollup'
}

export function VisualSurfacePanel({ presentation }: VisualSurfacePanelProps) {
  const { activeSurface, isCollapsed, focusedAt } = useAtomValue(visualSidecarAtom)
  const focusSidecar = useSetAtom(focusVisualSidecarAtom)
  const openOutputVisualSurface = useSetAtom(openOutputVisualSurfaceAtom)
  const openDemoVisualSurface = useSetAtom(openDemoVisualSurfaceAtom)
  const focusPulseKey = focusedAt ?? 0
  const { outputs, getOutput } = useOutputs(activeSurface?.workspaceId)
  const sessionOutputs = React.useMemo(
    () => activeSurface?.sessionId
      ? outputs.filter((output) => output.origin?.sessionId === activeSurface.sessionId)
      : [],
    [activeSurface?.sessionId, outputs],
  )
  const boardOutput = React.useMemo(
    () => sessionOutputs.find((output) => output.tags?.includes(VISUAL_BOARD_TAG)),
    [sessionOutputs],
  )
  const latestDisplayOutput = React.useMemo(
    () => sessionOutputs.find((output) => !output.tags?.includes(VISUAL_BOARD_TAG)),
    [sessionOutputs],
  )
  const tabOutputs = React.useMemo(() => {
    const displayOutputs = sessionOutputs
      .filter((output) => !output.tags?.includes(VISUAL_BOARD_TAG))
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    return boardOutput ? [boardOutput, ...displayOutputs] : displayOutputs
  }, [boardOutput, sessionOutputs])
  const selectedOutputId = activeSurface?.outputId
    ?? (activeSurface?.kind === 'canvas' ? latestDisplayOutput?.id ?? boardOutput?.id : undefined)
  const [selectedManifest, setSelectedManifest] = React.useState<OutputManifestDTO | null>(null)
  const [manifestError, setManifestError] = React.useState<string | null>(null)
  const visualCaptureRef = React.useRef<HTMLDivElement | null>(null)
  const capturedVersionsRef = React.useRef(new Set<string>())

  React.useEffect(() => {
    if (!selectedOutputId) {
      setSelectedManifest(null)
      setManifestError(null)
      return
    }

    let mounted = true
    setManifestError(null)
    getOutput(selectedOutputId).then((manifest) => {
      if (!mounted) return
      setSelectedManifest(manifest)
      if (!manifest) setManifestError('Output not found.')
    }).catch((err) => {
      if (mounted) setManifestError(err instanceof Error ? err.message : String(err))
    })
    return () => { mounted = false }
  }, [getOutput, selectedOutputId])

  const openOutput = React.useCallback((output: OutputSummaryDTO) => {
    if (!activeSurface?.sessionId) return
    openOutputVisualSurface({
      workspaceId: activeSurface.workspaceId,
      sessionId: activeSurface.sessionId,
      outputId: output.id,
      title: output.title,
      kind: output.kind,
      createdAt: output.createdAt,
      updatedAt: output.updatedAt,
    })
  }, [activeSurface?.sessionId, activeSurface?.workspaceId, openOutputVisualSurface])

  const sendSelectedOutputToCanvas = React.useCallback(async () => {
    if (!activeSurface?.workspaceId || !activeSurface.sessionId || !selectedManifest) return
    if (selectedManifest.tags?.includes(VISUAL_BOARD_TAG)) return

    const action = selectedManifest.kind === 'image'
      ? 'add_image'
      : selectedManifest.kind === 'video'
        ? 'add_video'
        : 'pin_output'

    try {
      const result = await window.electronAPI.applyVisualSurfaceEvent(
        activeSurface.workspaceId,
        activeSurface.sessionId,
        { action, outputId: selectedManifest.id },
      )
      if (!result.ok) {
        toast.error(result.error ?? 'Could not add output to Canvas.')
        return
      }
      openDemoVisualSurface({ workspaceId: activeSurface.workspaceId, sessionId: activeSurface.sessionId })
      toast.success(result.receipt ?? 'Added output to Canvas.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [activeSurface?.sessionId, activeSurface?.workspaceId, openDemoVisualSurface, selectedManifest])

  React.useEffect(() => {
    if (!activeSurface?.workspaceId || !activeSurface.sessionId || !selectedManifest) return
    if (selectedManifest.tags?.includes(VISUAL_BOARD_TAG)) return
    if (selectedManifest.origin?.sessionId !== activeSurface.sessionId) return
    if (isCollapsed) return

    const workspaceId = activeSurface.workspaceId
    const sessionId = activeSurface.sessionId
    const captureVersion = visualCaptureVersion(selectedManifest)
    const captureKey = `${workspaceId}:${sessionId}:${selectedManifest.id}:${captureVersion}`
    if (capturedVersionsRef.current.has(captureKey)) return

    let cancelled = false
    const timeout = window.setTimeout(async () => {
      if (cancelled) return
      const node = visualCaptureRef.current
      const captureVisualElement = window.electronAPI.captureVisualElement
      const recordVisualCapture = window.electronAPI.recordVisualCapture
      if (!node || typeof captureVisualElement !== 'function' || typeof recordVisualCapture !== 'function') return
      const rect = node.getBoundingClientRect()
      if (rect.width < 80 || rect.height < 80) return

      try {
        const capture = await captureVisualElement({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        })
        if (cancelled) return
        await recordVisualCapture({
          workspaceId,
          sessionId,
          outputId: selectedManifest.id,
          source: 'canvas',
          captureVersion,
          dataUrl: capture.dataUrl,
          width: capture.width,
          height: capture.height,
        })
        capturedVersionsRef.current.add(captureKey)
      } catch (err) {
        console.warn('[VisualSurfacePanel] visual capture failed:', err)
      }
    }, 1600)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [activeSurface?.sessionId, activeSurface?.workspaceId, isCollapsed, selectedManifest])

  if (!activeSurface) return null

  const adapterContext: VisualSurfaceAdapterContext = {
    workspaceId: activeSurface.workspaceId,
    sessionId: activeSurface.sessionId,
    surface: activeSurface,
    selectedOutputId,
    selectedManifest,
    sessionOutputs,
    boardOutput,
    manifestError,
    onOpenOutput: openOutput,
  }
  const selectedIsBoard = selectedManifest?.tags?.includes(VISUAL_BOARD_TAG) === true
  const canSendSelectedOutputToCanvas = !!activeSurface.sessionId
    && !!selectedManifest
    && !selectedIsBoard
    && selectedManifest.origin?.sessionId === activeSurface.sessionId

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
        'z-[7] flex min-h-0 animate-in fade-in-0 duration-150',
        presentation === 'inline'
          ? 'h-full w-[clamp(420px,30vw,560px)] shrink-0'
          : presentation === 'rollup'
            ? 'relative min-h-0 w-full flex-1 shrink overflow-hidden'
          : 'absolute bottom-[150px] right-2 top-[56px] h-auto w-[min(430px,calc(100%_-_16px))] shrink-0',
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
        {presentation === 'rollup' ? null : (
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/45 px-3">
            <div className="flex size-7 items-center justify-center rounded-md bg-foreground/6 text-foreground">
              <Layers className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium leading-5">Canvas</div>
            </div>
          </header>
        )}

        <div className={cn(
          'flex min-h-0 flex-1 flex-col overflow-y-auto',
          presentation === 'rollup' ? 'gap-2 px-0 pb-3 pt-0' : 'gap-3 p-3',
        )}>
          <div className={cn(
            'relative min-h-[220px] flex-1 overflow-hidden bg-[#050505]',
            presentation === 'rollup'
              ? 'min-h-0 rounded-t-none rounded-b-md border-x border-b border-border/45'
              : 'rounded-lg border border-border/60',
          )} ref={visualCaptureRef}>
            {renderVisualSurfaceAdapter(adapterContext)}
          </div>

          {tabOutputs.length > 1 ? (
            <OutputSelector
              outputs={tabOutputs}
              selectedOutputId={selectedOutputId}
              onSelect={openOutput}
            />
          ) : null}

          {presentation === 'rollup' ? null : (
            <div className="flex shrink-0 gap-2">
              {canSendSelectedOutputToCanvas ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 flex-1 justify-center"
                  onClick={sendSelectedOutputToCanvas}
                >
                  <PanelTopOpen className="h-3.5 w-3.5" />
                  Add to board
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 flex-1 justify-center"
                onClick={focusSidecar}
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Focus visual
              </Button>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

function visualCaptureVersion(manifest: OutputManifestDTO): string {
  const assets = manifest.assets
    .filter((asset) => asset.id !== 'visual-capture-canvas' && !asset.path.startsWith('visual-captures/'))
    .map((asset) => ({
      id: asset.id,
      path: asset.path,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      mimeType: asset.mimeType,
    }))
  const links = manifest.links.map((link) => ({ label: link.label, url: link.url, role: link.role }))
  return JSON.stringify({
    id: manifest.id,
    title: manifest.title,
    kind: manifest.kind,
    summary: manifest.summary,
    status: manifest.status,
    createdAt: manifest.createdAt,
    completedAt: manifest.completedAt,
    primary: manifest.primary?.id,
    preview: manifest.preview,
    assets,
    links,
  })
}

function OutputSelector({
  outputs,
  selectedOutputId,
  onSelect,
}: {
  outputs: OutputSummaryDTO[]
  selectedOutputId?: string
  onSelect: (output: OutputSummaryDTO) => void
}) {
  const activeTabRef = React.useRef<HTMLButtonElement | null>(null)

  React.useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    })
  }, [selectedOutputId, outputs.length])

  return (
    <div className="shrink-0 overflow-hidden border-t border-border/45 bg-[#050505]">
      <div className="flex gap-1 overflow-x-auto px-1.5 py-1.5">
        {outputs.map((output) => {
          const isBoard = output.tags?.includes(VISUAL_BOARD_TAG) ?? false
          const isSelected = output.id === selectedOutputId
          return (
            <button
              key={output.id}
              ref={isSelected ? activeTabRef : undefined}
              type="button"
              className={cn(
                'min-w-0 shrink-0 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                isSelected
                  ? 'border-sky-300/30 bg-sky-400/12 text-sky-100'
                  : 'border-border/45 bg-foreground/[0.025] text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground',
              )}
              onClick={() => onSelect(output)}
            >
              <span className="block max-w-40 truncate font-medium">{isBoard ? 'Board' : output.title}</span>
              <span className="block truncate text-[10px] capitalize opacity-70">{isBoard ? 'Canvas' : output.kind}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
