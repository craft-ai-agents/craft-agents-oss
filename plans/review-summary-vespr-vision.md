# Vespr Vision Roadmap - Review Summary
## Three-Expert Assessment (DHH, Kieran, Simplicity Reviewers)

**Date:** 2026-01-23
**Document:** `plans/vision-vespr-knowledge-worker-platform-2026.md`
**Verdict:** EXCELLENT VISION, OVERAMBITIOUS ROADMAP — Requires significant scope cuts for realistic execution

---

## Key Themes Across All Reviews

### 🎯 What We Got Right
1. **Crystal clear target market** — "Non-technical knowledge workers" is specific and real
2. **Solid founding thesis** — "Delegation-first with transparency" is a genuine differentiator
3. **Thoughtful integration strategy** — Notion/Obsidian choices make sense for where knowledge workers live
4. **Understanding of the pain** — Research on knowledge worker productivity is grounded in real data

### ⚠️ What Needs Fixing
1. **Scope creep:** 20+ features in 12 months = unrealistic for 5-6 person team
2. **Speculative planning:** Phases 3-4 are built on assumptions, not customer demand
3. **Underestimated complexity:** Integrations (Notion, Obsidian) are much harder than stated
4. **Design bottleneck:** 1 designer for all phases will block velocity
5. **Missing fundamentals:** No analytics/metrics, unclear go-to-market, no team hiring plan

---

## Review Consensus: The Numbers

### DHH/37signals Review
**Rating:** 6/10 (vision 9/10, execution plan 4/10)

**Key Critique:**
- Trying to build "Notion + Slack + Claude Code + Notion + Perplexity" at once
- Should cut 60% of features and dominate one wedge
- Reframe as hypothesis testing, not prediction
- Need to say "no" to good ideas to do one thing great

**Recommendation:** Collapse Phases 1-2, focus on researchers only in Year 1, build based on customer feedback not roadmap

### Kieran/Pragmatic Review
**Rating:** 5/10 (vision 8/10, feasibility 3/10)

**Key Critique:**
- Phase 1 has 12-14 weeks of work, you have 8 weeks
- Visual Workspace alone = 4 weeks
- Notion/Obsidian integration = 40-60 days (2-3 engineers for 6+ weeks)
- Missing design capacity, QA, analytics infrastructure
- Intent Recognition is nice-to-have (defer to Q2)

**Recommendation:** Extend Phase 1 to 12 weeks, cut Intent Recognition, hire +1 designer NOW, focus on shipping MVP features

### Code Simplicity Review
**Rating:** 4/10 (vision 7/10, technical sustainability 2/10)

**Key Critique:**
- 3-4x data model growth required for Phases 3-4
- Session storage (JSONL) doesn't scale past 10K users
- Permission model needs redesign for team features
- Mobile app (Phase 4) breaks architecture, 80% rework needed
- Knowledge Graph adds 30-40% complexity for 15% value
- 1,500+ files by Phase 4 will be unmaintainable

**Recommendation:** Redesign roadmap with 2-3 phase structure, defer mobile/marketplace/graph, fix RBAC architecture in Phase 1

---

## Consolidated Recommendations

### IMMEDIATE ACTIONS (This Month)

**1. Extend Phase 1 Timeline**
- Current: 8 weeks (Jan 23 - Mar 31)
- Revised: 12 weeks (Jan 23 - May 15)
- Gives breathing room for quality

**2. Cut Phase 1 Scope Ruthlessly**
- ✅ SHIP: Onboarding (non-technical flow), Permission Modes UX, Session Templates (2 variants), Visual Workspace MVP
- ❌ DEFER: Intent Recognition, Real-time workspace updates, Obsidian integration, Email digests
- Rationale: Focus on what makes knowledge workers say "yes" (easy setup, visible progress, trustworthy)

**3. Hire +1 Designer Immediately**
- Current: 0.5 designers (split across projects)
- Needed: 1.5 designers (one full-time on Vespr)
- Risk: Design is critical path blocker for Visual Workspace

**4. Spike Critical Integrations (Weeks 1-2)**
- Notion API: What are the edge cases? Rate limits? Schema inference?
- Obsidian: Local-first architecture vs. agent writing back?
- Budget: 2-3 days, prevents major scope surprises

**5. Set Up Metrics & Analytics (Q1)**
- Track onboarding completion rate (target: 95%)
- Track session creation per user (adoption)
- Track integration adoption (by week)
- Track retention (week-2, month-1)
- Without this, can't validate roadmap assumptions

