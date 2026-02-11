---
name: "Session Start"
description: "Quick catch-up brief for new sessions — surfaces priorities, pending items, calendar, and recent activity."
---

# Session Start Skill

Solves the "cold start" problem. Delivers a focused brief so the user is up to speed in seconds.

## File Location Convention

Two types of context, each in its own place:

**Global (workspace `~/.g4os/workspaces/{workspace}/`):**
- `workspace-context.md` — "Who I am": contacts, acronyms, preferences, recurring items

**Local (working directory):**
- `local-context.md` — "What's here": active projects, paths, project-specific notes
- `activity-log.md` — Recent activities and decisions
- `session-log.md` — Full session history
- `last-session.md` — Previous session summary (fast-load)

**Path rules:**
- Never hardcode absolute paths for working directory files
- Working directory = current session's working directory (dynamic)
- If a file doesn't exist, create it automatically (don't error)

## When This Skill Applies

- Start of any new conversation
- "What should I focus on?"
- "Catch me up"
- `/session-start` or `/start`

## Briefing Process

### Step 0: Get Current Date and Day of Week

**CRITICAL**: Always run bash to get the current date and day of week in the user's timezone before anything else:

```bash
date +"%A, %d %b %Y"
```

This ensures you never make mistakes with the day of the week in the brief header.

### Step 1: Load Context (parallel reads)

Read BOTH context files in parallel:

1. **Global context**: `workspace-context.md` from workspace (`~/.g4os/workspaces/{workspace}/workspace-context.md`)
2. **Local context**: `local-context.md` from working directory

If `workspace-context.md` doesn't exist in workspace, create it with the basic template (see `workspace-context` skill).
If `local-context.md` doesn't exist in working directory, create it with a basic template.

### Step 2: Gather Project Data (parallel reads)

All from working directory:

1. **Current priorities**: `goals/current.md` — focus on HIGH items
2. **Monthly tracker**: `goals/[current-month]-[current-year].md` — check bets, decisions, action items
3. **Recent 1:1s**: Scan `people/*/1-1s/` for files from the last 3 days
4. **Session log**: `last-session.md` — previous session's context
5. **Recent activity**: `activity-log.md` — entries from the last 3 days
6. **Calendar**: If a calendar source is active, fetch today's events using the user's timezone

If any file doesn't exist, skip it gracefully (don't error).

### Step 3: Identify Alerts

Proactively flag:
- **Overdue items**: Action items past their due date
- **Monthly rollover**: If a new month started, check if the monthly tracker needs creation
- **Stale blockers**: Blockers that haven't been updated in >5 days
- **Upcoming meetings**: Meetings today that may need preparation

### Step 4: Deliver the Brief

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

- **workspace-context**: Global context loaded in Step 1 (contacts, acronyms, preferences)
- **activity-log**: Recent entries provide real-time context that may not be in session-log yet
- **session-checkpoint**: Last session recap comes from last-session.md (written by checkpoint)
- **quick-log**: Important items logged during sessions surface here automatically
