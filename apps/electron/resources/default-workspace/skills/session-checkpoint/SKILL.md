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

### Step 3: Save

1. **session-log.md**: Append the entry. One entry per day — if an entry for today already exists, update it (don't duplicate).
2. **last-session.md**: Overwrite entirely with today's entry. This file is for fast loading at next session start.

## Rules

1. **One entry = one day** — Multiple sessions in a day update the same entry, not create new ones.
2. **Capture context, not noise** — Focus on decisions, blockers, and continuity items. Skip routine actions.
3. **Next Session section is critical** — This is what makes the handoff work. Be specific about what's pending.
4. **Dynamic timezone** — Use the user's configured timezone for date boundaries, never hardcode a timezone.
5. **Match the user's language** — Write entries in the same language used during the session.
