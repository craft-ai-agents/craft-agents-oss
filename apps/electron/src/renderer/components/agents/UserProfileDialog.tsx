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
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Memory & Profile</DialogTitle>
            <DialogDescription>
              USER.md entries are injected into agent sessions as durable user memory.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <Button
                size="sm"
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
              <div className="rounded-md border border-border/40 p-3 text-sm text-muted-foreground">Loading profile...</div>
            ) : error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
            ) : (
              <>
                {warning ? (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">{warning}</div>
                ) : null}
                {entries.length === 0 ? (
                  <div className="rounded-md border border-border/40 p-4 text-sm text-muted-foreground">
                    No USER.md memories yet.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border border-border/40">
                    <table className="w-full text-sm">
                      <thead className="bg-foreground/[0.03] text-xs text-muted-foreground">
                        <tr>
                          <th className="text-left font-medium px-3 py-2">Name</th>
                          <th className="text-left font-medium px-3 py-2 w-28">Type</th>
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
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingEntry(entry)
                                    setEditOpen(true)
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
