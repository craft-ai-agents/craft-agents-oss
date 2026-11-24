import { useEffect, type CSSProperties } from 'react'
import { Check, Copy, CornerDownLeft, Languages, PenLine, RotateCcw, X } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { Button, IconButton } from '@/components/ui/button'
import type { CraftyTransform } from '../../shared/crafty'

/** A Rewrite or Translate from the pie: one completion outside any session. */
export interface OneShot {
  transform: CraftyTransform
  /** "Rewrite · Shorter", "Translate · Hungarian". */
  title: string
  /** A Translate's language (BCP 47), which main remembers for the next sub-pie once it worked. */
  languageCode?: string
  status: 'running' | 'done' | 'error'
  result: string | null
  /** Why it failed, or (with a result) why Replace failed. */
  error: string | null
}

interface OneShotCardProps {
  oneShot: OneShot
  /** Whether the source app's focused element takes text (Replace), or only Copy; null until known. */
  editable: boolean | null
  copied: boolean
  closing: boolean
  /** The frame's size and bloom origin, as the panel's. */
  frameStyle: CSSProperties
  onReplace: () => void
  onCopy: () => void
  onRetry: () => void
  onClose: () => void
}

/**
 * The one-shot's preview, in the panel's frame. ↵ replaces the selection when the app's field is
 * editable, else copies; Esc discards (CraftyApp's handler). It never replaces blind: a field
 * Accessibility doesn't report as editable only gets Copy.
 */
export function OneShotCard({ oneShot, editable, copied, closing, frameStyle, onReplace, onCopy, onRetry, onClose }: OneShotCardProps) {
  const done = oneShot.status === 'done' && !!oneShot.result
  const canReplace = done && editable === true
  const rewrite = oneShot.transform.kind === 'rewrite'
  const Icon = rewrite ? PenLine : Languages

  useEffect(() => {
    if (!done || closing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      // A focused button takes its own Enter
      if (e.target instanceof HTMLElement && e.target.closest('button')) return
      e.preventDefault()
      if (canReplace) onReplace()
      else onCopy()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canReplace, closing, done, onCopy, onReplace])

  return (
    <div
      className="crafty-panel popover-styled flex flex-col overflow-hidden text-foreground"
      data-state={closing ? 'closing' : 'open'}
      style={frameStyle}
    >
      <div data-drag-handle className="flex cursor-grab select-none items-center gap-2 py-2 pl-card-pad pr-2 active:cursor-grabbing">
        <Icon className="size-4 shrink-0 text-secondary" />
        <span className="min-w-0 flex-1 truncate text-label-sm font-medium">{oneShot.title}</span>
        <IconButton aria-label="Close" size="sm" icon={<X />} onClick={onClose} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-subtle px-card-pad py-2">
        {oneShot.status === 'running' && (
          <div className="flex items-center gap-2 text-label-sm text-secondary">
            <Spinner /> {rewrite ? 'Rewriting…' : 'Translating…'}
          </div>
        )}
        {oneShot.result && <div className="select-text whitespace-pre-wrap break-words text-label">{oneShot.result}</div>}
        {oneShot.error && <div className="mt-1 text-label-sm text-destructive">{oneShot.error}</div>}
      </div>

      {(done || oneShot.status === 'error') && (
        <div className="flex items-center gap-1 border-t border-subtle px-card-pad py-2">
          {canReplace && <Button size="sm" onClick={onReplace}><CornerDownLeft /> Replace</Button>}
          {done && (
            <Button size="sm" variant={canReplace ? 'ghost' : 'primary'} onClick={onCopy}>
              {copied ? <Check className="text-success" /> : canReplace ? <Copy /> : <CornerDownLeft />} {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
          {oneShot.status === 'error' && <Button size="sm" variant="secondary" onClick={onRetry}><RotateCcw /> Try again</Button>}
          {done && editable === false && (
            <span className="ml-auto truncate pl-2 text-caption text-tertiary">This app's text can't be replaced</span>
          )}
        </div>
      )}
    </div>
  )
}
