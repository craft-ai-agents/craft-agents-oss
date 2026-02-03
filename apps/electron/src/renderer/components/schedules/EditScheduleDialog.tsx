/**
 * EditScheduleDialog - Form modal for editing scheduled prompts
 *
 * Follows RenameDialog pattern with:
 * - Dialog + DialogContent + DialogHeader + DialogFooter
 * - useRegisterModal for close handling
 * - Focus management with useEffect
 */

import { useEffect, useState, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useRegisterModal } from '@/context/ModalContext'
import { cn } from '@/lib/utils'
import type { ScheduledPromptConfig, ScheduleDay } from '@craft-agent/shared/schedules'

const ALL_DAYS: ScheduleDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABELS: Record<ScheduleDay, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

interface EditScheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  schedule: ScheduledPromptConfig | null
  onSave: (updates: Partial<ScheduledPromptConfig>) => void
}

export function EditScheduleDialog({
  open,
  onOpenChange,
  schedule,
  onSave,
}: EditScheduleDialogProps) {
  const nameRef = useRef<HTMLInputElement>(null)

  // Form state
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [time, setTime] = useState('09:00')
  const [days, setDays] = useState<ScheduleDay[]>([])
  const [enabled, setEnabled] = useState(true)

  // Register modal for close handling
  useRegisterModal(open, () => onOpenChange(false))

  // Populate form when schedule changes
  useEffect(() => {
    if (schedule && open) {
      setName(schedule.name)
      setPrompt(schedule.prompt)
      // Convert first time to HH:MM format
      const t = schedule.times[0] ?? { hour: 9, minute: 0 }
      setTime(
        `${t.hour.toString().padStart(2, '0')}:${t.minute.toString().padStart(2, '0')}`
      )
      setDays(schedule.days ?? [])
      setEnabled(schedule.enabled)

      // Focus name input
      setTimeout(() => nameRef.current?.focus(), 0)
    }
  }, [schedule, open])

  const handleSave = () => {
    // Parse time string to ScheduleTime
    const [hourStr, minStr] = time.split(':')
    const hour = parseInt(hourStr, 10)
    const minute = parseInt(minStr, 10)

    onSave({
      name: name.trim(),
      prompt: prompt.trim(),
      times: [{ hour, minute }],
      days: days.length > 0 && days.length < 7 ? days : undefined,
      enabled,
    })
    onOpenChange(false)
  }

  const toggleDay = (day: ScheduleDay) => {
    setDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  const isValid = name.trim() && prompt.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[480px]"
        onOpenAutoFocus={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Edit Schedule</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="schedule-name">Name</Label>
            <Input
              id="schedule-name"
              ref={nameRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Morning standup"
            />
          </div>

          {/* Prompt */}
          <div className="space-y-2">
            <Label htmlFor="schedule-prompt">Prompt</Label>
            <Textarea
              id="schedule-prompt"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              rows={3}
            />
          </div>

          {/* Time */}
          <div className="space-y-2">
            <Label htmlFor="schedule-time">Time</Label>
            <Input
              id="schedule-time"
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-32"
            />
          </div>

          {/* Days */}
          <div className="space-y-2">
            <Label>Days</Label>
            <p className="text-xs text-muted-foreground">
              Leave unselected to run every day
            </p>
            <div className="flex gap-1">
              {ALL_DAYS.map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={cn(
                    'px-2 py-1 text-xs rounded-md transition-colors',
                    days.includes(day)
                      ? 'bg-foreground text-background'
                      : 'bg-foreground/5 hover:bg-foreground/10'
                  )}
                >
                  {DAY_LABELS[day]}
                </button>
              ))}
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="schedule-enabled">Enabled</Label>
            <Switch
              id="schedule-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