**6. Define ICP (Ideal Customer Profile)**
- Current roadmap targets "all knowledge workers"
- Need to niche: Researchers? PMs? Content creators? (pick one for Q1-Q2)
- Affects GTM, feature prioritization, positioning

---

### PHASE-BY-PHASE ROADMAP REVISION

#### Phase 1: Foundation (Q1, Jan-May) — "Make It Dead Simple"
**Duration:** 12 weeks (extended from 8) | **Team:** 5-6 engineers + 1.5 designers | **Goal:** 95% onboarding completion, 5 min to first task

**Features (Cut to MVP):**
1. ✅ Non-technical onboarding (single researcher flow, role variants in Phase 2)
2. ✅ Visual Workspace MVP (split-screen, static tabs, NO real-time)
3. ✅ Permission Modes UX (visual redesign, clear explanations)
4. ✅ Session Templates (2 templates: Research, Competitive Analysis)
5. ❌ DEFER: Intent Recognition, Real-time events, Obsidian integration

**Success Metrics:**
- 95% onboarding completion rate
- 50% of signed-up users create second session within 24h
- 100 beta researchers activated
- NPS 40+

**Deliverables:**
- Onboarding flow (all UX polished, copy tested)
- Visual workspace component library
- Updated permission mode selectors
- Session template system

---

#### Phase 1.5: Integration Readiness (May-June) — "Spike & Plan"
**Duration:** 4 weeks | **Team:** 2 engineers | **Goal:** Derisk Phase 2 integrations

**Work:**
1. **Notion API Deep Dive** (2 weeks)
   - Build proof-of-concept read/write
   - Document rate limits, permission model, error cases
   - Validate schema inference strategy
   - Design queueing system for rate limiting

2. **Obsidian Architecture Decision** (1 week)
   - Option A: Native integration (4-6 weeks, complex)
   - Option B: Obsidian plugin (partners with ecosystem, 2 weeks)
   - RECOMMEND: Option B (plugin model)

3. **Design RBAC & Multi-User Architecture** (1 week)
   - User identity model
   - Workspace roles (Owner, Editor, Viewer)
   - Permission inheritance
   - (Implementation deferred to Phase 2)

**Deliverables:**
- Notion integration POC + architecture doc
- Obsidian plugin design + partnership approach
- RBAC design doc (implementation roadmap)
- Updated Phase 2 scope based on learnings

---

#### Phase 2: Integration (Jun-Sep) — "Work Where Knowledge Lives"
**Duration:** 12 weeks | **Team:** 5-6 engineers | **Goal:** 30% Notion adoption, 15% Obsidian, real-time visibility

**Features (Focused scope):**
1. ✅ **Notion Integration (Deep)** (4-5 weeks)
   - OAuth, database read, database write with schema inference
   - Notion button triggers (start agent from Notion UI)
   - Error handling, rate limiting, permission bubbling

2. ✅ **Obsidian Plugin Partnership** (2-3 weeks) — IF not native integration
   - Help community build Vespr integration plugin
   - Or: Obsidian read-only integration (vault indexing)
   - Defer writing back to vault (Phase 2.5)

3. ✅ **Slack Integration (Basic)** (3-4 weeks)
   - Slash commands (/vespr research [query])
   - Async results posted to channel
   - DEFER: Message monitoring, scheduled digests

4. ✅ **Scheduled Reports** (moved from Phase 4) (2-3 weeks)
   - Cron-based research automation
   - Email/Slack delivery
   - DEFER: Monitoring/alerting (Phase 3)

5. ✅ **Real-Time Workspace Updates** (1-2 weeks)
   - WebSocket event streaming
   - Real-time Research tab updates
   - Pause/redirect controls

6. ❌ DEFER: Email digest (SendGrid can be used), Sources Marketplace, Team Workspaces

**Also:** Implement user identity system + basic RBAC foundation (design-to-code)

**Success Metrics:**
- 30% of users connect Notion
- 40% of tasks involve Notion read/write
- Slack integration in top 5 features used
- Retention: 60% week-2, 40% month-2

**Deliverables:**
- Notion integration (end-to-end)
- Slack integration (v1)
- Scheduled reports system
- Real-time workspace (full)
- User identity + RBAC implementation

---

