import { Clock, Sun, Briefcase, Calendar, CalendarDays, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Preset {
  id: string
  icon: React.ReactNode
  label: string
  cron: string | null
}

export const SCHEDULE_PRESETS: Preset[] = [
  { id: 'hourly', icon: <Clock className="w-5 h-5" />, label: 'Every hour', cron: '0 * * * *' },
  { id: 'daily', icon: <Sun className="w-5 h-5" />, label: 'Daily at 9am', cron: '0 9 * * *' },
  { id: 'weekdays', icon: <Briefcase className="w-5 h-5" />, label: 'Weekdays at 9am', cron: '0 9 * * 1-5' },
  { id: 'weekly', icon: <Calendar className="w-5 h-5" />, label: 'Weekly Monday', cron: '0 9 * * 1' },
  { id: 'monthly', icon: <CalendarDays className="w-5 h-5" />, label: 'Monthly 1st', cron: '0 9 1 * *' },
  { id: 'custom', icon: <Settings className="w-5 h-5" />, label: 'Custom', cron: null },
]

interface PresetCardProps {
  preset: Preset
  selected: boolean
  onClick: () => void
}

export function PresetCard({ preset, selected, onClick }: PresetCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-2 p-3 rounded-lg border transition-all',
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
    </button>
  )
}

interface PresetGridProps {
  selectedCron: string | null
  isCustom: boolean
  onSelect: (preset: Preset) => void
}

export function PresetGrid({ selectedCron, isCustom, onSelect }: PresetGridProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {SCHEDULE_PRESETS.map(preset => (
        <PresetCard
          key={preset.id}
          preset={preset}
          selected={
            preset.id === 'custom'
              ? isCustom
              : preset.cron === selectedCron && !isCustom
          }
          onClick={() => onSelect(preset)}
        />
      ))}
    </div>
  )
}
