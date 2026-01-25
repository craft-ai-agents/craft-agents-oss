# Phase 1: Engineering Orchestration Foundation
## Detailed Implementation Plan

**Date:** 2026-01-23
**Duration:** 4 months (Jan 23 - May 31, 2026)
**Target:** 500 engineering teams, $100K MRR, proof-of-concept for multi-vertical expansion
**Team:** 8-10 engineers, 1-2 designers, 1 product manager

---

## Phase 1 Overview

**Goal:** Build the core orchestration loop for engineering teams. Input: daily GitHub context. Output: prioritized work, automated triage, human-approved execution.

**Core Loop (What Gets Built):**
1. **Daily Report Input** — GitHub issues, PRs, errors → context ingestion
2. **Intelligent Triage** — AI-powered prioritization (impact × urgency / complexity)
3. **Orchestration Plan** — Task decomposition and assignment recommendation
4. **Approval & Sync** — Human review + GitHub issue sync
5. **Execution Tracking** — Real-time dashboard of orchestrated work

**Success Criteria:**
- 500 engineering teams signed up
- 300 teams actively using (60% adoption)
- $100K MRR ($200/team/month average)
- NPS 45+
- Retention: 70% month-1, 50% month-3

---

## Feature Breakdown

### Feature 1: Daily Report Input (Weeks 1-4)

**Purpose:** Allow engineering leaders to post daily context—GitHub issues, PRs, errors, team capacity—and let Vesper understand what matters most.

