# Phase 1 Quick Start Guide
## Engineering Orchestration Foundation (Jan 23 - May 31, 2026)

**TL;DR:** Build the core orchestration loop for engineering teams. Input: GitHub context. Output: prioritized, orchestrated work ready for review.

---

## What We're Building (4 Features)

### 1️⃣ Daily Report Input
- Engineering leader connects GitHub
- System auto-detects: issues, PRs, errors, team capacity
- Leader reviews, edits, submits → Vespr gets daily context

**Success:** <5 minutes from signup to first report submission

### 2️⃣ Intelligent Triage
- Claude API analyzes each issue
- Scores by: Impact (1-5) × Urgency (1-5) / Complexity (1-10)
- Surfaces top 5 issues: "This is what matters most today"

**Success:** 80% agreement between AI and leader's manual ranking

### 3️⃣ Orchestration & Approval
- AI recommends: "Assign to Sarah Chen, 2 hours, start today"
- Leader clicks "Approve"
- GitHub issue created + assigned
- Dashboard shows real-time progress

**Success:** 90% of recommendations approved without changes

### 4️⃣ Learning System
- Track: Did assigned engineer complete it? On time? Quality?
- Weekly feedback: "Your triage accuracy is 75% → 82%"
- System improves continuously

**Success:** Assignment accuracy improves from 70% → 85% by Month 4

---

## Success Metrics (What Wins Look Like)

### Activation
- 85% signup → GitHub OAuth completion
- 60% complete daily report
- 50% approve first orchestration plan

### Engagement
- 60% weekly active (submit report each week)
- 40% daily active (view dashboard daily)
- 80% orchestration approval rate

### Quality
- Triage agreement with humans: 80%
- Assignment accuracy: 85% by Month 4
- Estimation error: ±25% by Month 4

### Retention & Revenue
- Month-1 retention: 70%
- Month-3 retention: 50%
- **By May 31: 500 teams, $100K MRR, NPS 45+**

---

## Timeline at a Glance

| Week | Focus | Deliverable |
|------|-------|-------------|
| 1-2 | GitHub OAuth + API | Daily report input works |
| 3-4 | Triage algorithm + Claude | Ranked issue list |
| 5-8 | Orchestration + approval | Assignment → GitHub sync |
| 9-12 | Learning + testing | Metrics dashboard |
| 13-16 | Beta + iteration | 500 teams signed up |

---

## Team Roles

| Role | Responsibility |
|------|-----------------|
| **Backend (2 eng)** | API, database, Claude integration, GitHub sync |
| **Frontend (2 eng)** | Dashboard UI, approval flow, real-time updates |
| **ML/AI (1 eng)** | Triage scoring, learning pipeline |
| **QA (1 eng)** | Testing, beta feedback, edge cases |
| **DevOps (1 eng)** | Database, deployment, monitoring |
| **Design (1 designer)** | UX/UI for all 4 features |
| **Product (1 PM)** | Feature prioritization, customer feedback |

---

## Core Algorithm (Triage Score)

```
Score = (Impact × Urgency × 0.8 + Impact × 0.2) / (1 + Complexity/10)

Where:
  Impact ∈ [1-5]     = How many users affected?
  Urgency ∈ [1-5]    = How time-sensitive?
  Complexity ∈ [1-10] = How hard to fix?

Adjustments:
  P0 label → Impact × 2
  Blocked issues → Urgency × 1.5
  On backlog → Urgency × 0.5
```

**Example:**
- Database bug (Impact: 5, Urgency: 5, Complexity: 6)
- Score = (5 × 5 × 0.8 + 5 × 0.2) / (1 + 0.6) = 20.5 / 1.6 = **12.8/100**
- Recommendation: "Ship today (2-3h)"

---

## GitHub Integration Checklist

- [ ] OAuth app created (client ID, secret)
- [ ] OAuth flow works (redirect → browser → callback)
- [ ] Can fetch issues (high-priority, unassigned)
- [ ] Can fetch PRs (waiting for review)
- [ ] Can fetch errors (from Sentry integration)
- [ ] Can create GitHub issues from Vespr
- [ ] Can assign issues to engineers
- [ ] Can add comments with orchestration plan
- [ ] Rate limit handling (cache 1 hour)
- [ ] Webhook for external GitHub changes
- [ ] Hourly reconciliation (catch misses)

---

## UI Components to Build

### Input Flow
- `DailyReportModal` — Submit context
- `GitHubConnectFlow` — OAuth setup
- `ReportPreview` — Edit before submit

### Triage Flow
- `TriageList` — Ranked issues
- `IssueDetailPanel` — Full details + reasoning
- `DecompositionPreview` — AI-suggested tasks

### Approval Flow
- `OrchestrationPanel` — Assignment recommendation
- `ApprovalFlow` — Review + approve
- `GitHubSyncConfirm` — Preview changes

### Dashboard
- `ExecutionDashboard` — Real-time progress
- `StandupSummary` — Daily summary
- `MetricsView` — Accuracy, velocity, lead time

