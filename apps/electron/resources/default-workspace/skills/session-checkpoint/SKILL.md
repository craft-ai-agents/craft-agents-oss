---
name: "Session Checkpoint"
description: "Save daily progress before ending — captures activities, context, and next steps for session continuity."
---

# Session Checkpoint Skill

Captures the day's progress so the next session can pick up seamlessly.

## When This Skill Applies

- End of work day
- "Save progress"
- "Checkpoint"
- "Wrap up"
- `/session-checkpoint` or `/checkpoint`

## Checkpoint Process

### Step 0: Auto-Log Session Summary (if not already logged)

Before creating the checkpoint, check if this session's main activities are already in `activity-log.md`. If not:

1. **Add activity-log entry** for this session with:
   - Category: "Action" or "Context"
   - Summary of key activities completed
   - Important decisions made
   - Files modified
   - Why it matters for future sessions

This ensures even if the user forgets to use `/quick-log`, important context is captured.

### Step 1: Gather Today's Activity

1. **Recent activities**: Read `activity-log.md` for today's entries
2. **Session log**: Read `session-log.md` to check for existing entry today
3. **Conversation context**: Extract key decisions, discussions, and blockers from the current conversation

### Step 2: Build the Entry

Structure the daily entry:

```markdown
### [YYYY-MM-DD] — [Day of Week]

**Activities:**
- [What was worked on]
- [Meetings held / people spoken to]
- [Files updated]

**Decisions Made:**
- [Decision and brief rationale]

**Blockers / Open Items:**
- [Blocker or unresolved item]

**Next Session:**
- [What to pick up next]
- [Pending items to address]
```

### Step 3: Update Workspace Context

Review the current conversation for any new context worth persisting:

1. **New contacts** — Names, roles, or nicknames mentioned for the first time
2. **New acronyms/terminology** — Domain terms the user explained
3. **Project status changes** — Significant progress or new projects
4. **Preferences learned** — Work style, communication preferences, or tooling choices

If any new context was learned:
1. Read `workspace-context.md`
2. Add or update the relevant entries
3. Remove any stale entries noticed during the review

If `workspace-context.md` doesn't exist yet and meaningful context was learned, create it with the standard template (see the `workspace-context` skill for the format).

### Step 4: Save

1. **session-log.md**: Append the entry. One entry per day — if an entry for today already exists, update it (don't duplicate).
2. **last-session.md**: Overwrite entirely with today's entry. This file is for fast loading at next session start.

## Rules

1. **One entry = one day** — Multiple sessions in a day update the same entry, not create new ones.
2. **Capture context, not noise** — Focus on decisions, blockers, and continuity items. Skip routine actions.
3. **Next Session section is critical** — This is what makes the handoff work. Be specific about what's pending.
4. **Dynamic timezone** — Use the user's configured timezone for date boundaries, never hardcode a timezone.
5. **Match the user's language** — Write entries in the same language used during the session.
6. **Auto-log first** — Before creating the checkpoint, add activity-log entry for this session if not already present.

## Integration with Other Skills

- **workspace-context**: Step 3 reviews and updates workspace-context.md with any new contacts, acronyms, or project context learned during the session.
- **quick-log**: If significant activities happened, they should already be in activity-log via quick-log. Checkpoint pulls from there.
- **session-start**: Next session will read workspace-context.md, session-log.md, and activity-log.md for full context.
- **update-tracker**: Files modified during the session should be mentioned in the checkpoint.
