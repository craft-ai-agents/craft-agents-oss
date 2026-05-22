import * as React from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useUserProfile } from '@/hooks/useUserProfile'
import { MemoryEditDialog } from './MemoryEditDialog'
import type { MemoryEntry } from '@craft-agent/shared/memory/types'

interface UserProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserProfileDialog({ open, onOpenChange }: UserProfileDialogProps) {
  const { entries, loading, error, warning, upsert, remove } = useUserProfile()
  const [editingEntry, setEditingEntry] = React.useState<MemoryEntry | null>(null)
  const [editOpen, setEditOpen] = React.useState(false)

  const handleDelete = async (entry: MemoryEntry) => {
    if (!confirm(`Forget "${entry.name}" from USER.md?`)) return
    try {
      const ok = await remove(entry.name)
      if (ok) toast.success(`Forgot "${entry.name}"`)
    } catch (err) {
      toast.error('Failed to forget profile memory', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Memory & Profile</DialogTitle>
            <DialogDescription className="text-white/48">
              USER.md entries are injected into agent sessions as durable user memory.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <Button
                size="sm"
                className="border border-[#fb923c]/25 bg-[#f97316]/18 text-white/90 hover:bg-[#f97316]/26"
                onClick={() => {
                  setEditingEntry(null)
                  setEditOpen(true)
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add profile memory
              </Button>
            </div>

            {loading ? (
              <div className="runneros-card p-3 text-sm text-white/48">Loading profile...</div>
            ) : error ? (
              <div className="rounded-[12px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
            ) : (
              <>
                {warning ? (
                  <div className="rounded-[12px] border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">{warning}</div>
                ) : null}
                {entries.length === 0 ? (
                  <div className="runneros-card p-4 text-sm text-white/48">
                    No USER.md memories yet.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {entries.map((entry) => (
                      <div key={entry.name} className="runneros-card flex items-start justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white/82">{entry.name}</div>
                          <div className="mt-0.5 line-clamp-2 text-xs text-white/45">{entry.body}</div>
                          <div className="mt-1 text-[11px] uppercase tracking-wide text-white/32">{entry.type}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEntry(entry)
                              setEditOpen(true)
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
          </div>
        </DialogContent>
      </Dialog>

      <MemoryEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        entry={editingEntry}
        scopeLabel="USER.md"
        onSave={upsert}
      />
    </>
  )
}
