# feat: Scheduler UX Improvements

## Overview

Improve the cron scheduler modal UX to make creating agent task prompts, picking times, and selecting presets simpler and more visually engaging. Add natural language scheduling from any agent chat session.

## Acceptance Criteria

- [x] Add human-readable cron translation below custom cron input (e.g., "0 9 * * 1-5" → "Every weekday at 9:00 AM")
- [x] Replace preset dropdown with visual preset cards showing icon, label, and next run time
- [x] Add status badges to schedule cards (green=success, yellow=running, red=failed)
- [x] Parse natural language scheduling commands in chat (e.g., "schedule this to run daily at 9am")
- [x] Create scheduled task from chat message context with extracted prompt
- [x] Add TimePicker component for selecting custom time (hour:minute AM/PM)
- [x] Add visual CronBuilder for custom schedules (no raw cron syntax needed)
- [x] Add day-of-week selector for weekly schedules
- [x] Add day-of-month selector for monthly schedules

## Context

### Current Implementation

**Key Files:**
- `apps/electron/src/renderer/components/scheduler/ScheduleModal.tsx` - Modal with 5 presets dropdown, cron input, datetime-local picker
- `apps/electron/src/renderer/components/scheduler/ScheduleList.tsx` - Schedule cards with toggle, menu actions
- `apps/electron/src/main/scheduler.ts` - Backend service using Croner library
- `apps/electron/src/shared/types.ts:499-986` - Schedule types

**Current Presets (dropdown):**
- "Every hour" → `0 * * * *`
- "Daily at 9am" → `0 9 * * *`
- "Weekdays at 9am" → `0 9 * * 1-5`
- "Weekly on Monday" → `0 9 * * 1`
- "Monthly on 1st" → `0 9 1 * *`

### Research Insights

- **Fantastical** achieves 92% accuracy with natural language parsing
- **shadcn/ui** ecosystem provides excellent date picker components
- Modern apps show human-readable translations of cron expressions
- Visual preset cards are more engaging than dropdowns

## MVP

### 1. Cron Translation Helper

Add `cronstrue` library for human-readable cron descriptions.

```typescript
// apps/electron/src/renderer/components/scheduler/ScheduleModal.tsx
import cronstrue from 'cronstrue';

// In the custom cron input section, add translation display:
{cronExpression && isValidCron && (
  <p className="text-xs text-muted-foreground mt-1">
    {cronstrue.toString(cronExpression)}
  </p>
)}
```

### 2. Visual Preset Cards

Replace dropdown with a grid of clickable preset cards.

```tsx
// apps/electron/src/renderer/components/scheduler/PresetCard.tsx
interface PresetCardProps {
  icon: React.ReactNode;
  label: string;
  cron: string;
  selected: boolean;
  onClick: () => void;
}

const PRESETS = [
  { icon: <Clock />, label: 'Every hour', cron: '0 * * * *' },
  { icon: <Sun />, label: 'Daily at 9am', cron: '0 9 * * *' },
  { icon: <Briefcase />, label: 'Weekdays', cron: '0 9 * * 1-5' },
  { icon: <Calendar />, label: 'Weekly Monday', cron: '0 9 * * 1' },
  { icon: <CalendarDays />, label: 'Monthly 1st', cron: '0 9 1 * *' },
  { icon: <Settings />, label: 'Custom...', cron: null },
];

// Render as 2x3 grid with selection state
```

### 3. Status Badges

Add colored status indicators to schedule cards.

```tsx
// apps/electron/src/renderer/components/scheduler/ScheduleList.tsx
const StatusBadge = ({ status }: { status: Schedule['lastRunStatus'] }) => {
  const colors = {
    success: 'bg-green-500',
    failed: 'bg-red-500',
    running: 'bg-yellow-500',
    null: 'bg-gray-400',
  };
  return <span className={`w-2 h-2 rounded-full ${colors[status ?? 'null']}`} />;
};
```

### 4. Natural Language Chat Integration

Parse scheduling intent from chat messages using pattern matching + Claude extraction.

```typescript
// apps/electron/src/renderer/hooks/useScheduleFromChat.ts

const SCHEDULE_PATTERNS = [
  /schedule\s+this\s+(?:to\s+)?run\s+(.+)/i,
  /run\s+this\s+(.+)/i,
  /remind\s+me\s+(.+)/i,
];

// When pattern detected in user message:
// 1. Extract the time expression (e.g., "daily at 9am", "every monday")
// 2. Use Claude to parse into cron expression
// 3. Show confirmation toast: "Schedule created: Daily at 9:00 AM"
// 4. Create schedule with current conversation context as prompt
```

**Chat Integration Flow:**
1. User types: "schedule this to run every weekday at 9am"
2. Hook detects scheduling intent
3. Claude parses "every weekday at 9am" → `0 9 * * 1-5`
4. System creates schedule with conversation summary as prompt
5. Toast confirms: "Scheduled: Every weekday at 9:00 AM"

## References

- Current modal: `apps/electron/src/renderer/components/scheduler/ScheduleModal.tsx:1-212`
- Schedule types: `apps/electron/src/shared/types.ts:499-530`
- Croner library (existing): Used for cron validation and next-run calculation
- [cronstrue](https://www.npmjs.com/package/cronstrue) - Cron to human-readable
- [Fantastical NLP](https://flexibits.com/fantastical) - Gold standard for natural language scheduling
