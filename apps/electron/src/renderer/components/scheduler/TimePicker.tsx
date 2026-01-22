import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface TimePickerProps {
  hour: number // 0-23
  minute: number // 0-59
  onChange: (hour: number, minute: number) => void
  className?: string
}

// Generate hour options for 12-hour format
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i === 0 ? 12 : i)

// Generate minute options (0, 15, 30, 45 for simplicity, or all 60)
const MINUTES = [0, 15, 30, 45]

function formatHour12(hour: number): { hour12: number; period: 'AM' | 'PM' } {
  const period = hour >= 12 ? 'PM' : 'AM'
  let hour12 = hour % 12
  if (hour12 === 0) hour12 = 12
  return { hour12, period }
}

function toHour24(hour12: number, period: 'AM' | 'PM'): number {
  if (period === 'AM') {
    return hour12 === 12 ? 0 : hour12
  } else {
    return hour12 === 12 ? 12 : hour12 + 12
  }
}

export function TimePicker({ hour, minute, onChange, className }: TimePickerProps) {
  const { hour12, period } = formatHour12(hour)

  const handleHourChange = (value: string) => {
    const newHour12 = parseInt(value, 10)
    const newHour24 = toHour24(newHour12, period)
    onChange(newHour24, minute)
  }

  const handleMinuteChange = (value: string) => {
    const newMinute = parseInt(value, 10)
    onChange(hour, newMinute)
  }

  const handlePeriodChange = (value: string) => {
    const newPeriod = value as 'AM' | 'PM'
    const newHour24 = toHour24(hour12, newPeriod)
    onChange(newHour24, minute)
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Hour */}
      <Select value={hour12.toString()} onValueChange={handleHourChange}>
        <SelectTrigger className="w-[70px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HOURS_12.map(h => (
            <SelectItem key={h} value={h.toString()}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-muted-foreground">:</span>

      {/* Minute */}
      <Select value={minute.toString()} onValueChange={handleMinuteChange}>
        <SelectTrigger className="w-[70px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MINUTES.map(m => (
            <SelectItem key={m} value={m.toString()}>
              {m.toString().padStart(2, '0')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* AM/PM */}
      <Select value={period} onValueChange={handlePeriodChange}>
        <SelectTrigger className="w-[70px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

// Compact inline time display with click to edit
interface TimeDisplayProps {
  hour: number
  minute: number
  className?: string
}

export function TimeDisplay({ hour, minute, className }: TimeDisplayProps) {
  const { hour12, period } = formatHour12(hour)
  return (
    <span className={cn('text-xs text-muted-foreground', className)}>
      {hour12}:{minute.toString().padStart(2, '0')} {period}
    </span>
  )
}
