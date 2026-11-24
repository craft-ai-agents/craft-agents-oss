import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CraftyProvenance, CraftySelectionResult } from '../../shared/crafty'
import { contextSummary } from './context'

interface ContextProps {
  selection: CraftySelectionResult
  provenance: CraftyProvenance | null
}

/**
 * The capture in the header: "98 characters from Slack". You know what you selected, so the
 * details start closed; a click opens them under the header. The label sits on the panel's text
 * edge and the chevron trails it, like the session list's group headers.
 */
export function ContextChip({ selection, provenance, open, onToggle, detailsId }: ContextProps & {
  open: boolean
  onToggle: () => void
  detailsId: string
}) {
  const { label, expandable } = contextSummary(selection, provenance)
  if (!expandable) return <span className="min-w-0 truncate text-label-sm text-tertiary">{label}</span>
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={detailsId}
      onClick={onToggle}
      className="-ml-1 flex min-w-0 items-center gap-0.5 rounded-sm px-1 text-label-sm text-secondary hover:text-foreground"
    >
      <span className="truncate">{label}</span>
      <ChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-micro', open && 'rotate-90')} />
    </button>
  )
}

/** Everything the summary stands for: the window, the page address and the selected text. */
export function ContextDetails({ selection, provenance, id }: ContextProps & { id: string }) {
  const captured = selection.selection
  return (
    <div id={id} className="flex flex-col gap-1 rounded-lg bg-sunken px-2.5 py-1.5">
      {provenance?.windowTitle && (
        <div className="truncate text-caption text-tertiary" title={provenance.windowTitle}>{provenance.windowTitle}</div>
      )}
      {provenance?.url && <div className="truncate text-caption text-tertiary" title={provenance.url}>{provenance.url}</div>}
      {captured && (
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-label-sm">{captured.text}</div>
      )}
      {captured?.method === 'clipboard' && (
        <div className="text-caption text-tertiary">Read with ⌘C: the app didn't share it through Accessibility.</div>
      )}
      {selection.error && <div className="text-label-sm text-secondary">{selection.error}</div>}
    </div>
  )
}