#### Phase 2.5: Team Features (Sep-Oct) — "Let Teams Think Together"
**Duration:** 4 weeks (parallel with Phase 2 tail) | **Team:** 2-3 engineers | **Goal:** Enable lightweight team collaboration

**Features:**
1. ✅ **Team Workspaces** (2 weeks)
   - Invite teammates to workspace
   - Owner/Editor/Viewer roles
   - Shared session library
   - Lightweight (no real-time co-editing)

2. ✅ **Basic Audit Dashboard** (1 week)
   - Activity log (who did what, when)
   - No complex querying, just timeline

3. ❌ DEFER: Collaborative real-time editing, Annotations, Permission policies (Phase 3)

**Success Metrics:**
- 20% of users in team workspaces
- Average team size 3-5 members
- Audit log viewed by 30% of team admins

---

#### Phase 3: Team Leadership (Nov-Dec) — "Scale What Works"
**Duration:** 8 weeks | **Team:** 4-5 engineers | **Goal:** Prove team model, optimize integrations

**Features (Selective):**
1. ✅ **Collaborative Research Mode** (2-3 weeks)
   - Real-time updates when teammate adds findings
   - Shared knowledge base per team
   - Comment/annotate on findings
   - DEFER: Co-editing (too complex)

2. ✅ **Advanced Reasoning** (1-2 weeks)
   - Enhance agent prompts for hypothesis testing
   - Better audit trail/transparency
   - DEFER: As separate feature; integrate into core

3. ✅ **Scheduled Monitoring** (2-3 weeks)
   - Monitor conditions (competitor actions, prices)
   - Alert on changes (email, Slack, dashboard)
   - DEFER if time pressure

4. ❌ DEFER: Knowledge Graph (too complex, wait for real use cases), Mobile apps (Year 2), Marketplace (Year 2)

**Success Metrics:**
- 40% of team tasks are collaborative
- Monitoring setup by 50% of teams
- NPS 50+

---

#### Phase 4+: Expansion (2027+) — "Become the Standard"
**Defer these to Year 2:**
- Mobile apps (iOS/Android) — Only if 5K+ paying users
- Agent Marketplace — Build when 20+ custom agents exist organically
- Knowledge Graph — After team collaboration is solid
- Advanced Publishing — Notion/Obsidian Publish integration

**Rationale:** These features are 30-40% of implementation cost but only 15% of value in Year 1. Focus on depth (being incredibly good for researchers + Notion users) rather than breadth.

---

## Scope Comparison: Original vs. Recommended

### Original Roadmap
- Phase 1: 5 major features
- Phase 2: 5 major features
- Phase 3: 5 major features
- Phase 4: 5 major features
- **Total: 20 features, speculative phases, team exhaustion risk**

### Recommended Roadmap
- Phase 1: 4 features (8 weeks) + 1 redesign
- Phase 1.5: 2 spikes (4 weeks)
- Phase 2: 5 features (12 weeks), well-resourced
- Phase 2.5: 2 features (4 weeks), lightweight
- Phase 3: 3 features (8 weeks), validated demand
- Phase 4+: Defer (Year 2)
- **Total: 12-15 features in Year 1 (ship well), rest in Year 2 (based on customer demand)**

---

## Critical Success Factors (According to Reviews)

