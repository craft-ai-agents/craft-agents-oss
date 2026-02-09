---
name: "Weekly Digest"
description: "Summarizes the week's activity — 1:1 outcomes, commits, priority changes, and items for the weekly team meeting."
---

# Weekly Digest Skill

Aggregates the full week's activity into a digestible summary, typically for Monday weekly team meeting prep.

## When This Skill Applies

- Sunday evening or Monday morning
- "Prepare the weekly digest"
- "What happened this week?"
- "Prep for the weekly team meeting"
- `/weekly-digest`

## Digest Process

### Step 1: Gather Weekly Data

1. **1:1 Notes**: Glob `people/*/1-1s/YYYY-MM-DD*.md` for files from the last 7 days. Extract key topics, action items, and concerns per person.
2. **Git activity**: Run `git log --oneline --since="7 days ago"` for all commits this week.
3. **Monthly tracker**: Read `goals/[current-month]-[current-year].md` for status changes.
4. **Current priorities**: Read `goals/current.md` for priority or blocker changes.
5. **Session log**: Read `session-log.md` for captured decisions during the week.

### Step 2: Organize by Person

Dynamically discover all people from the `people/` directory. For each person:

```markdown
### [Name] — [Role]
- **Met**: [date of 1:1, or "No 1:1 this week"]
- **Status**: Green / Yellow / Red
- **Key Topics**: [what was discussed]
- **Wins**: [positive progress]
- **Concerns**: [risks or issues]
- **Action Items**: [pending items with owners]
```

### Step 3: Synthesize

```markdown
## Weekly Digest — Week of [Date]

### Per-Person Summaries
[One section per direct report, as above]

### Key Changes This Week
- [Priority changes]
- [New blockers or resolved blockers]
- [Status changes on projects]

### Decisions Made
- [Decision] — [date] — [brief rationale]

### Active Blockers
- [Blocker] — [owner] — [age]

### Items for Weekly Meeting Discussion
- [Topic that needs group alignment]
- [Decision that needs input from multiple people]

### User Action Items
- [ ] [Action from 1:1s or decisions]
- [ ] [Action from 1:1s or decisions]
```

## Rules

1. **Dynamic people discovery** — Scan `people/` directory, never hardcode names or roles.
2. **Status color** — Green (on track), Yellow (has concerns), Red (blocked/at risk). Derive from the data.
3. **Dynamic month** — Always compute the current month tracker filename dynamically.
4. **Concise but complete** — Each person section should be 4-6 lines max.
5. **Flag what matters** — The "Items for Weekly Meeting Discussion" section is the most important output.
6. **Match the user's language** — Respond in the same language the user is using.
