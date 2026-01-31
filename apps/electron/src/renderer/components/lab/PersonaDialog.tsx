/**
 * PersonaDialog
 *
 * Dialog for creating and editing Lab personas.
 * Works as both a create dialog (persona=undefined) and edit dialog (persona provided).
 */

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { LabPersona, CreatePersonaInput } from '@craft-agent/shared/lab/types'

interface PersonaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** If provided, dialog is in edit mode */
  persona?: LabPersona | null
  /** Called on create (no persona) */
  onCreate?: (input: CreatePersonaInput) => void
  /** Called on save (edit mode) */
  onSave?: (persona: LabPersona) => void
}

const MODEL_OPTIONS = [
  { value: 'haiku', label: 'Haiku', desc: 'Fast, cheap' },
  { value: 'sonnet', label: 'Sonnet', desc: 'Balanced' },
  { value: 'opus', label: 'Opus', desc: 'Most capable' },
]

const EMOJI_SUGGESTIONS = ['🧑‍💼', '🎨', '🏗️', '⚙️', '🖥️', '🔍', '📚', '🧪', '💡', '🎯', '🛡️', '📊', '🤖', '🧠', '📝', '🔬']

export function PersonaDialog({
  open,
  onOpenChange,
  persona,
  onCreate,
  onSave,
}: PersonaDialogProps) {
  const isEdit = !!persona

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [icon, setIcon] = useState('')
  const [mindset, setMindset] = useState('')
  const [knowledge, setKnowledge] = useState('')
  const [evaluationCriteria, setEvaluationCriteria] = useState('')
  const [model, setModel] = useState('haiku')

  // Populate fields when editing
  useEffect(() => {
    if (persona) {
      setName(persona.name)
      setRole(persona.role)
      setIcon(persona.icon)
      setMindset(persona.mindset)
      setKnowledge(persona.knowledge)
      setEvaluationCriteria(persona.evaluationCriteria)
      setModel(persona.model || 'haiku')
    } else {
      setName('')
      setRole('')
      setIcon('🧑‍💼')
      setMindset('')
      setKnowledge('')
      setEvaluationCriteria('')
      setModel('haiku')
    }
  }, [persona, open])

  const isValid = name.trim() && role.trim() && mindset.trim()

  const handleSubmit = () => {
    if (!isValid) return

    if (isEdit && persona && onSave) {
      onSave({
        ...persona,
        name: name.trim(),
        role: role.trim(),
        icon: icon || '🧑‍💼',
        mindset: mindset.trim(),
        knowledge: knowledge.trim(),
        evaluationCriteria: evaluationCriteria.trim(),
        model,
        updatedAt: Date.now(),
      })
    } else if (onCreate) {
      onCreate({
        name: name.trim(),
        role: role.trim(),
        icon: icon || '🧑‍💼',
        mindset: mindset.trim(),
        knowledge: knowledge.trim(),
        evaluationCriteria: evaluationCriteria.trim(),
        model,
      })
    }

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Persona' : 'Create Persona'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Modify this persona\'s attributes. Changes take effect on the next pipeline run.'
              : 'Define a new persona for your team. Each persona brings a unique perspective.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Icon + Name row */}
          <div className="flex items-start gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Icon</label>
              <div className="flex flex-wrap gap-1 max-w-[140px]">
                {EMOJI_SUGGESTIONS.map(e => (
                  <button
                    key={e}
                    type="button"
                    className={cn(
                      'h-7 w-7 rounded flex items-center justify-center text-sm transition-colors',
                      icon === e ? 'bg-accent/20 ring-1 ring-accent' : 'hover:bg-foreground/5',
                    )}
                    onClick={() => setIcon(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Product Owner"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Role *</label>
                <Input
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  placeholder="e.g. Product management and user advocacy"
                />
              </div>
            </div>
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Model</label>
            <div className="flex gap-2">
              {MODEL_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={cn(
                    'flex-1 px-3 py-1.5 rounded-md text-xs transition-colors border',
                    model === opt.value
                      ? 'border-accent bg-accent/10 text-accent font-medium'
                      : 'border-foreground/10 hover:bg-foreground/5 text-muted-foreground',
                  )}
                  onClick={() => setModel(opt.value)}
                >
                  <div>{opt.label}</div>
                  <div className="text-[10px] opacity-60">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Mindset */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Mindset *</label>
            <textarea
              className={cn(
                'w-full min-h-[60px] rounded-md border border-foreground/15 bg-transparent',
                'px-3 py-2 text-sm resize-y',
                'placeholder:text-muted-foreground/50',
                'focus:outline-none focus:ring-1 focus:ring-foreground/30',
              )}
              value={mindset}
              onChange={e => setMindset(e.target.value)}
              placeholder="How this persona thinks and approaches problems..."
            />
          </div>

          {/* Knowledge */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Knowledge</label>
            <textarea
              className={cn(
                'w-full min-h-[60px] rounded-md border border-foreground/15 bg-transparent',
                'px-3 py-2 text-sm resize-y',
                'placeholder:text-muted-foreground/50',
                'focus:outline-none focus:ring-1 focus:ring-foreground/30',
              )}
              value={knowledge}
              onChange={e => setKnowledge(e.target.value)}
              placeholder="Domain expertise and areas of knowledge..."
            />
          </div>

          {/* Evaluation Criteria */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Evaluation Criteria</label>
            <textarea
              className={cn(
                'w-full min-h-[60px] rounded-md border border-foreground/15 bg-transparent',
                'px-3 py-2 text-sm resize-y',
                'placeholder:text-muted-foreground/50',
                'focus:outline-none focus:ring-1 focus:ring-foreground/30',
              )}
              value={evaluationCriteria}
              onChange={e => setEvaluationCriteria(e.target.value)}
              placeholder="How this persona judges quality during reviews..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!isValid} onClick={handleSubmit}>
            {isEdit ? 'Save Changes' : 'Create Persona'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
