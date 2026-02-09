---
name: "Decision Logging"
description: "Standard format and workflow for recording important decisions with context, rationale, and review dates."
---

# Decision Logging Skill

Records important decisions so they can be referenced, reviewed, and learned from.

## When This Skill Applies

- After a significant decision is made
- When the user says "we decided to..."
- When trade-offs are made explicit
- When direction changes
- Strategic choices that affect multiple people or projects
- `/decision-logging`

## What Warrants a Decision Log

**DO log:**
- Hiring decisions (hire/not hire, role changes)
- Priority trade-offs (X over Y)
- Process changes
- Structural/org changes
- Budget decisions
- Strategic direction changes
- Vendor/tool selections

**DON'T log (too granular):**
- Day-to-day task prioritization
- Minor schedule adjustments
- Routine operational choices

## Decision File Location

- Folder: `decisions/`
- Naming: `YYYY-MM-DD-[topic-slug].md`

## Standard Decision Format

```markdown
# Decision: [Clear Title]

**Date**: YYYY-MM-DD
**Decision Maker**: [Who made the call]
**Owner**: [Who executes/implements]

## Context

[Why was this decision needed? What problem or opportunity prompted it?]

- Background: [relevant history]
- Trigger: [what made this urgent now]
- Stakeholders affected: [who cares about this]

## Options Considered

### Option A: [Name]
- **Description**: [what this option involves]
- **Pros**: [benefits]
- **Cons**: [drawbacks]
- **Effort**: [rough sizing]

### Option B: [Name]
- **Description**: [what this option involves]
- **Pros**: [benefits]
- **Cons**: [drawbacks]
- **Effort**: [rough sizing]

## Decision

**We chose: [Option X]**

[One sentence stating the decision clearly]

## Rationale

[Why this option over others?]

- Key factors: [what mattered most]
- Trade-offs accepted: [what we're giving up]
- Assumptions: [what we're betting on]

## Implementation

### Next Steps
1. [ ] [Action] - [owner] - [due]
2. [ ] [Action] - [owner] - [due]

### Success Criteria
- [How we know this worked]
- [Metrics to watch]

### Risks
- [Risk 1]: [mitigation]
- [Risk 2]: [mitigation]

## Review

**Review Date**: [When to check if this is working]

---

*Related: [links to related decisions, projects, or context]*
```

## Lightweight Version

For less significant decisions:

```markdown
# Decision: [Title]

**Date**: YYYY-MM-DD | **Owner**: [Name]

## Decision
[What was decided]

## Why
[Brief rationale]

## Next Steps
- [ ] [Action]
```

## Rules

1. **Be specific about rationale** — "It felt right" is not a rationale. Document the actual reasoning.
2. **Link related files** — Update project files, goals, and profiles to reference the decision.
3. **Set a review date** — Every non-trivial decision should have one.
4. **Match the user's language** — Write decisions in the same language used in the conversation.
