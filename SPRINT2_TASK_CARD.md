# Sprint 2: Intelligent Triage Engine - Quick Task Card

**Timeline:** Feb 6-19, 2026 (10 working days)
**Goal:** AI-powered triage with ranked "Top 10 things to do today"
**Success Metric:** 80%+ agreement with human triage, <60s for 50 issues

---

## 🎯 Quick Overview

```
Input:  Daily Report with GitHub Issues
         ↓
    Claude API Scoring
         ↓
  Output: Ranked Issues (1-10)
```

**50 Total Story Points**
- Backend: 16h
- Frontend: 16h
- Design: 8h
- ML/AI: 8h
- QA: 16h
- Docs: 4h

---

## 🔧 Backend Tasks (16 hours)

| ID | Task | Hours | Status | Next Step |
|----|------|-------|--------|-----------|
| **B1** | Claude API Integration | 16 | [ ] pending | Create TriageService class |
| **B2** | Scoring Algorithm | 8 | [ ] pending | Design formula (Impact × Urgency / Complexity) |
| **B3** | Triage Storage | 8 | [ ] depends(B2) | JSONL persistence layer |
| **B4** | IPC Handlers | 8 | [ ] depends(B3) | 3 new IPC channels |
| **B5** | Batch Processor | 8 | [ ] depends(B1) | Process 20 issues/call |

### Start Here: B1
```
Create: packages/shared/src/triage/claude-scorer.ts
- TriageService class
- Batch 20 issues per call
- Use extended thinking mode
- Return ScoredIssue[]
```

**Dependencies:** None - start immediately
**Unblocks:** B5, F1, F2, F3

---

## 🎨 Frontend Tasks (16 hours)

| ID | Task | Hours | Status | Next Step |
|----|------|-------|--------|-----------|
| **F1** | Triage List Component | 16 | [ ] depends(B4) | Display ranked issues |
| **F2** | Issue Detail Panel | 16 | [ ] depends(F1) | Show AI reasoning |
| **F3** | Triage Dashboard | 16 | [ ] depends(F1,F2) | Home view + Run button |
| **F4** | Progress Updates | 8 | [ ] depends(F3) | Real-time progress bar |
| **F5** | Jotai Atoms | 4 | [ ] pending | State management |

### Start with F5 (parallelizable)
```
Create: apps/electron/src/renderer/atoms/triage.ts
- triageResultsAtom
- triageLoadingAtom
- triageProgressAtom
- selectedIssueAtom
```

**Dependencies:** None - start immediately
**Unblocks:** F1, F2, F3

### Then F1 (when B4 complete)
```
Create: apps/electron/src/renderer/components/orchestration/TriageList.tsx
- Show issues ranked by score
- Color-coded badges (impact/urgency/complexity)
- Click to show detail panel
```

---

## 🎯 Design Tasks (8 hours)

| ID | Task | Hours | Status |
|----|------|-------|--------|
| **D1** | Score Visualization | 8 | [ ] pending |
| **D2** | Detail Panel Design | 8 | [ ] pending |
| **D3** | Dashboard Layout | 8 | [ ] pending |

### Deliverables
- Score badge designs (blue/orange/purple)
- Issue list row layout
- Detail panel mockup
- Dashboard home view
- Run triage modal

---

## 🧠 ML/AI Tasks (8 hours)

| ID | Task | Hours | Status |
|----|------|-------|--------|
| **ML1** | Design Scoring Prompt | 16 | [ ] pending |
| **ML2** | Validate Algorithm | 8 | [ ] pending |

### ML1 Deliverables
- Scoring prompt for Claude
- Manually score 20 test issues
- A/B test 3 prompt variants
- Pick best version

**Target:** 80%+ agreement with manual scoring

---

## ✅ QA/Testing Tasks (16 hours)

| ID | Task | Hours | Status |
|----|------|-------|--------|
| **QA1** | E2E Testing | 16 | [ ] pending |
| **QA2** | Beta UAT | 16 | [ ] pending |

### QA1: Complete E2E
```
Daily Report → Run Triage → Verify Results
- Progress updates work
- Error handling robust
- Performance <60s for 50 issues
```

### QA2: User Testing
- 10+ beta users
- 1-week testing window
- Feedback collection
- 80%+ agreement target

---

## 📚 Documentation (4 hours)

| ID | Task |
|----|------|
| **DOCS1** | Algorithm explanation |
| **DOCS2** | Claude integration guide |
| **DOCS3** | User feature guide |
| **DOCS4** | Quick start guide |

---

## 📅 Sprint Timeline

### Week 1 (Feb 6-10)
- ✅ B1: 50% complete
- ✅ B2: 100% complete
- ✅ ML1: 50% complete
- ✅ D1-D3: Mockups approved
- ✅ F5: Atoms complete

### Week 2 (Feb 13-19)
- ✅ All backend complete
- ✅ All frontend complete
- ✅ QA1 passing
- ✅ UAT ready
- ✅ Documentation complete

---

## 🚦 Critical Path

```
Day 1-2:   B1 start          ML1 prompt           D1-D3 designs
Day 3-4:   B1 complete       B2 start             F5 atoms
Day 5-6:   B3 start          B2 complete          F1 start (blocks)
Day 7-8:   B4 start (B3✓)    F2 start (F1✓)       F3 start
Day 9-10:  QA1 E2E test      QA2 UAT begins       Docs complete
```

---

## 🎯 Success Criteria

### Code Quality
- [ ] 100% TypeScript strict mode
- [ ] 80%+ test coverage
- [ ] All tests passing

### Feature Quality
- [ ] 80%+ agreement with human triage
- [ ] Triage completes in <60s for 50 issues
- [ ] AI reasoning is coherent
- [ ] Beta users find feature "useful"

### Performance
- [ ] API calls <2s P95
- [ ] UI remains responsive
- [ ] Memory stable (no leaks)

---

## 💾 Environment Variables

```bash
# Load Sprint 2 tasks
source .env.sprint

# Current sprint
echo $CURRENT_SPRINT  # Should be "2"
echo $CURRENT_SPRINT_TASK_LIST  # intelligent-triage-engine-sprint2
```

---

## 🔗 Task References in Commits

Use this format in commits:

```bash
git commit -m "feat(triage): B1 - Implement Claude API integration

- Batch 20 issues per call
- Extended thinking mode
- Rate limiting + backoff

@TASK(B1:in_progress)
@DEPENDS(B2:pending)
"
```

---

## 📖 Full Documentation

- **Detailed tasks:** `sprints/SPRINT2_TASKS.json`
- **Collaboration guide:** `docs/CLAUDE_TASKS_COLLABORATION.md`
- **GitHub integration (Sprint 1):** `docs/SPRINT1_IMPLEMENTATION_GUIDE.md`

---

## 🆘 Questions?

Check:
1. `sprints/SPRINT2_TASKS.json` - Full task details
2. `docs/CLAUDE_TASKS_COLLABORATION.md` - Collaboration patterns
3. `docs/SPRINT1_IMPLEMENTATION_GUIDE.md` - Architecture reference

---

**Last Updated:** January 23, 2026
**Sprint Status:** 🟢 Ready to start Feb 6