import { useState, useEffect } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { TimePicker } from './TimePicker'
import { cn } from '@/lib/utils'
import cronstrue from 'cronstrue'

type Frequency = 'hourly' | 'daily' | 'weekly' | 'monthly'

const DAYS_OF_WEEK = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1)

interface CronBuilderProps {
  value: string
  onChange: (cron: string) => void
  className?: string
}

interface CronState {
  frequency: Frequency
  hour: number
  minute: number
  daysOfWeek: number[] // For weekly: 0-6 (Sun-Sat)
  dayOfMonth: number // For monthly: 1-31
}

function parseCronToState(cron: string): CronState {
  const parts = cron.split(' ')
  if (parts.length !== 5) {
    return { frequency: 'daily', hour: 9, minute: 0, daysOfWeek: [1], dayOfMonth: 1 }
  }

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts

  // Determine frequency
  let frequency: Frequency = 'daily'
  let daysOfWeek: number[] = [1]
  let dom = 1

  if (minute === '0' && hour === '*') {
    frequency = 'hourly'
  } else if (dayOfWeek !== '*') {
    frequency = 'weekly'
    // Parse days of week (could be "1", "1,3,5", "1-5", etc.)
    if (dayOfWeek.includes(',')) {
      daysOfWeek = dayOfWeek.split(',').map(d => parseInt(d, 10))
    } else if (dayOfWeek.includes('-')) {
      const [start, end] = dayOfWeek.split('-').map(d => parseInt(d, 10))
      daysOfWeek = Array.from({ length: end - start + 1 }, (_, i) => start + i)
    } else {
      daysOfWeek = [parseInt(dayOfWeek, 10)]
    }
  } else if (dayOfMonth !== '*') {
    frequency = 'monthly'
    dom = parseInt(dayOfMonth, 10) || 1
  }

  return {
    frequency,
    hour: hour === '*' ? 9 : parseInt(hour, 10),
    minute: parseInt(minute, 10) || 0,
    daysOfWeek,
    dayOfMonth: dom,
  }
}

function stateToCron(state: CronState): string {
  const { frequency, hour, minute, daysOfWeek, dayOfMonth } = state

  switch (frequency) {
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly': {
      const days = daysOfWeek.sort((a, b) => a - b).join(',')
      return `${minute} ${hour} * * ${days}`
    }
    case 'monthly':
      return `${minute} ${hour} ${dayOfMonth} * *`
    default:
      return `${minute} ${hour} * * *`
  }
}

export function CronBuilder({ value, onChange, className }: CronBuilderProps) {
  const [state, setState] = useState<CronState>(() => parseCronToState(value))
  const [showRawCron, setShowRawCron] = useState(false)

  // Update parent when state changes
  useEffect(() => {
    const newCron = stateToCron(state)
    if (newCron !== value) {
      onChange(newCron)
    }
  }, [state, onChange, value])

  // Sync state if value changes externally
  useEffect(() => {
    const currentCron = stateToCron(state)
    if (value && value !== currentCron) {
      setState(parseCronToState(value))
    }
  }, [value])

  const handleFrequencyChange = (freq: string) => {
    setState(prev => ({ ...prev, frequency: freq as Frequency }))
  }

  const handleTimeChange = (hour: number, minute: number) => {
    setState(prev => ({ ...prev, hour, minute }))
  }

  const handleDayOfWeekToggle = (day: number) => {
    setState(prev => {
      const current = prev.daysOfWeek
      if (current.includes(day)) {
        // Don't allow removing the last day
        if (current.length === 1) return prev
        return { ...prev, daysOfWeek: current.filter(d => d !== day) }
      } else {
        return { ...prev, daysOfWeek: [...current, day] }
      }
    })
  }

  const handleDayOfMonthChange = (value: string) => {
    setState(prev => ({ ...prev, dayOfMonth: parseInt(value, 10) }))
  }

  const handleRawCronChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value)
  }

  // Get human-readable description
  let cronDescription = ''
  try {
    cronDescription = cronstrue.toString(stateToCron(state))
  } catch {
    cronDescription = ''
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Frequency selector */}
      <div className="space-y-2">
        <Label>Repeat</Label>
        <Select value={state.frequency} onValueChange={handleFrequencyChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hourly">Every hour</SelectItem>
            <SelectItem value="daily">Every day</SelectItem>
            <SelectItem value="weekly">Every week</SelectItem>
            <SelectItem value="monthly">Every month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Time picker (not shown for hourly) */}
      {state.frequency !== 'hourly' && (
        <div className="space-y-2">
          <Label>At</Label>
          <TimePicker
            hour={state.hour}
            minute={state.minute}
            onChange={handleTimeChange}
          />
        </div>
      )}

      {/* Minute picker for hourly */}
      {state.frequency === 'hourly' && (
        <div className="space-y-2">
          <Label>At minute</Label>
          <Select
            value={state.minute.toString()}
            onValueChange={v => setState(prev => ({ ...prev, minute: parseInt(v, 10) }))}
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

      {/* Day of week selector for weekly */}
      {state.frequency === 'weekly' && (
        <div className="space-y-2">
          <Label>On</Label>
          <div className="flex flex-wrap gap-1">
            {DAYS_OF_WEEK.map(day => (
              <button
                key={day.value}
                type="button"
                onClick={() => handleDayOfWeekToggle(day.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                  state.daysOfWeek.includes(day.value)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-accent'
                )}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Day of month selector for monthly */}
      {state.frequency === 'monthly' && (
        <div className="space-y-2">
          <Label>On day</Label>
          <Select value={state.dayOfMonth.toString()} onValueChange={handleDayOfMonthChange}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS_OF_MONTH.map(d => (
                <SelectItem key={d} value={d.toString()}>
                  {d}{getOrdinalSuffix(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Human-readable description */}
      {cronDescription && (
        <p className="text-sm text-muted-foreground">{cronDescription}</p>
      )}

      {/* Toggle for raw cron input */}
      <div className="pt-2 border-t">
        <button
          type="button"
          onClick={() => setShowRawCron(!showRawCron)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showRawCron ? 'Hide' : 'Show'} cron expression
        </button>
        {showRawCron && (
          <Input
            value={value}
            onChange={handleRawCronChange}
            placeholder="0 9 * * *"
            className="mt-2 font-mono text-sm"
          />
        )}
      </div>
    </div>
  )
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] || s[v] || s[0]
}
