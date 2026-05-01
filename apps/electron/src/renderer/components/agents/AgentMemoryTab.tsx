import * as React from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Info_Section } from '@/components/info'
import { useAgentMemory } from '@/hooks/useAgentMemory'
import { MemoryEditDialog } from './MemoryEditDialog'
import type { MemoryEntry } from '@craft-agent/shared/memory'

interface AgentMemoryTabProps {
  agentSlug: string
  agentName: string
}

export function AgentMemoryTab({ agentSlug, agentName }: AgentMemoryTabProps) {
  const { entries, loading, error, upsert, remove } = useAgentMemory(agentSlug)
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
          <Button size="sm" onClick={handleNew}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add memory
          </Button>
        </div>

        {loading ? (
          <div className="rounded-md border border-border/40 p-3 text-sm text-muted-foreground">Loading memory...</div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
        ) : entries.length === 0 ? (
          <div className="rounded-md border border-border/40 p-4 text-sm text-muted-foreground">
            No agent memory yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border/40">
            <table className="w-full text-sm">
              <thead className="bg-foreground/[0.03] text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Name</th>
                  <th className="text-left font-medium px-3 py-2 w-28">Type</th>
                  <th className="text-left font-medium px-3 py-2 w-36">Updated</th>
                  <th className="text-right font-medium px-3 py-2 w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.name} className="border-t border-border/30">
                    <td className="px-3 py-2 min-w-0">
                      <div className="font-medium truncate">{entry.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">{entry.body}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{entry.type}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(entry.updated ?? entry.created)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingEntry(entry)
                            setDialogOpen(true)
                          }}
                          className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-foreground/5"
                          aria-label={`Edit ${entry.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(entry)}
                          className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-foreground/5 text-destructive"
                          aria-label={`Forget ${entry.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
