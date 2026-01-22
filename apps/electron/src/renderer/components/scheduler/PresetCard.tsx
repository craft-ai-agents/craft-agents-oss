import { Clock, Sun, Briefcase, Calendar, CalendarDays, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

export type PresetType = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom'

export interface PresetConfig {
  id: PresetType
  icon: React.ReactNode
  label: string
  description: string
}

export const SCHEDULE_PRESETS: PresetConfig[] = [
  { id: 'hourly', icon: <Clock className="w-5 h-5" />, label: 'Hourly', description: 'Every hour' },
  { id: 'daily', icon: <Sun className="w-5 h-5" />, label: 'Daily', description: 'Every day' },
  { id: 'weekdays', icon: <Briefcase className="w-5 h-5" />, label: 'Weekdays', description: 'Mon-Fri' },
  { id: 'weekly', icon: <Calendar className="w-5 h-5" />, label: 'Weekly', description: 'Once a week' },
  { id: 'monthly', icon: <CalendarDays className="w-5 h-5" />, label: 'Monthly', description: 'Once a month' },
  { id: 'custom', icon: <Settings className="w-5 h-5" />, label: 'Custom', description: 'Advanced options' },
]

// Generate cron from preset type and time
export function generateCronFromPreset(
  preset: PresetType,
  hour: number,
  minute: number,
  options?: {
    dayOfWeek?: number // For weekly: 0-6 (Sun=0, Mon=1, etc.)
    dayOfMonth?: number // For monthly: 1-31
  }
): string {
  const { dayOfWeek = 1, dayOfMonth = 1 } = options || {}

  switch (preset) {
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`
    case 'weekly':
      return `${minute} ${hour} * * ${dayOfWeek}`
    case 'monthly':
      return `${minute} ${hour} ${dayOfMonth} * *`
    case 'custom':
      return `${minute} ${hour} * * *` // Default for custom
    default:
      return `${minute} ${hour} * * *`
  }
}

// Parse cron to determine preset type
export function detectPresetFromCron(cron: string): { preset: PresetType; hour: number; minute: number } {
  const parts = cron.split(' ')
  if (parts.length !== 5) {
    return { preset: 'daily', hour: 9, minute: 0 }
  }

  const [minuteStr, hourStr, dayOfMonth, , dayOfWeek] = parts
  const minute = parseInt(minuteStr, 10) || 0
  const hour = hourStr === '*' ? 0 : parseInt(hourStr, 10) || 9

  // Detect preset type
  if (hourStr === '*') {
    return { preset: 'hourly', hour: 0, minute }
  }
  if (dayOfWeek === '1-5') {
    return { preset: 'weekdays', hour, minute }
  }
  if (dayOfWeek !== '*' && dayOfMonth === '*') {
    return { preset: 'weekly', hour, minute }
  }
  if (dayOfMonth !== '*') {
    return { preset: 'monthly', hour, minute }
  }
  return { preset: 'daily', hour, minute }
}

interface PresetCardProps {
  preset: PresetConfig
  selected: boolean
  onClick: () => void
}

export function PresetCard({ preset, selected, onClick }: PresetCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1 p-3 rounded-lg border transition-all',
        'hover:border-primary/50 hover:bg-accent/50',
        selected
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-card text-muted-foreground'
      )}
    >
      {preset.icon}
      <span className="text-xs font-medium text-center leading-tight">
        {preset.label}
      </span>
      <span className="text-[10px] text-muted-foreground/70">
        {preset.description}
      </span>
    </button>
  )
}

interface PresetGridProps {
  selectedPreset: PresetType
  onSelect: (preset: PresetType) => void
}

export function PresetGrid({ selectedPreset, onSelect }: PresetGridProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {SCHEDULE_PRESETS.map(preset => (
        <PresetCard
          key={preset.id}
          preset={preset}
          selected={preset.id === selectedPreset}
          onClick={() => onSelect(preset.id)}
        />
      ))}
    </div>
  )
}
