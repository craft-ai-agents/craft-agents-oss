# Vespr Strategic Pivot Summary

**Date:** 2026-01-23
**Status:** Strategic Direction Changed
**Previous Vision:** Research assistant for non-technical knowledge workers
**New Vision:** Autonomous engineering orchestration platform for leaders and ops

---

## Executive Summary

Vespr has been fundamentally redesigned. Instead of helping researchers do research faster, **Vespr is now an autonomous orchestration platform that manages engineering team priorities, execution, and delivery.**

Engineering leaders spend 15+ hours/week triaging bugs, planning sprints, assigning work, and tracking progress. Vespr reads your daily engineering context and does all of that automatically—leaving you to review and approve.

**Result:** Teams ship 1.5-2x faster. Bugs fixed 3x faster. Deliverables on time. Engineering leaders get their time back.

---

## The Shift

### Before (Knowledge Worker Research)
```
Input: Metrics about signups, conversion, engagement
↓
Vespr: Analyzes product metrics
↓
Output: "You should improve onboarding"
↓
User: Implements improvement manually
```

**Market:** Researchers, analysts, content creators
**Price:** $20-50/month per person
**Problem Solved:** Speed up research

### After (Engineering Orchestration)
```
Input: Daily engineering context (bugs, issues, deliverables, team capacity)
↓
Vespr: Intelligently prioritizes, decomposes, assigns, executes
↓
Output: PR ready for review (bug fixed, tested, documented)
↓
Leader: Reviews PR (5 min) → approves → ships
```

**Market:** Engineering leaders, CTOs, VP Eng, Founders
**Price:** $299-999/month per team
**Problem Solved:** Increase engineering velocity 50-100%

---

## Why This Shift Makes Sense

### The Original Vision Was Too Broad
- "Non-technical knowledge workers" = everyone (researchers, analysts, PMs, content creators)
- Trying to serve all = serve none well
- Market was fragmented, hard to focus

### The New Vision Is Focused
- Clear ICP: "Engineering leader managing 5-50 person team"
- Single clear problem: "Team velocity is bottlenecked on leader's prioritization/planning/tracking"
- Single clear ROI: "Equivalent to hiring 2 engineers"

### The Market Is Better
- Researchers are 1-person tools (nice to have, $20/month)
- Engineering leaders are team multipliers (must have, $500+/month)
- Every startup has this problem (vs. not every startup has researchers)
- Earlier market need (teams ship week 1, research comes later)

### The Loop Is More Valuable
- "Research tool" = you still have to implement findings
- "Orchestration engine" = AI does the research AND implements the fix
- No hand-off between "identify problem" and "solve problem"
- 10x more leverage

---

## Detailed Comparison

### Market
| Aspect | Before | After |
|--------|--------|-------|
| **ICP** | Researchers, analysts | Engineering leaders, CTOs |
| **Team Size** | Solo or 2-3 person | 5-500 person teams |
| **Problem** | Slow at doing research | Slow at shipping |
| **Job to Be Done** | "Help me research faster" | "Help my team ship faster" |
| **Budget Owner** | Individual (personal SaaS) | Engineering/Operations (business SaaS) |
| **Decision Maker** | User | Manager/CTO (buying for team) |

### Product
| Aspect | Before | After |
|--------|--------|-------|
| **Primary Input** | Product metrics, user feedback | GitHub issues, error tracking, deliverables |
| **AI Does** | Research, synthesis, analysis | Triage, planning, execution, measurement |
| **AI Output** | Research findings (human implements) | Shipped PR (human reviews) |
| **Integrations** | Notion, Obsidian, Slack | GitHub, Jira, Sentry, Slack, CI/CD |
| **Automation Level** | ~20% (analysis) | ~70% (execution) |
| **Core Value** | Speed up thinking | Eliminate bottleneck |

### Pricing & Business
| Metric | Before | After |
|--------|--------|-------|
| **ARPU** | $20-50/person | $300-1000/team |
| **Unit Economics** | LTV $800, CAC $1K (marginal) | LTV $80K, CAC $3K (strong) |
| **Payback** | 40+ months | 7.5 months |
| **TAM** | $100M (researchers) | $500M+ (engineering teams) |
| **Growth Path** | Individual → team → org | Team → multi-team → org |
| **Use Case** | Nice-to-have | Must-have |

### Positioning
| Aspect | Before | After |
|--------|--------|-------|
| **Slogan** | "The research assistant for non-technical workers" | "Your autonomous engineering orchestrator" |
| **Differentiation** | Simple UI for researchers | Autonomous execution + learning |
| **Competitive Set** | Claude Code, NotebookLM, Perplexity | CTO's time, Jira, GitHub |
| **Why Choose Vespr** | Easier to use | Saves 15+ hours/week + 1.5x velocity |

---

## The New Loop (In Detail)

