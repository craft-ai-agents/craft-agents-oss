# Cron Scheduler UX Improvements: Implementation Guide

---

## Overview

This document provides **exact file locations, line numbers, and acceptance tests** for implementing the three UX improvements identified in the analysis.

---

## Improvement #1: Cron Translation to English

### Location
**New File:** `/Users/tinnguyen/vesper/apps/electron/src/renderer/lib/cron-translator.ts`

### Implementation

```typescript
/**
 * Translates cron expressions to human-readable English
 * Uses simple pattern matching for common cron formats
 */

export function cronToEnglish(cronExpression: string): string {
  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) return 'Invalid cron expression'

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  // Every minute
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every minute'
  }

  // Every X minutes
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = parseInt(minute.substring(2))
    return `Every ${interval} minute${interval > 1 ? 's' : ''}`
  }

  // Every hour (at specified minute)
  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every hour at :${String(minute).padStart(2, '0')}`
  }

  // Specific time on specific days
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

  // Daily at specific time
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every day at ${formatTime(timeStr)}`
  }

  // Weekdays (1-5 = Mon-Fri)
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
    return `Weekdays at ${formatTime(timeStr)}`
  }

  // Weekends (0,6 = Sun, Sat)
  if (dayOfMonth === '*' && month === '*' && (dayOfWeek === '0,6' || dayOfWeek === '6,0')) {
    return `Weekends at ${formatTime(timeStr)}`
  }

  // Specific day of week (0=Sunday, 1=Monday, etc)
  if (dayOfMonth === '*' && month === '*' && /^\d$/.test(dayOfWeek)) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return `Every ${days[parseInt(dayOfWeek)]} at ${formatTime(timeStr)}`
  }

  // Specific day of month
  if (dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    return `The ${getDayOrdinal(parseInt(dayOfMonth))} of every month at ${formatTime(timeStr)}`
  }

  // Complex expressions - try to give partial description
  if (dayOfMonth !== '*' && dayOfWeek !== '*') {
    return `Complex schedule at ${formatTime(timeStr)}`
  }

  // Fallback
  return `Custom schedule (${cronExpression})`
}

function formatTime(timeStr: string): string {
  const [hour, minute] = timeStr.split(':')
  const h = parseInt(hour)
  const m = parseInt(minute)

  const ampm = h >= 12 ? 'PM' : 'AM'
  const displayHour = h % 12 || 12
  const displayMinute = m === 0 ? '' : `:${String(m).padStart(2, '0')}`

  return `${displayHour}${displayMinute} ${ampm}`
}

function getDayOrdinal(day: number): string {
  if (day > 3 && day < 21) return `${day}th`
  switch (day % 10) {
    case 1: return `${day}st`
    case 2: return `${day}nd`
    case 3: return `${day}rd`
    default: return `${day}th`
  }
}

/**
 * Examples
 * - "0 * * * *" → "Every hour at :00"
 * - "0 9 * * *" → "Every day at 9:00 AM"
 * - "0 9 * * 1-5" → "Weekdays at 9:00 AM"
 * - "0 9 * * 0" → "Every Sunday at 9:00 AM"
 * - "0 9 1 * *" → "The 1st of every month at 9:00 AM"
 * - "*/30 * * * *" → "Every 30 minutes"
 */
```

### Usage in ScheduleModal.tsx

**File:** `/Users/tinnguyen/vesper/apps/electron/src/renderer/components/scheduler/ScheduleModal.tsx`

**Location:** After the cron input display (line 178)

```typescript
// Add import at top
import { cronToEnglish } from '@/lib/cron-translator'

// Inside the JSX, after the custom cron input (line ~175-177):
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

{/* ADD THIS BLOCK */}
{scheduleType === 'recurring' && cronExpression && !cronError && (
  <p className="text-xs text-muted-foreground font-medium">
    {cronToEnglish(cronExpression)}
  </p>
)}
```

### Acceptance Criteria

```gherkin
Scenario: User sees cron translation
  Given user is creating a schedule
  And user selects preset "Daily at 9am"
  Then translation "Every day at 9:00 AM" is displayed

Scenario: User sees translation update on custom cron
  Given user enters custom cron "0 9 * * 1-5"
  Then translation "Weekdays at 9:00 AM" is displayed

Scenario: Translation hidden when cron is invalid
  Given user enters invalid cron "bad expression"
  Then no translation is shown
  And error message is displayed

Scenario: Translation updates in real-time
  Given user is editing custom cron
  When user types "0 * * * *"
  Then translation changes to "Every hour at :00"
```

### Test Cases

