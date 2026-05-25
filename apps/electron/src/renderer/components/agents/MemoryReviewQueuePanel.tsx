import * as React from 'react'
import { Check, Inbox, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useMemoryReviewQueue } from '@/hooks/useMemoryReviewQueue'
import type { MemoryReviewItem, MemoryScope } from '@craft-agent/shared/memory/types'

interface MemoryReviewQueuePanelProps {
  scope: MemoryScope
  agentSlug?: string | null
}

export function MemoryReviewQueuePanel({ scope, agentSlug }: MemoryReviewQueuePanelProps) {
  const { items, loading, error, apply, reject } = useMemoryReviewQueue({ scope, agentSlug })

  const handleApply = async (item: MemoryReviewItem) => {
    try {
      await apply(item)
      toast.success(`Applied memory proposal: ${item.name}`)
    } catch (err) {
      toast.error('Failed to apply memory proposal', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleReject = async (item: MemoryReviewItem) => {
    try {
      await reject(item)
      toast.success(`Rejected memory proposal: ${item.name}`)
    } catch (err) {
      toast.error('Failed to reject memory proposal', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <div className="runneros-card p-3">
      <div className="flex items-center gap-2">
        <Inbox className="h-4 w-4 text-white/45" />
        <div>
          <div className="text-sm font-medium text-white/78">Review queue</div>
          <div className="text-xs text-white/38">Pending memory proposals before they become permanent.</div>
        </div>
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-white/42">Loading proposals...</div>
        ) : error ? (
          <div className="rounded-[10px] border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{error}</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-white/42">No pending memory proposals.</div>
        ) : (
          <div className="grid gap-2">
            {items.map((item) => (
              <MemoryReviewRow
                key={item.id}
                item={item}
                onApply={() => void handleApply(item)}
                onReject={() => void handleReject(item)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MemoryReviewRow({
  item,
  onApply,
  onReject,
}: {
  item: MemoryReviewItem
  onApply: () => void
  onReject: () => void
}) {
  return (
    <div className="rounded-[10px] border border-white/[0.07] bg-white/[0.025] p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded-[6px] border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200/85">
              {item.action}
            </span>
            <span className="truncate text-sm font-medium text-white/78">{item.name}</span>
          </div>
          {item.body ? (
            <div className="mt-1 line-clamp-2 text-xs text-white/45">{item.body}</div>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/34">
            <span>{Math.round(item.confidence * 100)}% confidence</span>
            <span>{item.source}</span>
            {item.sourceRunId ? <span>run: {item.sourceRunId}</span> : null}
          </div>
          {item.evidence ? (
            <div className="mt-1 line-clamp-2 text-xs text-white/40">{item.evidence}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-emerald-200/70 hover:bg-emerald-500/12 hover:text-emerald-100"
            onClick={onApply}
            aria-label={`Apply ${item.name}`}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-red-200/70 hover:bg-red-500/12 hover:text-red-100"
            onClick={onReject}
            aria-label={`Reject ${item.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
