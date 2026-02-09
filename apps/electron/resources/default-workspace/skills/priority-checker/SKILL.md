---
name: "Priority Checker"
description: "Validates new initiatives against current priorities and team capacity — recommends PROCEED, DEFER, or DECLINE."
---

# Priority Checker Skill

Helps make disciplined priority decisions by checking new proposals against current commitments and capacity.

## When This Skill Applies

- "Should I do X?"
- "Can we add Y to the backlog?"
- "Is this urgent?"
- Evaluating trade-offs
- `/priority-checker`

## Assessment Process

### Step 1: Clarify the Proposal

Before assessing, understand:
- **What** is being proposed?
- **Resources** needed (who, how much time)?
- **Timeline** (when does it need to happen)?
- **Requester** (who's asking, why now)?

### Step 2: Read Current State

1. **Current priorities**: Read `goals/current.md` — identify all HIGH, MEDIUM, LOW items
2. **Monthly tracker**: Read `goals/[current-month]-[current-year].md` — check monthly bets (typically max 2 per area)
3. **Team capacity**: Scan `people/` profiles to understand current workload and availability

### Step 3: Assess Fit

Evaluate:
- **Alignment**: Does this support current HIGH priorities or is it orthogonal?
- **Capacity**: Is there room, or does something need to exit?
- **Timing**: Is now the right time, or can it wait?
- **Conflicts**: Does this compete with existing commitments?

### Step 4: Make Trade-offs Explicit

If the answer isn't an obvious yes:
- **What exits** if this enters?
- **Who is affected** by the change?
- **What are the risks** of doing it vs. deferring?

### Step 5: Deliver Recommendation

Output format:

```markdown
## Priority Assessment: [Proposal]

### Summary
[1-2 sentences: what's being proposed]

### Alignment with Current Priorities
- [How it relates to HIGH items]
- [How it relates to monthly bets]

### Capacity Check
- [Current team load]
- [Available bandwidth]

### Conflicts
- [Competing commitments]
- [Resource conflicts]

### Trade-offs
- If PROCEED: [what exits or gets deprioritized]
- If DEFER: [risk of waiting]
- If DECLINE: [what we lose]

### Recommendation: **PROCEED / DEFER / DECLINE**
[Brief rationale for the recommendation]

### If Proceeding — Next Steps
- [ ] [Action]
- [ ] [Action]
```

## Rules

1. **Be honest** — If the team is at capacity, say so. Don't sugarcoat.
2. **Trade-offs are mandatory** — Never say "just add it." Something always gives.
3. **Dynamic month** — Always compute the current month tracker dynamically.
4. **Dynamic people discovery** — Read capacity from `people/` profiles, don't hardcode.
5. **Respect existing commitments** — Existing HIGH items have inertia; new things need strong justification to displace them.
6. **Match the user's language** — Respond in the same language the user is using.