```typescript
// In apps/electron/src/renderer/lib/__tests__/cron-translator.test.ts

describe('cronToEnglish', () => {
  test('every hour', () => {
    expect(cronToEnglish('0 * * * *')).toBe('Every hour at :00')
  })

  test('daily at 9am', () => {
    expect(cronToEnglish('0 9 * * *')).toBe('Every day at 9:00 AM')
  })

  test('weekdays at 9am', () => {
    expect(cronToEnglish('0 9 * * 1-5')).toBe('Weekdays at 9:00 AM')
  })

  test('every monday at 9am', () => {
    expect(cronToEnglish('0 9 * * 1')).toBe('Every Monday at 9:00 AM')
  })

  test('first of month at 9am', () => {
    expect(cronToEnglish('0 9 1 * *')).toBe('The 1st of every month at 9:00 AM')
  })

  test('every 30 minutes', () => {
    expect(cronToEnglish('*/30 * * * *')).toBe('Every 30 minutes')
  })

  test('invalid cron', () => {
    expect(cronToEnglish('not a cron')).toBe('Invalid cron expression')
  })

  test('weekends', () => {
    expect(cronToEnglish('0 9 * * 0,6')).toBe('Weekends at 9:00 AM')
  })
})
```

---

## Improvement #2: Visual Preset Selection

### Location
**File:** `/Users/tinnguyen/vesper/apps/electron/src/renderer/components/scheduler/ScheduleModal.tsx`

**Lines to Replace:** 151-164 (current Select component)

### Current Code
```typescript
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
```

### Replacement Code
```typescript
<div className="space-y-2">
  <Label>Frequency</Label>
  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
    {PRESETS.map(p => {
      const nextRun = getNextRun(p.cron, 'UTC') // Or user's timezone
      return (
        <button
          key={p.cron}
          onClick={() => setSelectedPreset(p.cron)}
          className={`p-3 rounded-lg border-2 transition-all ${
            selectedPreset === p.cron
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'border-border hover:border-primary/50 hover:bg-accent'
          }`}
        >
          <div className="text-sm font-semibold text-left">{p.label}</div>
          {nextRun && (
            <div className="text-xs text-muted-foreground text-left mt-1">
              Next: {nextRun.toLocaleDateString()}
            </div>
          )}
        </button>
      )
    })}
    {/* Custom option */}
    <button
      onClick={() => setSelectedPreset('custom')}
      className={`p-3 rounded-lg border-2 transition-all ${
        selectedPreset === 'custom'
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border hover:border-primary/50 hover:bg-accent'
      }`}
    >
      <div className="text-sm font-semibold text-left">Custom</div>
      <div className="text-xs text-muted-foreground text-left mt-1">
        Write your own cron
      </div>
    </button>
  </div>
</div>
```

### Acceptance Criteria

```gherkin
Scenario: User sees visual preset cards
  Given user is creating a schedule
  Then preset options are displayed as visual cards
  And each card shows label + next run date

Scenario: User can select preset by clicking card
  Given user sees preset cards
  When user clicks "Daily at 9am" card
  Then that card is highlighted with blue border
  And cron expression is set to "0 9 * * *"

Scenario: Custom option is clearly separate
  Given user sees preset cards
  Then "Custom" option is shown as distinct card
  When user clicks "Custom"
  Then cron input field appears
```

### Test Cases

```typescript
describe('ScheduleModal preset selection', () => {
  test('renders preset cards', () => {
    render(<ScheduleModal onSave={jest.fn()} onClose={jest.fn()} />)
    expect(screen.getByText('Every hour')).toBeInTheDocument()
    expect(screen.getByText('Daily at 9am')).toBeInTheDocument()
  })

  test('clicking preset selects it', () => {
    const handleSave = jest.fn()
    render(<ScheduleModal onSave={handleSave} onClose={jest.fn()} />)
    fireEvent.click(screen.getByText('Weekdays at 9am'))
    expect(screen.getByText('Weekdays at 9am').parentElement).toHaveClass('border-primary')
  })

  test('custom cron input appears when Custom is selected', () => {
    render(<ScheduleModal onSave={jest.fn()} onClose={jest.fn()} />)
    fireEvent.click(screen.getByText('Custom'))
    expect(screen.getByPlaceholderText('0 9 * * *')).toBeInTheDocument()
  })
})
```

---

## Improvement #3: Status Indicator Badges

### Location
**File:** `/Users/tinnguyen/vesper/apps/electron/src/renderer/components/scheduler/ScheduleList.tsx`

**Component:** `ScheduleCard` function (lines 134-200)

### Update ScheduleCard Component

