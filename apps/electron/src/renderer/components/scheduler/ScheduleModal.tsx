import { useState, useMemo } from 'react'
import { Cron } from 'croner'
import cronstrue from 'cronstrue'
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
import { PresetGrid, SCHEDULE_PRESETS, type Preset } from './PresetCard'
import type { Schedule, ScheduleFormData } from '../../../shared/types'

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
  const [selectedCron, setSelectedCron] = useState<string | null>(
    schedule?.cron || SCHEDULE_PRESETS[1].cron
  )
  const [isCustom, setIsCustom] = useState(
    schedule?.cron ? !SCHEDULE_PRESETS.find(p => p.cron === schedule.cron) : false
  )
  const [customCron, setCustomCron] = useState(schedule?.cron || '')
  const [scheduledFor, setScheduledFor] = useState<string>(
    schedule?.scheduledFor
      ? new Date(schedule.scheduledFor * 1000).toISOString().slice(0, 16)
      : ''
  )

  const cronExpression = isCustom ? customCron : selectedCron

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
    if (scheduleType !== 'recurring' || cronError || !cronExpression) return []
    try {
      const cron = new Cron(cronExpression)
      return cron.nextRuns(3)
    } catch {
      return []
    }
  }, [scheduleType, cronExpression, cronError])

  const cronDescription = useMemo(() => {
    if (scheduleType !== 'recurring' || !cronExpression || cronError) return null
    try {
      return cronstrue.toString(cronExpression)
    } catch {
      return null
    }
  }, [scheduleType, cronExpression, cronError])

  function handlePresetSelect(preset: Preset) {
    if (preset.cron === null) {
      setIsCustom(true)
    } else {
      setIsCustom(false)
      setSelectedCron(preset.cron)
    }
  }

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
              <PresetGrid
                selectedCron={selectedCron}
                isCustom={isCustom}
                onSelect={handlePresetSelect}
              />

              {isCustom && (
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

              {cronDescription && (
                <p className="text-sm text-muted-foreground">
                  {cronDescription}
                </p>
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
