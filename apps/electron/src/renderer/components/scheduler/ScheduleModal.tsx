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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PresetGrid,
  generateCronFromPreset,
  detectPresetFromCron,
  type PresetType,
} from './PresetCard'
import { TimePicker } from './TimePicker'
import { CronBuilder } from './CronBuilder'
import type { Schedule, ScheduleFormData } from '../../../shared/types'

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

interface ScheduleModalProps {
  schedule?: Schedule
  onSave: (data: ScheduleFormData) => void
  onClose: () => void
}

export function ScheduleModal({ schedule, onSave, onClose }: ScheduleModalProps) {
  // Parse existing schedule to get initial state
  const initialState = useMemo(() => {
    if (schedule?.cron) {
      return detectPresetFromCron(schedule.cron)
    }
    return { preset: 'daily' as PresetType, hour: 9, minute: 0 }
  }, [schedule])

  const [name, setName] = useState(schedule?.name || '')
  const [prompt, setPrompt] = useState(schedule?.prompt || '')
  const [scheduleType, setScheduleType] = useState<'recurring' | 'once'>(
    schedule?.cron ? 'recurring' : schedule?.scheduledFor ? 'once' : 'recurring'
  )

  // Preset and time state
  const [selectedPreset, setSelectedPreset] = useState<PresetType>(initialState.preset)
  const [hour, setHour] = useState(initialState.hour)
  const [minute, setMinute] = useState(initialState.minute)

  // Additional options for weekly/monthly
  const [dayOfWeek, setDayOfWeek] = useState(1) // Monday default
  const [dayOfMonth, setDayOfMonth] = useState(1)

  // Custom cron for CronBuilder
  const [customCron, setCustomCron] = useState(schedule?.cron || '0 9 * * *')

  // One-time schedule
  const [scheduledFor, setScheduledFor] = useState<string>(
    schedule?.scheduledFor
      ? new Date(schedule.scheduledFor * 1000).toISOString().slice(0, 16)
      : ''
  )

  // Generate the final cron expression
  const cronExpression = useMemo(() => {
    if (scheduleType !== 'recurring') return null

    if (selectedPreset === 'custom') {
      return customCron
    }

    return generateCronFromPreset(selectedPreset, hour, minute, {
      dayOfWeek,
      dayOfMonth,
    })
  }, [scheduleType, selectedPreset, hour, minute, dayOfWeek, dayOfMonth, customCron])

  // Validate cron
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

  // Get next runs preview
  const nextRuns = useMemo(() => {
    if (scheduleType !== 'recurring' || cronError || !cronExpression) return []
    try {
      const cron = new Cron(cronExpression)
      return cron.nextRuns(3)
    } catch {
      return []
    }
  }, [scheduleType, cronExpression, cronError])

  // Human-readable description
  const cronDescription = useMemo(() => {
    if (scheduleType !== 'recurring' || !cronExpression || cronError) return null
    try {
      return cronstrue.toString(cronExpression)
    } catch {
      return null
    }
  }, [scheduleType, cronExpression, cronError])

  const handleTimeChange = (newHour: number, newMinute: number) => {
    setHour(newHour)
    setMinute(newMinute)
  }

  const handlePresetSelect = (preset: PresetType) => {
    setSelectedPreset(preset)
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
            <div className="space-y-4">
              {/* Preset Grid */}
              <div className="space-y-2">
                <Label>Frequency</Label>
                <PresetGrid
                  selectedPreset={selectedPreset}
                  onSelect={handlePresetSelect}
                />
              </div>

              {/* Time Picker - show for all except hourly and custom */}
              {selectedPreset !== 'hourly' && selectedPreset !== 'custom' && (
                <div className="space-y-2">
                  <Label>Time</Label>
                  <TimePicker
                    hour={hour}
                    minute={minute}
                    onChange={handleTimeChange}
                  />
                </div>
              )}

              {/* Minute picker for hourly */}
              {selectedPreset === 'hourly' && (
                <div className="space-y-2">
                  <Label>At minute</Label>
                  <Select
                    value={minute.toString()}
                    onValueChange={v => setMinute(parseInt(v, 10))}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 15, 30, 45].map(m => (
                        <SelectItem key={m} value={m.toString()}>
                          :{m.toString().padStart(2, '0')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Day of week for weekly */}
              {selectedPreset === 'weekly' && (
                <div className="space-y-2">
                  <Label>Day</Label>
                  <Select
                    value={dayOfWeek.toString()}
                    onValueChange={v => setDayOfWeek(parseInt(v, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS_OF_WEEK.map(d => (
                        <SelectItem key={d.value} value={d.value.toString()}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Day of month for monthly */}
              {selectedPreset === 'monthly' && (
                <div className="space-y-2">
                  <Label>Day of month</Label>
                  <Select
                    value={dayOfMonth.toString()}
                    onValueChange={v => setDayOfMonth(parseInt(v, 10))}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                        <SelectItem key={d} value={d.toString()}>
                          {d}{getOrdinalSuffix(d)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Custom cron builder */}
              {selectedPreset === 'custom' && (
                <CronBuilder
                  value={customCron}
                  onChange={setCustomCron}
                />
              )}

              {/* Show cron description and error for non-custom presets */}
              {selectedPreset !== 'custom' && (
                <>
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
                </>
              )}
            </div>
          )}

          {/* One-time Options */}
          {scheduleType === 'once' && (
            <div className="space-y-2">
              <Label>Date and time</Label>
              <Input
                type="datetime-local"
                value={scheduledFor}
                onChange={e => setScheduledFor(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
              />
            </div>
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

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] || s[v] || s[0]
}