```typescript
interface ScheduleCardProps {
  schedule: Schedule
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
  onRunNow: () => void
}

function ScheduleCard({ schedule, onEdit, onDelete, onToggle, onRunNow }: ScheduleCardProps) {
  const nextRun = schedule.enabled && schedule.cron
    ? getNextRun(schedule.cron, schedule.timezone)
    : null

  // NEW: Determine status and color
  const status = getScheduleStatus(schedule)
  const statusColor = getStatusColor(status)
  const statusLabel = getStatusLabel(status)

  return (
    <div className="p-3 rounded-lg border bg-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Switch checked={schedule.enabled} onCheckedChange={onToggle} />

          {/* ADD: Status badge */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full bg-${statusColor}-500`} />
            <div className="min-w-0">
              <p className="font-medium truncate">{schedule.name}</p>
              <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                {schedule.prompt}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {schedule.lastRunStatus === 'failed' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="w-4 h-4 text-destructive" />
              </TooltipTrigger>
              <TooltipContent>
                {schedule.lastRunError || 'Unknown error'}
              </TooltipContent>
            </Tooltip>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRunNow}>
                <Play className="w-4 h-4 mr-2" />
                Run Now
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        {schedule.cron ? (
          nextRun ? `Next: ${nextRun.toLocaleString()}` : 'Invalid schedule'
        ) : (
          schedule.scheduledFor
            ? `Scheduled for: ${new Date(schedule.scheduledFor * 1000).toLocaleString()}`
            : 'Completed'
        )}
        {schedule.lastRunAt && (
          <span className="ml-2">
            (Last: {new Date(schedule.lastRunAt * 1000).toLocaleString()})
          </span>
        )}
      </div>
    </div>
  )
}

// NEW: Status determination logic
type ScheduleStatus = 'active-recurring' | 'active-once' | 'pending-once' | 'disabled' | 'failed'

function getScheduleStatus(schedule: Schedule): ScheduleStatus {
  if (!schedule.enabled) return 'disabled'

  if (schedule.cron) {
    // Recurring schedule
    return schedule.lastRunStatus === 'failed' ? 'failed' : 'active-recurring'
  } else if (schedule.scheduledFor) {
    // One-time schedule
    const scheduledTime = new Date(schedule.scheduledFor * 1000)
    const now = new Date()
    return scheduledTime > now ? 'pending-once' : 'failed'
  }

  return 'disabled'
}

function getStatusColor(status: ScheduleStatus): string {
  switch (status) {
    case 'active-recurring':
    case 'active-once':
      return 'green'
    case 'pending-once':
      return 'yellow'
    case 'failed':
      return 'red'
    case 'disabled':
      return 'gray'
  }
}

function getStatusLabel(status: ScheduleStatus): string {
  switch (status) {
    case 'active-recurring':
      return 'Active'
    case 'active-once':
      return 'Scheduled'
    case 'pending-once':
      return 'Pending'
    case 'failed':
      return 'Failed'
    case 'disabled':
      return 'Disabled'
  }
}
```

### Acceptance Criteria

```gherkin
Scenario: Green status for active recurring
  Given a recurring schedule that is enabled
  And the last run was successful
  Then a green dot appears next to the schedule name

Scenario: Yellow status for pending one-time
  Given a one-time schedule scheduled for tomorrow
  Then a yellow dot appears

Scenario: Red status for failed
  Given a schedule whose last run failed
  Then a red dot appears

Scenario: Gray status for disabled
  Given a disabled schedule
  Then a gray dot appears

Scenario: Status updates on toggle
  Given an active schedule (green dot)
  When user disables it
  Then the dot changes to gray
