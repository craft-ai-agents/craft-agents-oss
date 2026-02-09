---
name: "1:1 Preparation"
description: "Prepare for 1:1 meetings with direct reports — gathers context, open items, and suggested talking points."
---

# 1:1 Preparation Skill

Prepares a focused brief for 1:1 meetings with any direct report.

## When This Skill Applies

- "Prepare me for my 1:1 with [name]"
- "What should I discuss with [name]?"
- Before any scheduled 1:1 meeting
- `/1-1-preparation`

## Preparation Process

### Step 1: Identify the Person

Discover the person's profile dynamically:
1. Scan `people/` directory for a matching subdirectory
2. Read `people/[name]/profile.md` for their role, responsibilities, working style, current priorities, and concerns

### Step 2: Review Recent History

1. **Last 3 1:1s**: Read the most recent files in `people/[name]/1-1s/` — extract previous topics, action items, and follow-ups
2. **Open action items**: Identify anything that was committed to but not yet completed (items without strikethrough)

### Step 3: Check Broader Context

1. **Current priorities**: Read `goals/current.md` — look for blockers or items affecting this person's area
2. **Monthly tracker**: Read `goals/[current-month]-[current-year].md` — check their area's monthly bets and decisions
3. **Active projects**: Scan `projects/active/` for projects this person owns or is involved in

### Step 4: Build the Prep

Output format:

```markdown
## 1:1 Prep: [Name] — [Date]

### Quick Context
- **Role**: [from profile]
- **Current focus**: [from profile / recent 1:1s]
- **Working style notes**: [from profile, if relevant]

### Open Items from Previous 1:1s
- [ ] [Item] — [date committed]
- [ ] [Item] — [date committed]

### Suggested Agenda
1. **Follow-ups**: [items to check on]
2. **Blockers**: [anything blocking their work]
3. **Strategic topics**: [broader items to align on]
4. **Feedback/Development**: [if anything surfaced]

### Questions to Ask
- [Specific question based on context]
- [Specific question based on context]

### Watch For
- [Signals to pay attention to during the conversation]
```

## Rules

1. **Dynamic discovery** — Never hardcode names or roles. Always read from `people/[name]/profile.md`.
2. **Recency matters** — Focus on the last 3 1:1s, not the full history.
3. **Be specific** — "Check on Project X deadline" is better than "Discuss projects."
4. **Dynamic month** — Always compute the current month tracker filename dynamically.
5. **Match the user's language** — Respond in the same language the user is using.