### DHH's Take
1. **Pick one wedge and own it** (researchers, not everyone)
2. **Build deep, not broad** (Notion integration done amazingly, not Notion + Obsidian + Slack)
3. **Ship incrementally** (Phase 1 → get users → Phase 2 from feedback)
4. **Say no ruthlessly** (good ideas aren't good enough)
5. **Focus on simplicity** (non-technical means invisible complexity)

### Kieran's Take
1. **Get design capacity** (hiring +1 designer is blocker)
2. **Realistic timelines** (12 weeks Phase 1, not 8)
3. **Owner per feature** (no shared ownership, clear accountability)
4. **Ship every 2 weeks** (get feedback fast)
5. **Kill scope creep** (MVP mentality, not "nice to have")

### Simplicity's Take
1. **Design data model first** (RBAC, multi-user, scaling)
2. **Fix JSONL storage** (becomes bottleneck at 10K users)
3. **Defer mobile until Year 2** (80% rework, not worth it yet)
4. **Obsidian as plugin, not native** (lower complexity)
5. **Simplify Knowledge Graph away** (complexity for unknown value)

---

## What Stays, What Changes, What's Cut

### ✅ KEEP UNCHANGED
- Product vision statement ("Respects intelligence, transparent, integrated, accessible")
- Target market (non-technical knowledge workers)
- Positioning (delegation-first, not chat-first)
- Key differentiator (visual workspace + real-time visibility)
- Go-to-market approach (researchers → PMs → enterprises)

### 🔄 CHANGE/REDESIGN
- Roadmap timeline (extend Phase 1 to 12 weeks)
- Roadmap scope (cut 40% of features, focus on quality)
- Architecture decisions (RBAC, multi-user model design)
- Team structure (hire +1 designer, +1 engineer minimum)
- Metrics/analytics (add upfront, not afterthought)

### ❌ CUT OR DEFER
- Intent Recognition (use Claude API, not custom)
- Obsidian native integration (become plugin partner)
- Email digest (Phase 3, use SendGrid)
- Sources Marketplace (Phase 3+, too much product mgmt)
- Team Workspaces Phase 3 (move to Phase 2.5 as lightweight)
- Collaborative real-time editing (Phase 3+, async-first)
- Knowledge Graph (defer 6+ months, wait for use cases)
- Mobile apps (defer to 2027, only if 5K+ users)
- Agent Marketplace (defer to 2027, build organically first)

---

## Implementation Next Steps

### Immediate (This Week)
- [ ] Schedule team planning session with reviews
- [ ] Make final scope cuts (which features drop from Phase 1?)
- [ ] Update roadmap document with final scope
- [ ] Commit to extended Phase 1 timeline (May 31, not Mar 31)
- [ ] Create job description for +1 designer

### Next 2 Weeks (By Feb 6)
- [ ] Complete integration spikes (Notion, Obsidian, architecture design)
- [ ] Hire designer (internal or contractor)
- [ ] Set up analytics/metrics dashboards
- [ ] Brief team on scope changes
- [ ] Create detailed Phase 1 task breakdown (by owner)

### February (Weeks 1-4)
- [ ] Finalize onboarding flow (copy, design, testing)
- [ ] Build permission modes UX
- [ ] Create session templates
- [ ] Begin visual workspace implementation

### March-May
- [ ] Finish Phase 1 features
- [ ] Beta test with 50-100 researchers
- [ ] Validate integration approach with customer feedback
- [ ] Prepare Phase 2 kickoff

---

## Communication & Alignment

### For the Team
**Message:** "We have an excellent vision. We're getting real with the execution plan. Instead of shipping 20 features mediocrely, we're shipping 5 features amazingly. This means we'll dominate the researchers segment by May, then expand based on what customers ask for."

**What changes:**
- More time for Phase 1 (quality over speed)
- Hire one more designer (design is critical path)
- Cut scope ruthlessly (no "nice to have" features)
- Focus on customer feedback (not roadmap prediction)

### For Investors/Stakeholders
**Message:** "The original roadmap was ambitious. After expert review, we're being strategic about scope. We'll hit milestones faster by focusing narrowly: own researchers, then expand. This reduces risk and increases execution quality."

**Updated metrics:**
- Q1 End: 95% onboarding, 100 beta researchers, NPS 40+
- Q2 End: 30% Notion, 40% retention, $50K MRR
- Q3 End: 20% teams, 60% retention, $150K MRR
- Q4 End: Validation only (market leadership positioning)

---

## Summary: The Path Forward

**The vision is solid. The original roadmap was speculative.** By following the recommendations:

1. **You'll ship Phase 1 better** (12 weeks of focus vs. 8 weeks of rushing)
2. **You'll learn from customers** (Q1-Q2 feedback shapes Phase 3-4)
3. **You'll maintain quality** (code doesn't decay into 1,500+ unmaintainable files)
4. **You'll dominate researchers** (deep Notion integration, visual workspace, trust)
5. **You'll expand with evidence** (team features when teams ask for them, not before)

**The hardest part isn't building Vespr. It's saying "no" to building mobile, knowledge graph, and marketplace in Year 1.**

But that's the 37signals way, and it works.

---

**Review Authors:**
- @agent-dhh-rails-reviewer: Simplicity, constraints, opinionated defaults
- @agent-kieran-rails-reviewer: Pragmatic shipping, velocity, team capacity
- @agent-code-simplicity-reviewer: Technical sustainability, architecture, complexity

**Review Date:** 2026-01-23
**Status:** Ready for implementation
