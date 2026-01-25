# Claude Tasks Collaboration Guide

## Overview

Sprint tasks are organized as Claude Tasks (similar to a task list like "groceries") that can be referenced by multiple Claude agents for autonomous multi-agent collaboration on Vesper development.

## Environment Variables

Source the task list variables before running Claude Code sessions:

```bash
# Load Sprint task environment
source .env.sprint

# View current sprint
echo $CURRENT_SPRINT
echo $CURRENT_SPRINT_TASK_LIST

# Use in agent instructions
export SPRINT_TASK_LIST="$CLAUDE_CODE_TASK_LIST_ID_SPRINT2"
```

## Task List Format

All tasks are stored in JSON format in `/sprints/SPRINT{N}_TASKS.json`

### Task ID Convention

- **B1-B5**: Backend tasks
- **F1-F5**: Frontend tasks
- **D1-D3**: Design tasks
- **ML1-ML2**: ML/AI tasks
- **QA1-QA2**: QA/Testing tasks
- **DOCS1-DOCS4**: Documentation tasks

### Task Structure

```json
{
  "id": "B1",
  "title": "Task Title",
  "description": "Detailed description",
  "effort_hours": 16,
  "dependencies": ["B0", "F1"],
  "subtasks": [
    {
      "id": "B1.1",
      "title": "Subtask title",
      "files": ["path/to/file.ts"],
      "acceptance_criteria": ["Criterion 1", "Criterion 2"]
    }
  ],
  "acceptance_criteria": ["Task completion criteria"]
}
```

## Multi-Agent Collaboration Workflow

### 1. Agent Initialization

```bash
# In Claude Code session, load sprint tasks
export CLAUDE_CODE_TASK_LIST_ID=intelligent-triage-engine-sprint2
cat sprints/SPRINT2_TASKS.json | jq '.backend_tasks'
```

### 2. Task Assignment Pattern

Agents declare their focus area in PRs and commits:

```bash
# Example: Backend Agent working on B1
git commit -m "feat(triage): B1 - Implement Claude API integration with batching

- Creates TriageService class
- Batches 20 issues per API call
- Adds extended thinking mode

@TASK(B1:in_progress)
@DEPENDS(B2:pending)
"
```

### 3. Dependency Management

Before starting a task, check its dependencies:

```bash
# View task dependencies
jq '.backend_tasks[] | select(.id=="B4") | .dependencies' sprints/SPRINT2_TASKS.json
# Output: ["B3"]

# This task (B4) depends on B3 being complete
```

### 4. Real-Time Coordination

Use task status in PR descriptions for visibility:

```markdown
## Sprint 2 Task Progress

### Backend Tasks
- [x] B1: Claude API Integration (50% complete)
- [x] B2: Scoring Algorithm (100% complete)
- [ ] B3: Triage Storage
- [ ] B4: IPC Handlers
- [ ] B5: Batch Processor

### Blockers
- Waiting for B3 before starting B4

### Next Steps
- Complete B3 by EOD
- Start B4 once B3 PR merged
```

## Using Task Lists in Agent Instructions

### For Backend Agent

```
You are the backend development agent for Sprint 2.
Your tasks are: B1, B2, B3, B4, B5

Use this task list: sprints/SPRINT2_TASKS.json
Focus on backend_tasks array.

Current priority: B1 (Claude API Integration)
Dependencies to wait for: None (start immediately)

For each task:
1. Read acceptance_criteria
2. Implement subtasks in order
3. Run tests
4. Commit with @TASK(id:status)
5. Mark complete in task list
```

### For Frontend Agent

```
You are the frontend development agent for Sprint 2.
Your tasks are: F1, F2, F3, F4, F5

Use this task list: sprints/SPRINT2_TASKS.json
Focus on frontend_tasks array.

Current priority: F1 (Triage List Component)
Blockers: Waiting for B4 (IPC handlers) to be complete

Wait for B4 completion before starting F1.
Once B4 is complete:
1. Read F1 acceptance_criteria
2. Implement subtasks
3. Write component tests
4. Commit with @TASK(F1:in_progress)
```

## Task Status Tracking

### Status Levels

- **pending**: Not started, dependencies may be blocking
- **in_progress**: Currently being worked on
- **review**: PR submitted, waiting for review
- **complete**: Merged and verified

### Updating Task Status

#### Option 1: Commit Message Convention

```bash
git commit -m "feat(triage): B1 - Implement Claude API integration

Description of changes...

@TASK(B1:complete)
@DEPENDS(B2:pending, B3:pending)
"
```

#### Option 2: PR Description

```markdown
## Tasks Affected

@TASK(B1:in_progress)
@TASK(B2:in_progress)

## Blockers
- None currently

## Unblocks
- F1 (Frontend Triage List) - waiting for B4
```

#### Option 3: Update Task JSON (For Tracking)

```bash
# Mark task as in_progress
jq '.backend_tasks[] | select(.id=="B1") |= . + {status:"in_progress"}' \
  sprints/SPRINT2_TASKS.json > sprints/SPRINT2_TASKS.json.tmp && \
  mv sprints/SPRINT2_TASKS.json.tmp sprints/SPRINT2_TASKS.json

git add sprints/SPRINT2_TASKS.json
git commit -m "docs: update task status - B1 in_progress"
```

## Parallel Work Strategy

### Day 1-2: Design Phase (Parallel)

```
Backend Agent          Design Agent           QA Agent
├─ B1 (50%)           ├─ D1 (30%)           └─ Prep QA environment
├─ B2 (100%)          ├─ D2 (30%)
└─ Review ML1         └─ D3 (30%)

Frontend Agent         ML Agent
└─ Waiting for B4     ├─ ML1 (30%)
                      └─ ML2 (prep)
```