**User Journey:**
1. Connect GitHub workspace
2. Daily report populates auto-detected from:
   - Open issues (high-priority label, unassigned)
   - Pull requests (waiting for review)
   - Errors/warnings (from Sentry/error tracking)
   - Team capacity (# engineers available)
3. Leader confirms/edits report, submits to Vesper
4. Vesper analyzes and surfaces triage recommendations

**Technical Requirements:**

- **GitHub OAuth Integration**
  - Authenticate with GitHub App
  - Request scopes: `repo`, `read:org`, `read:user`
  - Store OAuth token encrypted in credentials.enc

- **GitHub Data Ingestion**
  - REST API queries:
    - GET `/repos/{owner}/{repo}/issues?labels=high-priority,unassigned`
    - GET `/repos/{owner}/{repo}/pulls?state=open`
    - GET `/repos/{owner}/{repo}/commits?since={date}`
  - Cache results for 1 hour to avoid rate limiting
  - Handle pagination (100 issues per page)

- **Daily Report Schema**
  ```typescript
  interface DailyReport {
    id: string;
    workspaceId: string;
    date: Date;
    source: 'github' | 'manual';
    issues: {
      id: string;
      title: string;
      labels: string[];
      assignee: string | null;
      priority: 'critical' | 'high' | 'medium' | 'low';
      estimatedHours: number;
      url: string;
    }[];
    pullRequests: {
      id: string;
      number: number;
      title: string;
      author: string;
      reviewersRequired: number;
      url: string;
    }[];
    errors: {
      id: string;
      message: string;
      severity: 'critical' | 'warning' | 'info';
      occurrences: number;
      url: string;
    }[];
    teamCapacity: {
      totalEngineers: number;
      availableEngineers: number;
      onVacation: string[];
    };
  }
  ```

- **UI Components**
  - `DailyReportModal.tsx` — Daily report input form
  - `GitHubConnectFlow.tsx` — OAuth setup + repo selection
  - `ReportPreview.tsx` — Shows auto-detected issues, allows manual edits
  - `TeamCapacityInput.tsx` — Input for available engineers

**Deliverables:**
- GitHub OAuth integration (MCP-based or direct API)
- Daily report schema and storage
- Input UI (modal + forms)
- Error handling for GitHub API rate limits

**Success Metrics:**
- 95% of repos successfully indexed
- 85% of reports auto-populated correctly
- Average time to submit report: <5 minutes

---

### Feature 2: Intelligent Triage Engine (Weeks 4-8)

**Purpose:** Analyze daily report and intelligently rank issues by impact, urgency, and complexity. Leader sees exactly what to focus on.

**Core Algorithm:**

```
Triage Score = (Impact × Urgency × 0.8 + Impact × 0.2) / (1 + Complexity/10)

Where:
  Impact ∈ [1-5]     = User impact (affects how many users?)
  Urgency ∈ [1-5]    = Time sensitivity (when is this needed?)
  Complexity ∈ [1-10] = Engineering effort (how hard is this?)

Adjusted for:
  - P0 label: Impact × 2
  - Blocked issues: Urgency × 1.5
  - On backlog: Urgency × 0.5
```

**AI Integration (Claude):**
1. For each issue, agent analyzes:
   - Issue title + description
   - Related PRs and commits
   - Error patterns
   - User impact from comments/reactions
2. Agent assigns Impact score (1-5) with reasoning
3. Agent suggests task decomposition (if complex)

**Triage Output:**

```typescript
interface TriageResult {
  issueId: string;
  score: number;           // 0-100, higher = more important
  impact: number;          // 1-5
  urgency: number;         // 1-5
  complexity: number;      // 1-10
  recommendation: 'ship-today' | 'start-this-week' | 'schedule' | 'defer';
  decomposition?: {
    subtasks: string[];    // AI-suggested task breakdown
    estimatedHours: number;
    priority: string[];    // [critical, must-do, nice-to-have]
  };
  reasoning: string;       // Why this ranking?
}
```

**UI Components:**
- `TriageList.tsx` — Ranked list of issues (sortable by score, impact, urgency)
- `IssueDetailPanel.tsx` — Full issue details + triage reasoning
- `DecompositionPreview.tsx` — Show AI-suggested task breakdown
- `TriageSettings.tsx` — Customize algorithm weights per team

**Technical Implementation:**
- Invokes Claude API (batched) to score all issues
- Caches triage results for 24 hours
- Real-time re-triage when new issues added
- Stores reasoning for audit/learning

**Deliverables:**
- Triage scoring algorithm
- Claude integration for impact analysis
- Triage UI and ranking interface
- Settings for customizing weights

**Success Metrics:**
- Triage scoring takes <30 seconds for 20 issues
- 80% agreement between AI triage and leader's manual ranking
- Task decomposition captures 85%+ of actual work breakdown

---

### Feature 3: Orchestration & Approval (Weeks 8-12)

**Purpose:** Vesper recommends how to execute the work, leader approves, and GitHub gets updated.

**Orchestration Flow:**

1. **Assignment Recommendation**
   - For each high-priority issue, AI recommends:
     - Best engineer (based on skills, capacity, history)
     - Estimated timeline
     - Dependencies (what needs to be done first)
   - Leader reviews and approves

2. **GitHub Issue Sync**
   - Create GitHub issue from recommendation
   - Assign to recommended engineer
   - Add to sprint/milestone
   - Add comments with orchestration plan
   - Link related PRs

3. **Execution Dashboard**
   - Real-time view of assigned work
   - PR review queue
   - Blocking issues
   - Daily standup summary

**Assignment Algorithm:**

```
Engineer Score = (SkillMatch × 0.5 + Capacity × 0.3 + History × 0.2)

Where:
  SkillMatch    = How relevant are their past PRs?
  Capacity      = How many hours available this week?
  History       = How often do they close this type of issue?
```

**UI Components:**
- `OrchestrationPanel.tsx` — Show assignment recommendations
- `ApprovalFlow.tsx` — Review + approve orchestration plan
- `GitHubSyncConfirm.tsx` — Preview of GitHub changes before sync
- `ExecutionDashboard.tsx` — Real-time execution tracking
- `StandupSummary.tsx` — Daily summary for team standup

**Technical Implementation:**
- Store assignment history to improve recommendations
- GitHub API: Create/update issues, add comments, manage labels
- Detect when GitHub changes externally (PR merged, issue closed) and update Vesper
- Real-time updates via polling GitHub API every 5 minutes

**Deliverables:**
- Assignment recommendation algorithm
- GitHub sync integration
- Approval UI and workflow
- Execution dashboard
- Real-time status updates

**Success Metrics:**
- 90% of recommended assignments approved without changes
- GitHub sync completes in <2 minutes
- 95% of GitHub external changes detected within 5 minutes

---

### Feature 4: Learning & Improvement (Weeks 12-16)

**Purpose:** System learns from outcomes to improve recommendations over time.

**Learning Inputs:**
- Did the assigned engineer actually complete the issue?
- How long did it actually take vs. estimate?
- Were dependencies correct?
- Did the PR get approved immediately or need rework?
- Did the fix cause new issues?

**Feedback Loop:**
1. Weekly: Review completed work, capture learnings
2. Monthly: Retrain scoring models with new data
3. Per-team: Customize weights based on team patterns

**Metrics Tracking:**
- Assignment accuracy (did engineer complete as expected?)
- Estimation accuracy (actual hours vs. predicted)
- Lead time (from triage to completion)
- Quality (rework cycles, post-deployment issues)

**UI Components:**
- `LearningDashboard.tsx` — Show system accuracy improving over time
- `MetricsView.tsx` — Team velocity, estimation accuracy, lead times
- `WeeklyReview.tsx` — Review completed work + learnings

**Technical Implementation:**
- Store all decisions + outcomes in database
- Weekly batch: Analyze completed issues + improve models
- Per-team customization: Track which weights work best for each team
- Feedback mechanism: Leader can rate recommendation quality (thumbs up/down)

**Deliverables:**
- Learning pipeline (decision → outcome tracking)
- Metrics dashboard
- Model retraining logic
- Feedback collection UI

**Success Metrics:**
- Assignment accuracy improves from 70% → 85% by Month 4
- Estimation error reduces from ±40% → ±20%
- System accuracy dashboard shows clear improvements over 4 weeks

---

## Architecture

### Data Model

```typescript
// Core entities
Workspace {
  id: string;
  name: string;
  ownerUserId: string;
  githubOrgId?: string;
  permissionMode: 'safe' | 'ask' | 'auto';
  settings: WorkspaceSettings;
  createdAt: Date;
}

DailyReport {
  id: string;
  workspaceId: string;
  date: Date;
  issues: Issue[];
  pullRequests: PR[];
  errors: Error[];
  teamCapacity: TeamCapacity;
  submittedAt: Date;
}

TriageResult {
  id: string;
  reportId: string;
  issueId: string;
  score: number;           // 0-100
  impact: number;
  urgency: number;
  complexity: number;
  recommendation: string;
  decomposition: TaskDecomposition;
  reasoning: string;
  createdAt: Date;
}

OrchestrationPlan {
  id: string;
  triageResultId: string;
  assignedEngineer: string;
  estimatedHours: number;
  dependencies: string[];
  githubIssueId?: string;
  status: 'recommended' | 'approved' | 'synced' | 'completed';
  approvedAt?: Date;
  completedAt?: Date;
}

LearningMetric {
  id: string;
  workspaceId: string;
  metric: 'assignment_accuracy' | 'estimation_error' | 'lead_time' | 'quality_score';
  value: number;
  week: number;
  year: number;
}
```

### API Endpoints

**Daily Reports:**
- `POST /api/reports` — Submit daily report
- `GET /api/reports` — List reports for workspace
- `GET /api/reports/{id}` — Get report details
- `PUT /api/reports/{id}` — Edit report (before submission)

**Triage:**
- `POST /api/triage` — Run triage on report
- `GET /api/triage/{reportId}` — Get triage results
- `PUT /api/triage/{id}/feedback` — Feedback on triage quality

**Orchestration:**
- `POST /api/orchestration/plan` — Generate orchestration plan
- `PUT /api/orchestration/{id}/approve` — Approve plan
- `POST /api/orchestration/{id}/sync` — Sync to GitHub
- `GET /api/orchestration/dashboard` — Execution status dashboard

**Learning:**
- `GET /api/metrics` — Team metrics (velocity, accuracy, lead time)
- `GET /api/learning/improvement` — Show system improvement over time

### Integration Architecture

```
┌─────────────────────────────────────────┐
│       Vesper Electron App (UI)           │
└──────────────┬──────────────────────────┘
               │
               ├─ Daily Report Input
               ├─ Triage Results Display
               ├─ Orchestration Approval
               └─ Execution Dashboard
               │
┌──────────────▼──────────────────────────┐
│    Vesper Backend (Node/Bun)             │
│  • Report processing                    │
│  • Triage scoring (Claude API)          │
│  • Assignment algorithms                │
│  • GitHub sync                          │
│  • Metrics aggregation                  │
└──────────────┬──────────────────────────┘
               │
        ┌──────┼──────┬──────────┐
        │             │          │
┌───────▼──┐  ┌──────▼────┐  ┌──▼────────┐
│ GitHub   │  │ Claude    │  │ Database  │
│   API    │  │   API     │  │  (SQLite) │
└──────────┘  └───────────┘  └───────────┘
```

### Tech Stack for Phase 1

| Layer | Technology |
|-------|-----------|
| **Frontend** | React + TypeScript (existing) |
| **UI Components** | shadcn/ui + Tailwind CSS |
| **State** | Jotai atoms (existing) |
| **Backend** | Bun + Elysia.js (Node-compatible) |
| **Database** | SQLite (single-file, portable) |
| **AI** | Claude API (batch + streaming) |
| **GitHub Integration** | GitHub REST API + OAuth |
| **Deployment** | Docker + Fly.io (or local) |

---

## UI/UX Specifications

### Daily Report Input

**Goal:** <5 minute workflow to input day's context

**Screens:**

1. **GitHub Connection** (OAuth Flow)
   - Button: "Connect GitHub"
   - User signs in with GitHub
   - Select organization(s) and repositories
   - Store OAuth token
   - Status: "Connected to 3 repos"

2. **Report Auto-Population**
   - Title: "Today's Report — Jan 24, 2026"
   - Auto-loaded sections:
     - "🐛 Open Issues (5)" — expandable list with high-priority filter
     - "📝 Pull Requests (3)" — waiting for review
     - "⚠️ Recent Errors (2)" — from error tracking integration
   - Input section:
     - "👥 Available engineers: [input]"
     - "📌 Other context: [textarea]"
   - Buttons: "Cancel" | "Review & Submit"

3. **Report Review**
   - Shows all selected issues/PRs
   - Allow edit/remove individual items
   - Final confirmation
   - Submit button

### Triage Results

**Goal:** Leaders see exactly what matters most

**Screen: Triage List**
```
┌─────────────────────────────────────────┐
│ 📊 Today's Triage (5 issues)             │
├─────────────────────────────────────────┤
│                                          │
│ 1. 🔴 CRITICAL [92/100]                 │
│    "Database connection pool exhausted"  │
│    Impact: 5 | Urgency: 5 | Complexity: 6
│    → Ship today (2-3h estimate)          │
│                                          │
│ 2. 🟠 HIGH [78/100]                     │
│    "Add support for OAuth refresh"       │
│    Impact: 4 | Urgency: 4 | Complexity: 7
│    → Start this week                     │
│                                          │
│ [3 more issues...]                      │
│                                          │
│ 💡 Tip: Start with issue #1, it blocks  │
│    the other 2 PRs waiting for review    │
└─────────────────────────────────────────┘
```

**Issue Detail View:**
- Full issue details + description
- Triage reasoning ("Why is this #1?")
- Suggested task breakdown (if complex)
- Related PRs/issues
- Previous similar issues + resolutions

### Orchestration & Approval

**Goal:** Leader approves work assignments in 2-3 minutes

**Screen: Orchestration Plan**
```
┌──────────────────────────────────────────┐
│ ✅ Orchestration Plan                    │
├──────────────────────────────────────────┤
│                                           │
│ Issue #1: "Database connection pool..."  │
│                                           │
│ 👤 Recommended: Sarah Chen                │
│    (Fixed 5 similar issues, 4 hours free)│
│                                           │
│ ⏱️  Estimate: 2 hours                     │
│                                           │
│ 🔗 Dependencies:                          │
│    • Upgrade Postgres (Issue #5)          │
│    • Merge PR #42 (waiting 2 days)        │
│                                           │
│ 📝 Plan:                                  │
│    1. Investigate pool limits (30m)       │
│    2. Implement connection reuse (1h)     │
│    3. Load test (30m)                     │
│                                           │
│ Buttons: [Edit] [Approve] [Reassign]     │
└──────────────────────────────────────────┘
```

**Approval Workflow:**
1. Review assignment + plan
2. Click "Approve"
3. Choose: "Create GitHub Issue" or "Update Existing"
4. Preview GitHub changes
5. Confirm sync
6. Issue appears in GitHub with comments

### Execution Dashboard

**Goal:** Real-time view of orchestrated work

**Screen: Dashboard**
```
┌────────────────────────────────────────────┐
│ 🎯 Execution Dashboard                     │
├────────────────────────────────────────────┤
│                                             │
│ 📋 Today's Plan (4 active)                 │
│ ├─ Sarah: Database pool [████░░] 2/2h      │
│ ├─ Mike: OAuth PR review [██░░░░] 30m/2h   │
│ ├─ Lisa: Error handling [█░░░░░] 0.5h/3h   │
│ └─ Alex: Tests [░░░░░░] 0/4h (not started)│
│                                             │
│ 📊 Status:                                  │
│ ✅ 1 completed | 🔄 2 in progress | ⏳ 1 blocked
│                                             │
│ 🚨 Alerts:                                  │
│ • Alex's task blocked by Sarah's PR        │
│ • Sarah at 4/5 estimated capacity          │
│                                             │
│ 📞 Standup Summary:                        │
│ "On track. 2h remaining. 1 blocker: PR#42" │
│                                             │
└────────────────────────────────────────────┘
```

---

## Timeline & Milestones

### Week 1-2: Setup + GitHub Integration
- [ ] GitHub OAuth + API integration complete
- [ ] Daily report schema designed + database ready
- [ ] DailyReportModal UI built
- [ ] GitHub data ingestion tested with 3 test repos

**Deliverable:** Fully functioning "submit daily report" flow

### Week 3-4: Triage Engine
- [ ] Triage scoring algorithm implemented
- [ ] Claude API integration for impact analysis
- [ ] TriageList UI + interactive ranking
- [ ] IssueDetailPanel with reasoning

**Deliverable:** "Daily report → ranked triage results" flow

### Week 5-8: Orchestration & Approval
- [ ] Assignment recommendation algorithm
- [ ] OrchestrationPanel UI + approval flow
- [ ] GitHub issue sync (create + update)
- [ ] ExecutionDashboard with real-time updates
- [ ] Real-time polling of GitHub for external changes

**Deliverable:** Full "Triage → Approval → GitHub Sync → Dashboard" flow

### Week 9-12: Learning & Polish
- [ ] Learning pipeline (decision + outcome tracking)
- [ ] Metrics dashboard (accuracy, velocity, lead time)
- [ ] WeeklyReview UI for team reflection
- [ ] Error handling, edge cases, performance tuning
- [ ] Comprehensive testing (unit, integration, e2e)
- [ ] Documentation + onboarding flow

**Deliverable:** Production-ready orchestration system with learning loop

### Week 13-16: Beta & Iteration
- [ ] Internal team testing + bug fixes
- [ ] 50 beta user signups (engineering leaders)
- [ ] Weekly reviews + feature iterations based on feedback
- [ ] Case study documentation
- [ ] Prepare for Phase 2 (finance vertical design)

**Deliverable:** 500 teams signed up, $100K MRR, NPS 45+

---

## Success Metrics & KPIs

### Activation Metrics
| Metric | Target | How Measured |
|--------|--------|--------------|
| Signup completion rate | 85% | Users who complete GitHub OAuth |
| Daily report submission rate | 60% | % of signups submitting daily reports |
| First approval rate | 50% | % who approve first orchestration plan |
| GitHub integration adoption | 40% | % who enable GitHub sync |

### Engagement Metrics
| Metric | Target | How Measured |
|--------|--------|--------------|
| Weekly active users | 60% of paid | Users submitting report each week |
| Daily active users | 40% of paid | Users viewing dashboard daily |
| Report frequency | 5/week avg | Average submissions per user |
| Approval rate | 80% | % of orchestration plans approved |

### Quality Metrics
| Metric | Target | How Measured |
|--------|--------|--------------|
| Triage agreement | 80% | AI vs. leader ranking correlation |
| Assignment accuracy | 85% by M4 | % assigned engineers actually complete |
| Estimation error | ±25% | Predicted vs. actual hours |
| System uptime | 99.5% | API availability |
| Response time | <2s | P95 API latency |

### Retention Metrics
| Metric | Target | How Measured |
|--------|--------|--------------|
| Month-1 retention | 70% | % active at 30 days |
| Month-3 retention | 50% | % active at 90 days |
| Churn rate | <5%/month | % paying customers canceling |
| NPS | 45+ | Net Promoter Score survey |

### Revenue Metrics
| Metric | Target | Timeline |
|--------|--------|----------|
| MRR | $100K | By May 31 |
| ARPU | $200 | By May 31 |
| Paying teams | 500 | By May 31 |
| CAC | <$500 | By June (payback in 2.5 months) |

---

## Resource Plan

### Engineering Team (8-10 people)
- **Team Lead / Architect** (1) — Overall technical direction, GitHub integration
- **Backend Engineer** (2) — API, database, Claude integration, GitHub sync
- **Frontend Engineer** (2) — Dashboard UI, approval flows, real-time updates
- **ML/AI Engineer** (1) — Triage algorithm, learning pipeline, metrics
- **QA / Testing** (1) — Integration testing, edge cases, beta feedback
- **DevOps / Infrastructure** (1) — Database setup, deployment, monitoring

### Design (1-2 people)
- **Product Designer** (1) — UX/UI for all 4 features
- **Design Systems** (0.5) — Component library, design tokens

### Product (1)
- **Product Manager** (1) — Feature prioritization, beta user communication, roadmap

### Operations (0.5)
- **Launch Manager** (0.5) — Go-to-market, beta signup process, user communication

---

## Go-to-Market (Phase 1)

### Target Customer Profile
- **Role:** Engineering Leader (VP Eng, Engineering Manager, Tech Lead)
- **Team Size:** 5-50 engineers
- **Pain:** Spends 30-40% of time triaging bugs, planning work, tracking progress
- **Budget:** $200-500/month for tools
- **Motivation:** Ship more features, reduce operational overhead

### Acquisition Channels
1. **Product Hunt** (Week 1 of launch)
2. **Engineering community** (Hacker News, Dev.to, Engineering subreddits)
3. **Direct outreach** (500 target CTOs via LinkedIn)
4. **Referral** (1st customers → network)
5. **Content** (Blog posts: "How to 10x engineering velocity", "Intelligent issue triage")

### Onboarding Flow
1. **Sign up** → 2 min
2. **Connect GitHub** → OAuth flow
3. **First daily report** → Auto-populated from GitHub
4. **See triage** → Automatic ranking
5. **Approve orchestration** → 1-click workflow
6. **Dashboard** → Real-time execution view

**Goal:** From signup → first approved orchestration plan in <10 minutes

---

## Known Risks & Mitigations

### Risk 1: GitHub API Rate Limiting
**Impact:** Slow daily report population
**Mitigation:** Implement aggressive caching (1-hour TTL), batch API calls

### Risk 2: Triage Algorithm Accuracy
**Impact:** Leaders don't trust AI rankings
**Mitigation:** Show reasoning, allow manual override, collect feedback weekly

### Risk 3: Engineering Leaders Don't Approve Assignments
**Impact:** GitHub sync doesn't happen, system isn't useful
**Mitigation:** Make approval ultra-simple (1-click), explain reasoning clearly

### Risk 4: GitHub Changes Externally
**Impact:** Vesper state gets out of sync with GitHub
**Mitigation:** Webhook integration (GitHub → Vesper) + hourly reconciliation

### Risk 5: AI Learning Doesn't Work
**Impact:** System doesn't improve over time
**Mitigation:** Manual feedback loop (thumbs up/down), weekly metrics review, retraining every 2 weeks

### Risk 6: Team Burnout (4-month sprint)
**Impact:** Quality suffers, team leaves
**Mitigation:** Weekly sprints, prioritize ruthlessly, celebrate milestones, 1-week break after launch

---

## Next Steps (What To Do After Phase 1)

### Immediate (Week 17: June 1)
- [ ] Review Phase 1 results (500 teams, $100K MRR, NPS 45+)
- [ ] Conduct 20 user interviews (what worked, what didn't?)
- [ ] Document lessons learned (algorithm accuracy, user behavior, churn drivers)
- [ ] Celebrate launch 🎉

### Months 2-4 (June-August): Finance Vertical Design
- [ ] Research finance teams (CFOs, AP specialists, financial analysts)
- [ ] Identify unique integrations (QuickBooks, Stripe, Expensify, Bill.com)
- [ ] Design finance triage algorithm (impact different for invoices vs. bugs)
- [ ] Plan onboarding (land-and-expand from existing engineering customers)

### Months 5-6 (September-October): HR Vertical Design
- [ ] Research recruiting (Greenhouse, LinkedIn, candidate pipeline)
- [ ] Design HR triage (hiring pipeline, interview scheduling, offer coordination)
- [ ] Plan recruiting automation (auto-reach-out, scheduling, pipeline stages)

### By Year End (December 2026)
- [ ] Engineering: 500 teams, $100K MRR ✓
- [ ] Finance: 100 teams, $30K MRR (early adopters)
- [ ] HR/Recruiting: 50 teams, $15K MRR (beta)
- **Total: 650 teams, $145K MRR** (17% growth month-over-month)

---

## Appendix A: Engineering Tasks (Detailed)

### GitHub Integration (2 weeks)
- [ ] Set up GitHub App (OAuth client ID/secret)
- [ ] Implement OAuth flow (redirect → browser → callback)
- [ ] GitHub API client (Node.js library: `octokit`)
- [ ] Rate limit handling (cache, batch requests)
- [ ] Error handling (401, 403, 404, 500 errors)
- [ ] Test with 3 test repos + real GitHub orgs

### Triage Algorithm (3 weeks)
- [ ] Define Impact/Urgency/Complexity scoring (1-5, 1-5, 1-10)
- [ ] Implement Claude API calls (batch endpoints)
- [ ] Parse Claude response → triage scores
- [ ] Implement sorting + ranking
- [ ] Implement feedback loop (collect thumbs up/down)
- [ ] Unit tests for algorithm edge cases

### GitHub Sync (2 weeks)
- [ ] GitHub issue creation via REST API
- [ ] Labels, milestone, assignee management
- [ ] Comments with orchestration plan details
- [ ] Link related PRs
- [ ] Webhook integration for external GitHub changes
- [ ] Reconciliation (hourly sync to catch misses)

### Metrics & Learning (2 weeks)
- [ ] Database schema for decisions + outcomes
- [ ] Weekly metrics aggregation (accuracy, velocity, lead time)
- [ ] Dashboard for metrics visualization
- [ ] Retraining pipeline (improve algorithm weekly)
- [ ] Feedback collection UI (thumbs up/down on decisions)

---

## Appendix B: Database Schema (SQLite)

```sql
-- Workspaces
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  github_org_id TEXT,
  permission_mode TEXT DEFAULT 'ask',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

-- GitHub Integrations
CREATE TABLE github_integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  oauth_token TEXT NOT NULL ENCRYPTED,
  repos TEXT NOT NULL,  -- JSON array
  org_name TEXT,
  connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- Daily Reports
CREATE TABLE daily_reports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  date DATE NOT NULL,
  issues JSONB NOT NULL,
  pull_requests JSONB NOT NULL,
  errors JSONB NOT NULL,
  team_capacity JSONB NOT NULL,
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  UNIQUE(workspace_id, date)
);

-- Triage Results
CREATE TABLE triage_results (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  score FLOAT NOT NULL,
  impact INT NOT NULL,
  urgency INT NOT NULL,
  complexity INT NOT NULL,
  recommendation TEXT NOT NULL,
  decomposition JSONB,
  reasoning TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES daily_reports(id)
);

-- Orchestration Plans
CREATE TABLE orchestration_plans (
  id TEXT PRIMARY KEY,
  triage_result_id TEXT NOT NULL,
  assigned_engineer TEXT NOT NULL,
  estimated_hours FLOAT NOT NULL,
  dependencies TEXT NOT NULL,  -- JSON array
  github_issue_id TEXT,
  status TEXT DEFAULT 'recommended',
  approved_at DATETIME,
  synced_at DATETIME,
  completed_at DATETIME,
  FOREIGN KEY (triage_result_id) REFERENCES triage_results(id)
);

-- Learning Metrics
CREATE TABLE learning_metrics (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value FLOAT NOT NULL,
  week INT NOT NULL,
  year INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  UNIQUE(workspace_id, metric_name, week, year)
);

-- Feedback (on Triage + Orchestration quality)
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,  -- 'triage' or 'orchestration'
  entity_id TEXT NOT NULL,
  rating INT NOT NULL,  -- 1 (bad) to 5 (great)
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);
```

---

## Appendix C: Claude Prompts

### Triage Analysis Prompt
```
You are an engineering triage AI. Analyze the following issue and score it:

Issue Title: {title}
Description: {description}
Labels: {labels}
Related PRs: {related_prs}
Team Capacity: {capacity}

Score the following on a scale of 1-5:
1. Impact (how many users affected? how severe?):
2. Urgency (how time-sensitive?):
3. Complexity (how hard to fix?):

Also provide:
- Reasoning for each score
- 2-3 sentence summary of why this issue should be prioritized
- Suggested task decomposition (if complexity > 6)

Output JSON:
{
  "impact": <number>,
  "urgency": <number>,
  "complexity": <number>,
  "reasoning": "<text>",
  "summary": "<text>",
  "decomposition": ["<task1>", "<task2>", ...]
}
```

### Assignment Recommendation Prompt
```
Recommend the best engineer to fix this issue.

Issue: {title}
Estimated Hours: {hours}
Complexity: {complexity}
Team Members:
{team_members}

Consider:
- Who has fixed similar issues before?
- Who has capacity this week?
- Who is learning this skill area?

Output:
{
  "recommended_engineer": "<name>",
  "confidence": <0.0-1.0>,
  "reasoning": "<text>",
  "alternative_engineers": ["<name>", ...]
}
```

---

**Document Status:** Ready for engineering review
**Version:** 1.0
**Last Updated:** 2026-01-23