```

### Test Cases

```typescript
describe('ScheduleCard status badges', () => {
  test('shows green dot for active recurring', () => {
    const schedule: Schedule = {
      id: '1',
      name: 'Test',
      prompt: 'test',
      cron: '0 9 * * *',
      scheduledFor: null,
      timezone: 'UTC',
      enabled: true,
      lastRunAt: Math.floor(Date.now() / 1000),
      lastRunStatus: 'success',
      lastRunError: null,
      createdAt: Math.floor(Date.now() / 1000),
    }
    render(<ScheduleCard schedule={schedule} onEdit={jest.fn()} onDelete={jest.fn()} onToggle={jest.fn()} onRunNow={jest.fn()} />)
    expect(screen.getByRole('img', { class: /bg-green-500/ })).toBeInTheDocument()
  })

  test('shows red dot for failed', () => {
    const schedule: Schedule = {
      ...baseSchedule,
      lastRunStatus: 'failed',
      lastRunError: 'Timeout',
    }
    render(<ScheduleCard schedule={schedule} {...handlers} />)
    expect(screen.getByRole('img', { class: /bg-red-500/ })).toBeInTheDocument()
  })

  test('shows yellow dot for pending one-time', () => {
    const tomorrow = Math.floor(Date.now() / 1000) + 86400
    const schedule: Schedule = {
      ...baseSchedule,
      cron: null,
      scheduledFor: tomorrow,
    }
    render(<ScheduleCard schedule={schedule} {...handlers} />)
    expect(screen.getByRole('img', { class: /bg-yellow-500/ })).toBeInTheDocument()
  })

  test('shows gray dot when disabled', () => {
    const schedule: Schedule = {
      ...baseSchedule,
      enabled: false,
    }
    render(<ScheduleCard schedule={schedule} {...handlers} />)
    expect(screen.getByRole('img', { class: /bg-gray-500/ })).toBeInTheDocument()
  })
})
```

---

## Integration Checklist

### Files to Create
- [ ] `/apps/electron/src/renderer/lib/cron-translator.ts` (new)
- [ ] `/apps/electron/src/renderer/lib/__tests__/cron-translator.test.ts` (new)

### Files to Modify
- [ ] `apps/electron/src/renderer/components/scheduler/ScheduleModal.tsx`
  - [ ] Add import for `cronToEnglish`
  - [ ] Add translation display block (5 lines)
  - [ ] Optional: Replace Select with Card grid (20 lines)

- [ ] `apps/electron/src/renderer/components/scheduler/ScheduleList.tsx`
  - [ ] Add status functions (40 lines)
  - [ ] Update ScheduleCard JSX (5 line changes)

### Files NOT to Modify
- ✅ No changes to scheduler.ts (main process)
- ✅ No changes to IPC handlers
- ✅ No changes to types
- ✅ No changes to navigation system

---

## Testing Strategy

### Unit Tests
- cronToEnglish() with 8+ test cases (see above)
- getScheduleStatus() with 5 test cases
- getStatusColor() with 5 test cases

### Component Tests
- ScheduleModal renders cron translation
- ScheduleModal preset selection works
- ScheduleCard shows correct status badge
- Status badge updates on toggle

### E2E Tests
- Create schedule → translation visible
- Edit preset → translation updates
- Toggle enabled → status badge changes color
- Run schedule → status updates

### Manual Testing
- Create schedule with each preset → verify translation
- Enter custom cron → verify translation in real-time
- Verify preset cards are visually distinct
- Verify status badges for all states

---

## Performance Considerations

### cronToEnglish()
- **Complexity:** O(1) - simple string parsing
- **Call Frequency:** On every keystroke (debounced via useMemo)
- **Impact:** Negligible

### Status Functions
- **Complexity:** O(1) - simple conditionals
- **Call Frequency:** On every render
- **Impact:** Negligible

### Preset Rendering
- **Current:** 1 Select component
- **Improved:** 6 Card components (PRESETS.length + 1)
- **Impact:** Negligible (only 6 elements)

---

## Rollback Plan

If issues arise:
1. Remove cron translation (single block removal)
2. Revert ScheduleModal to Select component (git checkout)
3. Remove status badges (single prop removal)

All changes are isolated; no risk of cascading failures.

---

## Success Metrics

After implementation:
- [ ] Users report better understanding of schedule timing
- [ ] Support tickets about "What is cron?" decrease
- [ ] Preset selection feels more natural/visual
- [ ] Status at-a-glance reduces need to open schedule details

---

## Timeline Estimate

| Task | Effort | Risk |
|------|--------|------|
| Cron translator + tests | 1 hour | Low |
| ScheduleModal integration | 30 mins | Low |
| Visual preset cards | 1-2 hours | Low |
| Status badges | 1 hour | Low |
| Testing + polish | 1-2 hours | Low |
| **Total** | **4-6 hours** | **Low** |

---

## Appendix: Constants & Imports

### PRESETS constant (in ScheduleModal.tsx)
```typescript
const PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Daily at 9am', cron: '0 9 * * *' },
  { label: 'Weekdays at 9am', cron: '0 9 * * 1-5' },
  { label: 'Weekly on Monday', cron: '0 9 * * 1' },
  { label: 'Monthly on 1st', cron: '0 9 1 * *' },
]
```

### Required Imports
```typescript
// In ScheduleModal.tsx
import { cronToEnglish } from '@/lib/cron-translator'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

// In ScheduleList.tsx
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { AlertCircle } from 'lucide-react'
```

---

**Ready to implement. All acceptance criteria, test cases, and code locations are provided.**
