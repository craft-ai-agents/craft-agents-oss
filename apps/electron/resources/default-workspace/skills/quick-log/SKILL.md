---
name: "Quick Log"
description: "Capture important context quickly during conversation — decisions, insights, actions taken."
alwaysAllow: ["Read", "Edit"]
---

# Quick Log Skill

Captura rápida de informações importantes durante a conversa para garantir continuidade entre sessões.

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
### 18:15 - Decision: G4 Tools Automation Strategy
**Context:** Cunha efficiency interview revealed operations are still "artesanal" phase.

**Decision:**
- NOT automating G4 Tools processes yet (premature)
- Focus on intelligence tools instead (call intel, portfolio scraping)
- Wait for operations to stabilize before process automation

**Why it matters:** Prevents premature optimization and keeps team focused on high-value intelligence tooling.
```

### Example 2: Insight
```markdown
### 14:30 - Insight: Leo Binda Interest Pattern
**Context:** Gabriel mentioned Jon/David showed interest in Leo Binda.

**Details:**
- Leo Binda score: 8.6 (R:8, C:9, S:9)
- Jon/David interest = potential retention risk
- Similar pattern happened with other high performers

**Why it matters:** Early warning signal for retention conversation. Need to clarify situation with Gabriel in next 1:1.
```

### Example 3: Action
```markdown
### 16:45 - Action: Processed Weekly BizOps Review
**Context:** Updated tracking files from Notion weekly review.

**Files updated:**
- `goals/current.md` - Suporte restructuring now "On track"
- `people/gabriel/profile.md` - Team scores, Heitor → Tools move
- `projects/active/efficiency-interviews-priority.md` - Tier 1 complete (4/4)

**Why it matters:** Captures state before Weekly Intelligence meeting (Monday 15:00). Gabriel's first weekly report baseline.
```

## When NOT to Use This Skill

- Trivial conversation exchanges
- Information already captured in tracking files
- Routine updates that will be in session-checkpoint anyway
- User small talk or clarification questions

## Integration with Other Skills

- **session-checkpoint**: Reads activity-log to build comprehensive end-of-session summary
- **session-start**: Shows recent activity-log entries in catch-up brief
- **update-tracker**: May create activity-log entry after significant updates
- **decision-logging**: For formal decisions, use decision-logging; quick-log is for informal capture

---

**Remember:** The goal is continuity. Log anything that would make future-you say "I wish I had written that down."
