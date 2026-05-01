import * as React from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { MemoryEntry, MemoryEntryType } from '@craft-agent/shared/memory/types'
import type { MemoryMutationInput } from '@/hooks/useAgentMemory'

interface MemoryEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: MemoryEntry | null
  scopeLabel: string
  onSave: (input: MemoryMutationInput) => Promise<void>
}

interface FormState {
  name: string
  type: MemoryEntryType
  body: string
  expires: string
}

const MEMORY_TYPES: MemoryEntryType[] = ['user', 'feedback', 'project', 'reference']

export function MemoryEditDialog({ open, onOpenChange, entry, scopeLabel, onSave }: MemoryEditDialogProps) {
  const isEditing = !!entry
  const [form, setForm] = React.useState<FormState>(() => buildInitialState(entry))
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setForm(buildInitialState(entry))
    setSaving(false)
  }, [entry, open])

  const handleSave = async () => {
    const name = form.name.trim()
    const body = form.body.trim()
    if (!name || !body) {
      toast.error('Name and body are required')
      return
    }
    setSaving(true)
    try {
          await onSave({
        name: entry?.name ?? name,
        type: entry?.type ?? form.type,
        body,
        expires: form.expires.trim() || null,
      })
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to save memory', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit memory' : 'New memory'}</DialogTitle>
          <DialogDescription>
            Saved in {scopeLabel} and injected into matching agent sessions.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className="memory-input"
                placeholder="Preferred writing style"
                disabled={isEditing}
              />
            </Field>
            <Field label="Type">
              <select
                value={form.type}
                onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as MemoryEntryType }))}
                className="memory-input"
                disabled={isEditing}
              >
                {MEMORY_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Expires">
            <input
              value={form.expires}
              onChange={(event) => setForm((prev) => ({ ...prev, expires: event.target.value }))}
              className="memory-input"
              placeholder="Optional ISO date"
            />
          </Field>

          <Field label="Body">
            <textarea
              value={form.body}
              onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
              className="memory-input min-h-[220px] resize-y font-mono text-xs"
              placeholder="Write the durable memory here..."
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </DialogFooter>

        <style>{`
          .memory-input {
            display: block;
            width: 100%;
            padding: 0.4rem 0.6rem;
            font-size: 13px;
            background: rgba(0,0,0,0);
            border: 1px solid rgba(125,125,125,0.25);
            border-radius: 6px;
            color: inherit;
            outline: none;
          }
          .memory-input:focus {
            border-color: rgba(80,160,250,0.6);
          }
        `}</style>
      </DialogContent>
    </Dialog>
  )
}

function buildInitialState(entry: MemoryEntry | null): FormState {
  return {
    name: entry?.name ?? '',
    type: entry?.type ?? 'reference',
    body: entry?.body ?? '',
    expires: entry?.expires ?? '',
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      {children}
    </label>
  )
}