### Daily Report Input
Engineering leader provides:
- GitHub issues (bugs, features)
- Error tracking (from Sentry/Datadog)
- Deliverables due (and timeline)
- Team capacity (who's available)
- Business context (what matters)

### Intelligent Triage (AI)
Vespr analyzes and scores every issue by:
- **Impact:** Revenue loss, user impact, team blocking
- **Urgency:** How old? Getting worse? Due when?
- **Complexity:** How hard to fix? How risky?
- **Score:** (Impact × Urgency) / Complexity

Output: Ranked list of "Top 10 things to do"

### Human Decision Point ⭐
Leader reviews triage:
- "I agree" → execute this plan
- "Actually, do this instead" → override priorities
- Takes 10 minutes

### Orchestration (AI)
For each priority:
1. Break into concrete subtasks
2. Estimate effort
3. Identify dependencies
4. Suggest who should do it (based on expertise + capacity)
5. Assign in Jira/Slack

### Autonomous Execution (AI)
For low-risk work (bug fixes, small features):
1. Reproduce issue
2. Find root cause
3. Implement fix
4. Write tests
5. Verify it works
6. Create PR with description
7. Run quality checks

**Output:** PR ready for human review

### Human Review ⭐
Engineer reviews PR:
- Takes 5-10 minutes (Vespr did the hard work)
- "Looks good, ship it"
- Merge → Deploy → Done

### Measurement
Track:
- Bug fixed? Yes
- Tests pass? Yes
- Any regressions? No
- Time to resolution? 2 days (was 6)

Add to learning system for next time.

---

## Phase Breakdown (Simplified)

### Phase 1: Triage (Jan-May)
**"Know What Matters"**
- Daily report input
- Impact scoring
- Priority approval + sync to team
- Metrics tracking
- **Goal:** Team knows daily priorities, no debate

### Phase 2: Execution (Jun-Sep)
**"From Idea to Shipped"**
- Task decomposition
- Intelligent assignment
- Autonomous bug fix execution
- Code review speedup (5 min instead of 4 hours)
- **Goal:** 50% of bugs fixed autonomously, 2-day close time

### Phase 3: Intelligence (Oct-Dec)
**"Works Better Over Time"**
- Learning system (learns your team's patterns)
- Bottleneck detection (what's slowing you down)
- Parallel execution (multiple streams simultaneously)
- Autonomous decisions (with guardrails)
- **Goal:** 1.5x team velocity, self-optimizing

### Phase 4: Scale (2027+)
**"Standard for All Teams"**
- Works for 5-person startup to 500-person org
- Vertical-specific solutions
- Enterprise features
- Predictive issue detection

---

## Success Metrics (Reshaped)

### Phase 1 End (May)
- 100 engineering teams using Vespr
- Triage time: 15 min/day (was 2+ hours)
- Team alignment: 80%+ agree with priorities
- Issue close time: 4 days (was 6)
- **MRR:** $20K

### Phase 2 End (Sep)
- 500 teams
- Bug close time: 2 days (was 6)
- 50% of bugs fixed autonomously
- Code review: 10 min (was 4+ hours)
- Deliverables on-time: 85% (was 65%)
- **MRR:** $100K

### Phase 3 End (Dec)
- 2,000 teams
- Team velocity: 1.5x
- Estimate accuracy: ±30% (was ±50%)
- Autonomous decisions: 80%+ correct
- Team satisfaction improving
- **MRR:** $300K

### Year-End
- $500K+ MRR (path to profitability)
- Established as standard for engineering teams
- Top engineering leaders using Vespr

---

## Why This Works Better

### For Engineering Leaders
✅ Get 15+ hours/week back from triaging and planning
✅ Confidence that priorities are clear to team
✅ Bugs fixed while you sleep
✅ Velocity improves 50-100%
✅ Deliverables ship on time

### For Engineering Teams
✅ Know exactly what to work on (no Slack debates)
✅ Focused work (not juggling 10 competing priorities)
✅ Fast code review (5 min, not 4 hours)
✅ Small bugs fixed same-day
✅ Tech debt gets scheduled (and done)
✅ Team feels energized (shipping fast again)

### For Companies
✅ Equivalent to hiring 2 engineers
✅ Ship 50% faster (beat competitors)
✅ Better retention (team not burnt out)
✅ Higher quality (more testing, fewer bugs)
✅ ROI: $6K/year for tool, $100K+/year in productivity

---

## The Pitch

**"Every engineering org has the same problem: engineering leaders are the bottleneck. They spend 15+ hours/week triaging priorities, planning work, assigning tasks, and worrying about whether you'll ship on time.**

**That time could be spent on strategy, hiring, architecture, culture.**

**Vespr reads your daily engineering context—bugs, issues, deliverables, team capacity. It prioritizes work intelligently, decomposes it into tasks, assigns them to the right people, executes the low-risk work, and surfaces everything for review.**

**You stay in control. You review the PRs. You decide what ships. But you're not the bottleneck anymore.**

**Your 10-person team ships like a 15-person team. Your bugs get fixed 3x faster. Your deliverables ship on time. And your engineering leader gets their life back."**

---

## Key Files

- **New Vision:** `plans/vision-vespr-autonomous-engineering-orchestration-2026.md` (1,551 lines)
- **Old Vision:** `plans/vision-vespr-knowledge-worker-platform-2026.md` (archived)
- **Review Summary:** `plans/review-summary-vespr-vision.md` (can be retired)

---

## Next Steps

1. **Team alignment:** Review new vision with team
2. **Design Phase 1:** Daily report UI + triage engine
3. **Recruit beta:** 10 engineering leaders for feedback
4. **Build Phase 1:** 4-month sprint (Jan-May)
5. **Launch:** Public beta launch (June)

---

**This pivot is the right call.** The problem is bigger, the market is better, the ROI is clearer, the product is more valuable.

Let's ship it.

