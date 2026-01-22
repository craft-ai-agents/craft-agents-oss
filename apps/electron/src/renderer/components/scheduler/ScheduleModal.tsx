import { useState, useMemo } from 'react'
import { Cron } from 'croner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Schedule, ScheduleFormData } from '../../../shared/types'

const PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Daily at 9am', cron: '0 9 * * *' },
  { label: 'Weekdays at 9am', cron: '0 9 * * 1-5' },
  { label: 'Weekly on Monday', cron: '0 9 * * 1' },
  { label: 'Monthly on 1st', cron: '0 9 1 * *' },
]

interface ScheduleModalProps {
  schedule?: Schedule
  onSave: (data: ScheduleFormData) => void
  onClose: () => void
}

export function ScheduleModal({ schedule, onSave, onClose }: ScheduleModalProps) {
  const [name, setName] = useState(schedule?.name || '')
  const [prompt, setPrompt] = useState(schedule?.prompt || '')
  const [scheduleType, setScheduleType] = useState<'recurring' | 'once'>(
    schedule?.cron ? 'recurring' : 'once'
  )
  const [selectedPreset, setSelectedPreset] = useState<string>(
    schedule?.cron && !PRESETS.find(p => p.cron === schedule.cron)
      ? 'custom'
      : schedule?.cron || PRESETS[1].cron
  )
  const [customCron, setCustomCron] = useState(schedule?.cron || '')
  const [scheduledFor, setScheduledFor] = useState<string>(
    schedule?.scheduledFor
      ? new Date(schedule.scheduledFor * 1000).toISOString().slice(0, 16)
      : ''
  )

  const cronExpression = selectedPreset === 'custom' ? customCron : selectedPreset

  const cronError = useMemo(() => {
    if (scheduleType !== 'recurring') return null
    if (!cronExpression) return 'Cron expression required'
    try {
      new Cron(cronExpression)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid cron expression'
    }
  }, [scheduleType, cronExpression])

  const nextRuns = useMemo(() => {
    if (scheduleType !== 'recurring' || cronError) return []
    try {
      const cron = new Cron(cronExpression)
      return cron.nextRuns(3)
    } catch {
      return []
    }
  }, [scheduleType, cronExpression, cronError])

  function handleSubmit() {
    if (scheduleType === 'recurring' && cronError) return

    onSave({
      name,
      prompt,
      cron: scheduleType === 'recurring' ? cronExpression : null,
      scheduledFor: scheduleType === 'once' ? Math.floor(new Date(scheduledFor).getTime() / 1000) : null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      enabled: true,
    })
  }

  const isValid = name && prompt && (
    scheduleType === 'recurring' ? !cronError : scheduledFor
  )

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{schedule ? 'Edit Schedule' : 'New Schedule'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Morning Standup"
            />
          </div>

          {/* Prompt */}
          <div className="space-y-2">
            <Label htmlFor="prompt">Prompt</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Summarize my calendar for today..."
              rows={3}
            />
          </div>

          {/* Schedule Type */}
          <div className="space-y-2">
            <Label>When to run</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={scheduleType === 'recurring' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setScheduleType('recurring')}
              >
                Recurring
              </Button>
              <Button
                type="button"
                variant={scheduleType === 'once' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setScheduleType('once')}
              >
                One-time
              </Button>
            </div>
          </div>

          {/* Recurring Options */}
          {scheduleType === 'recurring' && (
            <div className="space-y-3">
              <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                <SelectTrigger>
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map(p => (
                    <SelectItem key={p.cron} value={p.cron}>
                      {p.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom cron...</SelectItem>
                </SelectContent>
              </Select>

              {selectedPreset === 'custom' && (
                <Input
                  value={customCron}
                  onChange={e => setCustomCron(e.target.value)}
                  placeholder="0 9 * * *"
                  className={cronError ? 'border-destructive' : ''}
                />
              )}

              {cronError && (
                <p className="text-xs text-destructive">{cronError}</p>
              )}

              {nextRuns.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="font-medium">Next runs:</p>
                  {nextRuns.map((date, i) => (
                    <p key={i}>{date.toLocaleString()}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* One-time Options */}
          {scheduleType === 'once' && (
            <Input
              type="datetime-local"
              value={scheduledFor}
              onChange={e => setScheduledFor(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid}>
            {schedule ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