---

## Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| GitHub rate limits | Slow report | Aggressive caching (1-hour TTL) |
| Triage accuracy low | Users don't trust | Show reasoning, collect feedback |
| Leaders don't approve | GitHub sync doesn't happen | 1-click approval, clear UX |
| GitHub out of sync | Data inconsistency | Webhook + hourly reconciliation |
| Learning doesn't work | System doesn't improve | Weekly feedback, manual retraining |

---

## Database Schema (Essential Tables)

```sql
-- Core entities
workspaces              -- Team workspace
github_integrations     -- GitHub OAuth + repos
daily_reports           -- Daily context input
triage_results          -- AI scoring per issue
orchestration_plans     -- Assignment recommendations
learning_metrics        -- System accuracy over time
```

**Full schema:** See `plans/phase-1-engineering-orchestration-implementation.md`

---

## Claude API Integration

### For Triage Analysis
```
INPUT: Issue title, description, labels, related PRs
OUTPUT: Impact (1-5), Urgency (1-5), Complexity (1-10), reasoning
BATCH MODE: Score all 20 issues in 1 API call
CACHING: Cache results for 24 hours
```

### For Assignment Recommendation
```
INPUT: Issue, estimated hours, engineer skills + capacity
OUTPUT: Recommended engineer, confidence, reasoning
CACHING: Cache per team (update weekly as capacity changes)
```

---

## Go-to-Market (Simple Version)

### Target: Engineering Leaders
- VP Eng, Engineering Manager, Tech Lead
- Team size: 5-50 engineers
- Pain: Spend 30-40% of time triaging, planning, tracking
- Budget: $200-500/month
- Motivation: Ship more, reduce overhead

### Channels
1. **Product Hunt** (first week)
2. **Hacker News** (day one)
3. **Direct outreach** (500 CTOs via LinkedIn)
4. **Referral** (1st customers → network)
5. **Content** (blog posts on engineering velocity)

### Onboarding
1. Sign up (2 min)
2. Connect GitHub (OAuth)
3. Submit first daily report (auto-populated)
4. See triage results (automatic)
5. Approve assignment (1 click)
6. View dashboard (real-time)

**Target:** Signup → first approved orchestration in <10 minutes

---

## Weekly Standups (What to Track)

### Engineering
- Features shipped this week
- Blockers + dependencies
- Testing status
- Performance metrics (API latency, error rates)

### Design
- UI components completed
- Design review feedback
- Any design dependencies blocking engineers

### Product
- Customer feedback from beta testers
- Metric updates (adoption, churn, NPS)
- Feature prioritization for next week
- Competitive intelligence

### All
- Are we on track for Phase 1 milestones?
- What needs help?

---

## Key Files to Know

### Vision & Strategy
- `STRATEGIC_ROADMAP.md` — Overall strategy (read this first)
- `plans/vision-vespr-autonomous-operations-orchestration-2026.md` — Full vision
- `MULTI_VERTICAL_EXPANSION.md` — Why multi-vertical works

### Implementation
- `plans/phase-1-engineering-orchestration-implementation.md` — Detailed spec (600+ lines)
  - Feature breakdown
  - Architecture design
  - UI specifications
  - Timeline
  - Resource plan
  - Database schema
  - Claude prompts

### Reference
- `Claude.md` — Project overview for Claude Code
- `packages/shared/CLAUDE.md` — Shared library guide
- `packages/core/CLAUDE.md` — Core types guide

---

## Success = Phase 1 Wins

By **May 31, 2026:**
- ✅ 500 engineering teams signed up
- ✅ 300 teams actively using (60% adoption)
- ✅ $100K monthly recurring revenue
- ✅ NPS 45+ (teams love it)
- ✅ 70% month-1 retention, 50% month-3
- ✅ 5-10 strong case studies (engineering leaders singing our praises)

**This proves:**
- The orchestration loop works
- Engineering leaders will pay for autonomy
- We're ready to expand to finance, HR, operations, marketing

---

## Then What? (After May 31)

1. **Celebrate 🎉** (you earned it)
2. **Collect learnings** (20 user interviews)
3. **Design finance vertical** (Jun-Sep 2026)
4. **Ship HR/Recruitment** (Oct-Jan 2027)
5. **Scale operations** (by year-end 2027)

By August 2027:
- 3,400 teams across all verticals
- $2.8M monthly recurring revenue
- Clear path to $10B exit valuation

---

## Remember

> **Vespr is not a better Jira. Vespr is the autonomy layer on top of Jira.**
>
> **We don't replace your tools. We orchestrate work across them.**
>
> **The goal: Engineering leaders stop being the bottleneck.**

Start simple. Ship weekly. Collect feedback. Improve continuously.

**You've got this. Let's build something great.** 🚀

---

**Last Updated:** 2026-01-23
**Status:** Ready for Phase 1 Kickoff
**Next:** Team alignment meeting → First sprint planning

