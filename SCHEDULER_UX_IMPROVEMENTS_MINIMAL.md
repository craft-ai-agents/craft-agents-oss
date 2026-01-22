# Cron Scheduler UX Improvements: Quick Reference

**Status:** Ready for Implementation
**Effort:** 4-6 hours
**Risk Level:** Low

---

## Three Quick Wins for v1.1

### 1. Cron Translation to English ⭐ HIGHEST PRIORITY
**What:** "0 9 * * 1-5" → "Every weekday at 9:00 AM"
**Why:** Makes cron expressions human-readable, reduces fear of technical syntax
**Effort:** 1-2 hours
**Risk:** None
**Files:**
- Add helper to `apps/electron/src/renderer/lib/cron.ts`
- Update `ScheduleModal.tsx` (add 5 lines after cron input)

**Implementation:**
```typescript
// New file: lib/cron.ts
export function cronToEnglish(cron: string): string {
  // Use croner + simple templates
  // Examples:
  // "0 9 * * *" → "Every day at 9:00 AM"
  // "0 9 * * 1-5" → "Every weekday at 9:00 AM"
  // "0 0 * * 0" → "Every Sunday at 12:00 AM"
  // "*/30 * * * *" → "Every 30 minutes"
}

// In ScheduleModal.tsx, after cron input:
{scheduleType === 'recurring' && cronExpression && !cronError && (
  <p className="text-xs text-muted-foreground font-medium">
    {cronToEnglish(cronExpression)}
  </p>
)}
```

---

### 2. Visual Preset Selection ⭐ HIGH PRIORITY
**What:** Replace dropdown with visual preset cards
**Why:** Fantastical/Motion UX standard, more engaging than select
**Effort:** 2-3 hours
**Risk:** Low

**Current Code:**
```typescript
// In ScheduleModal.tsx line 151-164
<Select value={selectedPreset} onValueChange={setSelectedPreset}>
  {PRESETS.map(p => (
    <SelectItem key={p.cron} value={p.cron}>{p.label}</SelectItem>
  ))}
  <SelectItem value="custom">Custom cron...</SelectItem>
</Select>
```

**Replacement:**
```typescript
// Visual cards instead of select
<div className="grid grid-cols-2 gap-2 md:grid-cols-3">
  {PRESETS.map(p => (
    <button
      key={p.cron}
      onClick={() => setSelectedPreset(p.cron)}
      className={`p-3 rounded-lg border-2 transition ${
        selectedPreset === p.cron
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50'
      }`}
    >
      <div className="text-sm font-medium">{p.label}</div>
      <div className="text-xs text-muted-foreground mt-1">
        Next: {getNextRun(p.cron, timezone)?.toLocaleDateString()}
      </div>
    </button>
  ))}
  <button
    onClick={() => setSelectedPreset('custom')}
    className={...}
  >
    <div className="text-sm font-medium">Custom</div>
    <div className="text-xs text-muted-foreground">Your cron expression</div>
  </button>
</div>
```

---

### 3. Status Indicator Badges ⭐ NICE-TO-HAVE
**What:** Color-coded dots showing schedule state
**Why:** Quick visual scanning of list (green=active, yellow=pending, red=failed)
**Effort:** 1 hour
**Risk:** None

**In ScheduleCard.tsx:**
```typescript
function getStatusColor(schedule: Schedule) {
  if (!schedule.enabled) return 'gray'      // Disabled
  if (schedule.cron && !schedule.lastRunAt) return 'green'    // Active recurring, never run
  if (schedule.cron && schedule.lastRunStatus === 'success') return 'green'  // Active recurring, last success
  if (schedule.scheduledFor && new Date(schedule.scheduledFor * 1000) > new Date()) return 'yellow'  // Pending one-time
  if (schedule.lastRunStatus === 'failed') return 'red'  // Last run failed
  return 'gray'
}

// Render near schedule name
<div className={`w-2 h-2 rounded-full bg-${getStatusColor(schedule)}-500`} />
```

---

## Edge Cases & Handling

