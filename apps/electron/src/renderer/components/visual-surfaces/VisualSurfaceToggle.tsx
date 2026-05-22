import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Check, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { OutputSummaryDTO } from '@/hooks/useOutputs'
import {
  toggleVisualSurfaceAtom,
  visualSidecarAtom,
  visualSurfacePresentationModeAtom,
  type VisualSurfacePresentationMode,
} from '@/atoms/visual-surfaces'

interface VisualSurfaceToggleProps {
  workspaceId?: string
  sessionId?: string
  latestOutput?: OutputSummaryDTO
}

const MODE_LABELS: Record<VisualSurfacePresentationMode, string> = {
  auto: 'Auto',
  sidecar: 'Sidecar',
  rollup: 'Roll-up',
}

const MODE_DESCRIPTIONS: Record<VisualSurfacePresentationMode, string> = {
  auto: 'Sidecar when wide, roll-up when tight',
  sidecar: 'Prefer right-side viewer',
  rollup: 'Use the chat-area viewer',
}

const MODES: VisualSurfacePresentationMode[] = ['auto', 'sidecar', 'rollup']

export function VisualSurfaceToggle({ workspaceId, sessionId, latestOutput }: VisualSurfaceToggleProps) {
  const visualSidecar = useAtomValue(visualSidecarAtom)
  const [mode, setMode] = useAtom(visualSurfacePresentationModeAtom)
  const toggleVisualSurface = useSetAtom(toggleVisualSurfaceAtom)
  const [menuOpen, setMenuOpen] = React.useState(false)

  const isOpen = !!sessionId && visualSidecar.activeSurface?.sessionId === sessionId
  const isDisabled = !workspaceId || !sessionId
  const title = `Open canvas. Right-click to change view mode. Current: ${MODE_LABELS[mode]}`

  const handleToggle = React.useCallback(() => {
    if (!workspaceId || !sessionId) return
    toggleVisualSurface({
      workspaceId,
      sessionId,
      output: latestOutput
        ? {
            id: latestOutput.id,
            title: latestOutput.title,
            kind: latestOutput.kind,
            createdAt: latestOutput.createdAt,
            updatedAt: latestOutput.updatedAt,
          }
        : undefined,
    })
  }, [latestOutput, sessionId, toggleVisualSurface, workspaceId])

  const handleContextMenu = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    if (!isDisabled) setMenuOpen(true)
  }, [isDisabled])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      if (!isDisabled) setMenuOpen(true)
    }
  }, [isDisabled])

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverAnchor asChild>
        <Button
          type="button"
          size="sm"
          variant={isOpen ? 'secondary' : 'ghost'}
          disabled={isDisabled}
          aria-pressed={isOpen}
          aria-label={title}
          title={title}
          className={cn(
            'h-7 w-7 shrink-0 rounded-[8px] p-0',
            isOpen
              ? 'border border-sky-300/25 bg-sky-400/14 text-sky-100 hover:bg-sky-400/20'
              : 'border border-white/[0.08] bg-white/[0.045] text-white/64 hover:bg-white/[0.08] hover:text-white',
          )}
          onClick={handleToggle}
          onContextMenu={handleContextMenu}
          onKeyDown={handleKeyDown}
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-52 p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">Canvas view</div>
        {MODES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={cn(
              'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs outline-none transition-colors',
              'hover:bg-foreground/8 focus-visible:bg-foreground/8',
              candidate === mode ? 'text-foreground' : 'text-muted-foreground',
            )}
            onClick={() => {
              setMode(candidate)
              setMenuOpen(false)
            }}
          >
            <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              {candidate === mode ? <Check className="h-3.5 w-3.5" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block font-medium">{MODE_LABELS[candidate]}</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                {MODE_DESCRIPTIONS[candidate]}
              </span>
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