### Day 3-7: Implementation Phase (Dependent)

```
B1 → B3 ─┐
         ├─→ B4 ─→ F1 ─→ F3
B2 ──────┘         ├─→ F2
                   └─→ F4 ─→ F5
D1, D2, D3 complete → handed off to F1, F2, F3
ML1 → validation → ML2 complete
```

### Day 8-10: Testing & Polish

```
QA1 (E2E tests)
  ↓
QA2 (UAT with beta users)
  ↓
DOCS1-4 (Documentation)
  ↓
Final PR merge ready
```

## Coordination Patterns

### Pattern 1: Task Dependency Chain

When one task depends on another:

```bash
# Backend agent notifies frontend:
git commit -m "feat(triage): B4 - Implement IPC handlers

Ready for frontend integration.

@TASK(B4:complete)
@UNBLOCKS(F1)
"

# Frontend agent sees this and can start:
git commit -m "feat(triage): F1 - Create triage list component

@TASK(F1:in_progress)
@DEPENDS(B4:complete)
"
```

### Pattern 2: Parallel Code Reviews

```bash
# Each agent can create PRs independently
# PR titles make dependencies clear:

B1 PR: "feat(triage): B1 - Claude API integration"
B2 PR: "feat(triage): B2 - Scoring algorithm"
B3 PR: "feat(triage): B3 - Storage layer (depends on B2)"

# Can be reviewed and merged in parallel if no conflicts
```

### Pattern 3: Blocking Issues

If one task needs to wait for another:

```markdown
## Blocked Tasks

### F1: Triage List Component
- **Blocked by:** B4 (IPC Handlers)
- **Estimated unblock:** Feb 10, 2pm
- **Workaround:** Use mock IPC responses while waiting

### F2: Detail Panel
- **Blocked by:** F1 (data flow from list)
- **Estimated unblock:** Feb 12, 12pm
- **Parallel work:** Design / styling / tests
```

## Cross-Agent Communication

### Status Update Pattern

```
Every 24 hours, post status in sprint tracking:

Backend Agent Status:
  ✅ B1 (50%) - Claude integration batching
  ✅ B2 (100%) - Scoring formula done
  ⏳ B3 (20%) - Storage layer started
  🚫 B4 blocked - waiting for B3

Frontend Agent Status:
  🚫 F1 blocked - waiting for B4
  📋 F2 design in progress

ML Agent Status:
  ✅ ML1 (70%) - Prompt engineering
  ⏳ ML2 - ready to start

Blockers:
  - B3 completion blocks frontend start
```

### Hand-off Communication

When completing a task that unblocks others:

```bash
git commit -m "feat(triage): B4 - Complete IPC handlers

Summary:
- ✅ Implements github:getStatus
- ✅ Implements report:create
- ✅ Implements triage:run
- ✅ Tests passing (15/15)

Unblocks:
- F1 (Triage List) - ready to start
- F2 (Detail Panel) - ready to start
- F3 (Dashboard) - ready to start

CC: @frontend-agent - you're unblocked!

@TASK(B4:complete)
@UNBLOCKS(F1, F2, F3)
"
```

## Troubleshooting Multi-Agent Conflicts

### Merge Conflict Prevention

1. **Different agents work on different files**
   - Backend: `packages/shared/src/triage/*`
   - Frontend: `apps/electron/src/renderer/components/orchestration/*`

2. **Coordinate shared file changes**
   - If both need to modify `atoms/triage.ts`:
   - Backend agent creates atoms
   - Frontend agent only reads them

3. **Use feature branches**
   ```bash
   # Clear branch naming prevents conflicts
   backend/B1-claude-integration
   frontend/F1-triage-list
   design/D1-score-visualization
   ```

### If Conflicts Occur

```bash
# 1. Identify conflicting commits
git log --oneline --decorate

# 2. Communicate via commit message
git commit -m "fix: resolve merge conflict in atoms/triage.ts

Merged F1 and B1 changes:
- B1 added scoring atoms
- F1 added result atoms

Solution: Combined atoms in single file

@RESOLVED(conflict:atoms/triage.ts)
"

# 3. Ensure tests still pass
bun test

# 4. Push and notify other agent
```

## Quick Reference

### View All Sprint 2 Tasks

```bash
# Show all tasks
cat sprints/SPRINT2_TASKS.json | jq '.[] | keys'

# Show backend tasks
cat sprints/SPRINT2_TASKS.json | jq '.backend_tasks[] | {id, title, effort_hours}'

# Show dependencies for a task
cat sprints/SPRINT2_TASKS.json | jq '.backend_tasks[] | select(.id=="B4") | .dependencies'

# Show team assignments
cat sprints/SPRINT2_TASKS.json | jq '.team_assignments'
```

### Load Task in Local Context

```bash
# Extract task details for reference
TASK_ID="B1"
jq ".backend_tasks[] | select(.id==\"$TASK_ID\")" sprints/SPRINT2_TASKS.json

# Export as environment variable for agent context
export CURRENT_TASK=$(jq -r ".backend_tasks[] | select(.id==\"$TASK_ID\") | .title" sprints/SPRINT2_TASKS.json)
echo "Working on: $CURRENT_TASK"
```

## Next Sprints

Task lists are available for all 8 sprints:

```bash
# View all available sprints
cat .env.sprint | grep CLAUDE_CODE_TASK_LIST

# Load a future sprint
export SPRINT_TASK_LIST=$CLAUDE_CODE_TASK_LIST_ID_SPRINT3
cat sprints/SPRINT3_TASKS.json
```

---

**Last Updated:** January 23, 2026
**Current Sprint:** Sprint 2 (Intelligent Triage Engine)
**Task List Format Version:** 1.0