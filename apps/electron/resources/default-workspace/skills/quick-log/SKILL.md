---
name: "Quick Log"
description: "Capture important context quickly during conversation — decisions, insights, actions taken."
alwaysAllow: ["Read", "Edit"]
---

# Quick Log Skill

Quickly capture important information during conversation to ensure continuity between sessions.

## When This Skill Applies

Use this skill proactively when:
- An important decision is made mid-conversation
- User shares critical context that should be remembered
- Processing a transcript or document with key insights
- Completing a significant action that should be logged
- User explicitly asks: "log this", "save this", `/quick-log`

## How It Works

1. **Read current activity-log.md** to see existing entries
2. **Determine what to log**:
   - Decisions made and their rationale
   - Important insights discovered
   - Actions taken (meetings processed, updates made, etc.)
   - Context that will be valuable in future sessions
3. **Add entry to activity-log.md** with:
   - **Timestamp**: Date and time (HH:MM)
   - **Category**: Decision / Insight / Action / Context
   - **Summary**: Brief description (1-2 sentences)
   - **Why it matters**: Impact or relevance for future sessions
4. **Confirm with user**: Brief message about what was logged

## Entry Format

```markdown
### HH:MM - [Category]: [Title]
**Context:** [1-2 sentences explaining the situation]

**[Category-specific section]:**
- [Bullet points with details]

**Why it matters:** [1 sentence on future relevance]
```

## Categories

- **Decision**: Choices made, rationale, alternatives considered
- **Insight**: Discoveries, patterns, revelations from data/transcripts
- **Action**: Significant tasks completed (processed transcript, updated files, etc.)
- **Context**: Important background information for future reference
- **Flag**: Something to watch, follow up on, or investigate later

## Rules

1. **Be concise** — Capture essence, not every detail
2. **Focus on "why"** — Future you needs context, not just facts
3. **Cross-reference** — Link to relevant files when helpful
4. **Match language** — Write in the same language as the user
5. **Timestamp everything** — Always include time (HH:MM)
6. **Proactive, not reactive** — Suggest logging without being asked when it would help continuity

## Examples

### Example 1: Decision
```markdown
### 18:15 - Decision: Database Migration Strategy
**Context:** Team review revealed the current schema won't scale past 10K users.

**Decision:**
- Moving to PostgreSQL with partitioned tables
- Phased migration: read replicas first, then full cutover
- Targeting completion before Q3 launch

**Why it matters:** Locks in the database strategy and unblocks the backend team's sprint planning.
```

### Example 2: Insight
```markdown
### 14:30 - Insight: User Retention Pattern
**Context:** Analytics review showed a drop-off at day 7 for free-tier users.

**Details:**
- Day-7 retention: 23% (down from 31% last quarter)
- Users who complete onboarding checklist retain at 2x rate
- Similar pattern seen in competitor benchmarks

**Why it matters:** Onboarding completion is the strongest lever for retention. Prioritize onboarding UX improvements.
```

### Example 3: Action
```markdown
### 16:45 - Action: Processed Quarterly Review Notes
**Context:** Updated tracking files from quarterly business review.

**Files updated:**
- `goals/current.md` - Infrastructure migration now "On track"
- `people/team-leads/profile.md` - Updated team capacity numbers
- `projects/active/api-redesign.md` - Phase 1 complete (4/4 milestones)

**Why it matters:** Captures state before next planning cycle. Baseline for team capacity discussions.
```

## When NOT to Use This Skill

- Trivial conversation exchanges
- Information already captured in tracking files
- Routine updates that will be in session-checkpoint anyway
- User small talk or clarification questions

## Integration with Other Skills

- **session-checkpoint**: Reads activity-log to build comprehensive end-of-session summary
- **session-start**: Shows recent activity-log entries in catch-up brief

---

**Remember:** The goal is continuity. Log anything that would make future-you say "I wish I had written that down."
