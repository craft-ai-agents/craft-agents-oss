/**
 * Labels Settings Section
 *
 * Workspace-level label management settings.
 * Allows creating, editing, and deleting session labels.
 */

import { useState, useCallback } from 'react'
import { Plus, Pencil, Trash2, Tag, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/AppShellContext'
import { useLabels } from '@/hooks/useLabels'
import { LabelBadge } from '@/components/ui/label-badge'
import {
  SettingsSection,
  SettingsCard,
} from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import type { Label } from '@vesper/shared/labels'

// Preset color palette (matches LABEL_COLORS from shared package)
const LABEL_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
] as const

interface LabelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  initialName?: string
  initialColor?: string
  onSubmit: (name: string, color: string) => void
  isLoading?: boolean
}

function LabelDialog({
  open,
  onOpenChange,
  mode,
  initialName = '',
  initialColor = LABEL_COLORS[0].value,
  onSubmit,
  isLoading,
}: LabelDialogProps) {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)

  // Reset form when dialog opens
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setName(initialName)
      setColor(initialColor)
    }
    onOpenChange(newOpen)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return
    onSubmit(trimmedName, color)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Create Label' : 'Edit Label'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* Name input */}
            <div className="space-y-2">
              <label htmlFor="label-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="label-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Bug, Feature, Urgent"
                maxLength={50}
                autoFocus
              />
            </div>

            {/* Color picker */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Color</label>
              <div className="flex flex-wrap gap-2">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center transition-all',
                      'ring-2 ring-offset-2 ring-offset-background',
                      color === c.value ? 'ring-foreground' : 'ring-transparent hover:ring-foreground/30'
                    )}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                  >
                    {color === c.value && (
                      <Check className="h-4 w-4 text-white drop-shadow-sm" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            {name.trim() && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Preview</label>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-foreground/5">
                  <LabelBadge
                    label={{ id: 'preview', name: name.trim(), color }}
                    size="md"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isLoading}>
              {isLoading ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface LabelRowProps {
  label: Label
  onEdit: () => void
  onDelete: () => void
}

function LabelRow({ label, onEdit, onDelete }: LabelRowProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirm(`Delete "${label.name}" label? This will remove it from all sessions.`)) {
      return
    }
    setIsDeleting(true)
    onDelete()
  }

  return (
    <div className="flex items-center justify-between py-3 px-4 group">
      <div className="flex items-center gap-3">
        <span
          className="w-4 h-4 rounded-full shrink-0"
          style={{ backgroundColor: label.color }}
        />
        <span className="text-sm font-medium">{label.name}</span>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onEdit}
          className="p-1.5 rounded-md hover:bg-foreground/10 transition-colors"
          title="Edit label"
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors"
          title="Delete label"
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </button>
      </div>
    </div>
  )
}

export function LabelsSettingsSection() {
  const { activeWorkspaceId: workspaceId } = useAppShellContext()
  const { labels, refresh } = useLabels(workspaceId)

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingLabel, setEditingLabel] = useState<Label | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleCreate = useCallback(async (name: string, color: string) => {
    if (!workspaceId) return

    setIsLoading(true)
    try {
      await window.electronAPI.createLabel(workspaceId, name, color)
      setCreateDialogOpen(false)
      toast.success(`Label "${name}" created`)
      refresh()
    } catch (error) {
      console.error('Failed to create label:', error)
      toast.error('Failed to create label')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, refresh])

  const handleEdit = useCallback(async (name: string, color: string) => {
    if (!workspaceId || !editingLabel) return

    setIsLoading(true)
    try {
      await window.electronAPI.updateLabel(workspaceId, editingLabel.id, { name, color })
      setEditDialogOpen(false)
      setEditingLabel(null)
      toast.success(`Label "${name}" updated`)
      refresh()
    } catch (error) {
      console.error('Failed to update label:', error)
      toast.error('Failed to update label')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, editingLabel, refresh])

  const handleDelete = useCallback(async (label: Label) => {
    if (!workspaceId) return

    try {
      await window.electronAPI.deleteLabel(workspaceId, label.id)
      toast.success(`Label "${label.name}" deleted`)
      refresh()
    } catch (error) {
      console.error('Failed to delete label:', error)
      toast.error('Failed to delete label')
    }
  }, [workspaceId, refresh])

  const openEditDialog = (label: Label) => {
    setEditingLabel(label)
    setEditDialogOpen(true)
  }

  if (!workspaceId) {
    return null
  }

  return (
    <SettingsSection
      title="Labels"
      description="Organize sessions with custom labels"
    >
      <SettingsCard>
        {labels.length === 0 ? (
          <div className="p-6 text-center">
            <Tag className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground mb-4">
              No labels yet. Create your first label to organize sessions.
            </p>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Label
            </Button>
          </div>
        ) : (
          <>
            {/* Label list */}
            <div className="divide-y divide-border">
              {labels.map((label) => (
                <LabelRow
                  key={label.id}
                  label={label}
                  onEdit={() => openEditDialog(label)}
                  onDelete={() => handleDelete(label)}
                />
              ))}
            </div>

            {/* Add button */}
            <div className="p-4 border-t border-border">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Label
              </Button>
            </div>
          </>
        )}
      </SettingsCard>

      {/* Create Dialog */}
      <LabelDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        mode="create"
        onSubmit={handleCreate}
        isLoading={isLoading}
      />

      {/* Edit Dialog */}
      <LabelDialog
        open={editDialogOpen}
        onOpenChange={(open) => {
          setEditDialogOpen(open)
          if (!open) setEditingLabel(null)
        }}
        mode="edit"
        initialName={editingLabel?.name}
        initialColor={editingLabel?.color}
        onSubmit={handleEdit}
        isLoading={isLoading}
      />
    </SettingsSection>
  )
}
