/**
 * CreateProjectDialog
 *
 * Dialog for creating a new Lab project.
 * Follows the RenameDialog pattern with additional fields.
 */

import { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useRegisterModal } from '@/context/ModalContext'
import type { CreateProjectInput } from '@craft-agent/shared/lab/types'

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: CreateProjectInput) => void
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onSubmit,
}: CreateProjectDialogProps) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [goalsText, setGoalsText] = useState('')

  useRegisterModal(open, () => onOpenChange(false))

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setGoalsText('')
      const timer = setTimeout(() => nameRef.current?.focus(), 0)
      return () => clearTimeout(timer)
    }
  }, [open])

  const handleSubmit = () => {
    if (!name.trim()) return

    const goals = goalsText
      .split('\n')
      .map(g => g.trim())
      .filter(Boolean)

    onSubmit({
      name: name.trim(),
      description: description.trim(),
      goals,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[480px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>New Lab Project</DialogTitle>
          <DialogDescription>
            Create a project to orchestrate a team of AI personas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Project Name
            </label>
            <Input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., User Authentication System"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit()
              }}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
            />
          </div>

          {/* Goals */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Goals (one per line, optional)
            </label>
            <textarea
              className="w-full min-h-[60px] rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              value={goalsText}
              onChange={(e) => setGoalsText(e.target.value)}
              placeholder={"Secure login and registration\nOAuth integration\nRole-based access control"}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim()}>
            Create Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