| Issue | Status | Handling |
|-------|--------|----------|
| Cron during execution | ✅ Handled | Sequential queue prevents overlap |
| App restart mid-run | ⚠️ Acceptable | Session executes, marks failed if app crashes |
| Timezone change | ⚠️ Minor | Show timezone in schedule card |
| Invalid JSON | ✅ Handled | Service logs error, skips schedule |
| Delete while running | ⚠️ Minor race | Rare, acceptable |

---

## Natural Language Scheduling (v2, Skip for Now)

**Why Not v1.1?**
- Requires Claude integration
- Needs error handling & fallback
- Can validate demand in v2
- Exceeds "minimal" scope

**How It Would Work (reference only):**
```
User: "Schedule my standup at 9am weekdays"
  ↓ [Claude parses]
  ↓ { name: "standup", cron: "0 9 * * 1-5" }
  ↓
Modal pre-fills with parsed values
  ↓
User confirms or adjusts
```

**Decision:** Defer to v2 after gathering user feedback.

---

## Chat Integration (Optional, Low Priority)

**Right-Click Message → Schedule (30 mins)**
```typescript
// In ChatMessage component
<ContextMenu>
  <ContextMenuTrigger>
    <MessageContent />
  </ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem onClick={() => scheduleMessage(message)}>
      📅 Schedule as Task
    </ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>

const scheduleMessage = (msg: Message) => {
  // Create with message as prompt, default cron, show modal
  navigate(routes.action.newSchedule({
    initialPrompt: msg.content,
    initialName: msg.content.slice(0, 30)
  }))
}
```

**For v1.1:** Low priority, can add in v1.2.

---

## Implementation Order

### Week 1 (Sprint)
- [ ] Add `cronToEnglish()` helper
- [ ] Update ScheduleModal to show translation
- [ ] Add status badges to ScheduleCard
- **Effort:** 4-6 hours
- **Review & test:** 1-2 hours

### Week 2+ (Backlog)
- [ ] Visual preset cards
- [ ] Right-click message context menu
- [ ] Calendar date picker for one-time
- [ ] Natural language (v2)

---

## Testing Checklist

- [ ] Create schedule with preset → English translation displays
- [ ] Edit preset → translation updates in real-time
- [ ] Create schedule with custom cron → translation displays
- [ ] Invalid cron → no translation shown, error displays
- [ ] Check schedule status badges:
  - [ ] Green for active recurring
  - [ ] Yellow for pending one-time
  - [ ] Gray for disabled
  - [ ] Red for failed
- [ ] Disable schedule → badge changes to gray
- [ ] Run Now → status updates in list

---

## Files to Modify

### Required (for 3 quick wins)
1. `apps/electron/src/renderer/components/scheduler/ScheduleModal.tsx`
   - Add cron translation display
   - Refactor preset selection (optional, can defer)

2. `apps/electron/src/renderer/components/scheduler/ScheduleList.tsx`
   - Add status badges to ScheduleCard

3. `apps/electron/src/renderer/lib/cron.ts` (NEW)
   - `cronToEnglish(cron: string): string`

### No Changes Needed
- Main process scheduler service
- IPC handlers
- Navigation system
- Storage system

---

## Success Metrics

- ✅ Users can understand what each schedule does at a glance
- ✅ No technical cron knowledge required to use presets
- ✅ Schedule status is visually obvious (enabled/disabled/failed)
- ✅ Error states are clearly indicated

---

## Known Limitations (Document in Help)

- Schedules only run when app is open
- One-time schedules automatically disable after execution
- Timezone is fixed at creation time (doesn't auto-update if system timezone changes)
- No schedule templates or history in v1

---

## Future Ideas (v2+)

- AI natural language parsing: "Run standup weekdays at 9am"
- Schedule templates: "Morning briefing", "Daily digest"
- Execution history: View past runs + results
- Integration with chat: Quick "schedule this prompt"
- Background execution: launchd on macOS
- Advanced recurrence: "Every 2 weeks", "Quarterly on 3rd Monday"

---

**Recommendation:** Implement the 3 quick wins in one sprint (4-6 hours), test thoroughly, then gather feedback before v2 roadmap.
