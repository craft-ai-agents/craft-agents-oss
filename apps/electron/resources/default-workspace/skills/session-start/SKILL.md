---
name: "Session Start"
description: "Quick catch-up brief for new sessions — surfaces priorities, pending items, calendar, and recent activity."
---

# Session Start Skill

Solves the "cold start" problem. Delivers a focused brief so the user is up to speed in seconds.

## When This Skill Applies

- Start of any new conversation
- "What should I focus on?"
- "Catch me up"
- `/session-start` or `/start`

## Briefing Process

### Step 0: Load Workspace Context

Read `workspace-context.md` first. This is the workspace's curated "brain" — key contacts, acronyms, active projects, and preferences. It gives you immediate context before any other tool calls.

If the file doesn't exist yet, skip this step and note it in the brief: suggest the user run `/workspace-context` to set it up.

### Step 1: Gather Context (parallel reads)

Read the following files to build the brief:

1. **Current priorities**: `goals/current.md` — focus on HIGH items
2. **Monthly tracker**: `goals/[current-month]-[current-year].md` (e.g., `goals/february-2026.md`) — check bets, decisions, action items
3. **Recent 1:1s**: Scan `people/*/1-1s/` for files from the last 3 days
4. **Session log**: Read `last-session.md` for the previous session's context
5. **Recent activity**: Read `activity-log.md` for entries from the last 3 days
6. **Calendar**: If a calendar source is active, fetch today's events using the user's timezone

### Step 2: Identify Alerts

Proactively flag:
- **Overdue items**: Action items past their due date
- **Monthly rollover**: If a new month started, check if the monthly tracker needs creation
- **Stale blockers**: Blockers that haven't been updated in >5 days
- **Upcoming meetings**: Meetings today that may need preparation

### Step 3: Deliver the Brief

Output format:

```markdown
## Morning Brief — [Date]

### Today's Calendar
- [Time] — [Event] (prep needed? Y/N)

### Active Priorities (HIGH)
- [Priority 1] — [status/latest]
- [Priority 2] — [status/latest]

### Pending Action Items
- [ ] [Item] — [owner] — [due date]
- [ ] [Item] — [owner] — [due date]

### Recent Activity (last 3 days)
- [Key decisions from activity-log.md]
- [Important insights or flags]
- [Significant actions taken]

### Alerts
- [Any overdue items, stale blockers, or items needing attention]

### Last Session Recap
- [Key points from last-session.md]
```

## Rules

1. **Be concise** — This is a quick brief, not a report. Keep it scannable.
2. **Prioritize ruthlessly** — Only surface what matters TODAY.
3. **Flag, don't solve** — Surface problems; let the user decide what to address.
4. **Dynamic month resolution** — Always compute the current month file dynamically, never hardcode a specific month.
5. **Dynamic people discovery** — Scan the `people/` directory to find direct reports; never hardcode names.
6. **Match the user's language** — Respond in the same language the user is using.
7. **Activity-log is critical** — Include recent decisions, insights, and flags from activity-log.md in the "Recent Activity" section.

## Integration with Other Skills

- **workspace-context**: Loaded as Step 0 — provides instant context (contacts, acronyms, projects, preferences)
- **activity-log**: Recent entries provide real-time context that may not be in session-log yet
- **session-checkpoint**: Last session recap comes from last-session.md (written by checkpoint)
- **quick-log**: Important items logged during sessions surface here automatically
