import * as React from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Info_Section } from '@/components/info'
import { useAgentMemory } from '@/hooks/useAgentMemory'
import { MemoryEditDialog } from './MemoryEditDialog'
import { MemoryActivityPanel } from './MemoryActivityPanel'
import { MemoryRecallPanel } from './MemoryRecallPanel'
import { MemoryReviewQueuePanel } from './MemoryReviewQueuePanel'
import type { MemoryEntry } from '@craft-agent/shared/memory/types'

interface AgentMemoryTabProps {
  agentSlug: string
  agentName: string
}

export function AgentMemoryTab({ agentSlug, agentName }: AgentMemoryTabProps) {
  const { entries, loading, error, warning, upsert, remove } = useAgentMemory(agentSlug)
  const [editingEntry, setEditingEntry] = React.useState<MemoryEntry | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const handleNew = () => {
    setEditingEntry(null)
    setDialogOpen(true)
  }

  const handleDelete = async (entry: MemoryEntry) => {
    if (!confirm(`Forget "${entry.name}" for ${agentName}?`)) return
    try {
      const ok = await remove(entry.name)
      if (ok) toast.success(`Forgot "${entry.name}"`)
    } catch (err) {
      toast.error('Failed to forget memory', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <Info_Section
      title="Memory"
      description="Durable facts and feedback injected into this agent's sessions."
    >
      <div className="flex flex-col gap-3">
        <div className="flex justify-end">
          <Button size="sm" className="border border-[#fb923c]/25 bg-[#f97316]/18 text-white/90 hover:bg-[#f97316]/26" onClick={handleNew}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add memory
          </Button>
        </div>

        {loading ? (
          <div className="runneros-card p-3 text-sm text-white/48">Loading memory...</div>
        ) : error ? (
          <div className="rounded-[12px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
        ) : (
          <>
            {warning ? (
              <div className="rounded-[12px] border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">{warning}</div>
            ) : null}
            {entries.length === 0 ? (
              <div className="runneros-card p-4 text-sm text-white/48">
                No agent memory yet.
              </div>
            ) : (
              <div className="grid gap-2">
                {entries.map((entry) => (
                  <div key={entry.name} className="runneros-card flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white/82">{entry.name}</div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-white/45">{entry.body}</div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/32">
                        <span>{entry.type}</span>
                        <span>{formatDate(entry.updated ?? entry.created)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingEntry(entry)
                          setDialogOpen(true)
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-white/55 hover:bg-white/[0.06] hover:text-white"
                        aria-label={`Edit ${entry.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(entry)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-red-300/70 hover:bg-red-500/12 hover:text-red-200"
                        aria-label={`Forget ${entry.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <MemoryReviewQueuePanel scope="agent" agentSlug={agentSlug} />
        <MemoryRecallPanel scope="agent" agentSlug={agentSlug} />
        <MemoryActivityPanel scope="agent" agentSlug={agentSlug} />
      </div>

      <MemoryEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editingEntry}
        scopeLabel={`${agentName} MEMORY.md`}
        onSave={upsert}
      />
    </Info_Section>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}
