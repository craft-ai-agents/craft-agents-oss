# Task Lists Manual Testing Guide

Comprehensive manual testing instructions for the task list system in Vesper.

---

## Table of Contents

1. [Test Environment Setup](#test-environment-setup)
2. [Pre-Requisites](#pre-requisites)
3. [Test Data Setup](#test-data-setup)
4. [Test Cases](#test-cases)
   - [Task List CRUD Operations](#task-list-crud-operations)
   - [Task CRUD Operations](#task-crud-operations)
   - [Batch Task Creation](#batch-task-creation)
   - [Task Dependencies](#task-dependencies)
   - [Session Integration](#session-integration)
   - [Ralph Loop Integration](#ralph-loop-integration)
   - [IPC Handler Validation](#ipc-handler-validation)
   - [Error Handling](#error-handling)
   - [Edge Cases](#edge-cases)
5. [Regression Test Checklist](#regression-test-checklist)
6. [Performance Test Scenarios](#performance-test-scenarios)

---

## Test Environment Setup

### System Requirements

- macOS (Darwin) operating system
- Node.js/Bun runtime installed
- Vesper application installed and configured
- Terminal access for command-line operations

### Initial Configuration

1. **Backup Existing Data**
   ```bash
   # Backup existing task lists (if any)
   cp -r ~/.vesper/task-lists ~/.vesper/task-lists.backup.$(date +%Y%m%d-%H%M%S)
   ```

2. **Clean Test Environment**
   ```bash
   # Remove all existing test task lists
   rm -rf ~/.vesper/task-lists/*.json
   # Note: Do NOT delete the directory itself
   ```

3. **Verify Storage Directory**
   ```bash
   # Ensure directory exists
   mkdir -p ~/.vesper/task-lists
   # Check permissions
   ls -la ~/.vesper/task-lists
   ```

4. **Enable Debug Logging** (Optional)
   ```bash
   # Set environment variable for verbose logging
   export VESPER_DEBUG=1
   # Check logs at ~/Library/Logs/Vesper/
   ```

---

## Pre-Requisites

### Required Knowledge

- Basic understanding of task list concepts (pending/in_progress/completed)
- Familiarity with Vesper's workspace and session structure
- Knowledge of Ralph Loop for autonomous workflows
- Understanding of file-based locking mechanisms

### Test User Permissions

- Read/write access to `~/.vesper/` directory
- Ability to create and delete files
- No admin privileges required

### Tools Needed

- Text editor for inspecting JSON files
- Terminal for running commands
- Vesper desktop application

---

## Test Data Setup

### Sample Task Lists

Create these sample task lists for testing:

**Test List 1: Small List (3 tasks)**
- Name: "Sprint 1 - Authentication"
- Description: "User authentication features"
- Tasks:
  1. "Implement login endpoint"
  2. "Implement logout endpoint"
  3. "Add password reset flow"

**Test List 2: Large List (20+ tasks)**
- Name: "Feature Rollout - Dashboard"
- Description: "Complete dashboard implementation"
- Tasks: 20+ varied tasks with different statuses

**Test List 3: Empty List**
- Name: "Future Planning"
- Description: "Tasks to be added later"
- Tasks: None

### Sample PRD for Ralph Loop

Create a test PRD file `test-prd.md`:

```markdown
# Test PRD - User Management

## Stories

- [ ] Implement user registration API
- [ ] Add email verification flow
- [ ] Create user profile page
- [ ] Implement user settings
- [ ] Add account deletion feature
```

---

## Test Cases

### Task List CRUD Operations

#### TC-TL-001: Create Task List with Valid Name

**Objective:** Verify task list creation with valid name and description.

**Steps:**
1. Open Vesper application
2. Navigate to task lists section (or use IPC call `task-lists:create`)
3. Create new task list:
   - Name: "Test List Alpha"
   - Description: "Testing task list creation"
4. Click Create/Submit

**Expected Results:**
- Task list created successfully
- Task list appears in list view
- File created at `~/.vesper/task-lists/{uuid}.json`
- Task list has empty tasks array
- `createdAt` and `updatedAt` timestamps are set
- Task list ID is a valid UUID

**Verification:**
```bash
# Check file exists
ls ~/.vesper/task-lists/
# Inspect JSON structure
cat ~/.vesper/task-lists/{id}.json | jq
```

**Pass/Fail Criteria:**
- PASS: Task list created, file exists with correct structure
- FAIL: Error thrown, file not created, or invalid structure

---

#### TC-TL-002: Create Task List without Description

**Objective:** Verify task list creation works without optional description.

**Steps:**
1. Create new task list with only name: "Minimal List"
2. Leave description field empty
3. Submit

**Expected Results:**
- Task list created successfully
- `description` field is undefined (not present in JSON)
- All other fields are valid

**Pass/Fail Criteria:**
- PASS: Task list created with undefined description
- FAIL: Error or description set to empty string

---

#### TC-TL-003: Create Task List with Whitespace Name

**Objective:** Verify whitespace trimming in task list names.

**Steps:**
1. Create task list with name: "  Spaces Everywhere  "
2. Submit

**Expected Results:**
- Task list created with trimmed name: "Spaces Everywhere"
- No leading or trailing whitespace

**Verification:**
```bash
# Check trimmed name
cat ~/.vesper/task-lists/{id}.json | jq .name
```

**Pass/Fail Criteria:**
- PASS: Name is trimmed correctly
- FAIL: Whitespace preserved

---

#### TC-TL-004: Create Task List with Empty Name

**Objective:** Verify validation for empty task list names.

**Steps:**
1. Attempt to create task list with empty name: ""
2. Submit

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `INVALID_INPUT`
- Error message: "Task list name is required"
- No file created

**Pass/Fail Criteria:**
- PASS: Error thrown, no file created
- FAIL: Task list created or wrong error

---

#### TC-TL-005: Create Task List with Long Name (>200 chars)

**Objective:** Verify name length validation.

**Steps:**
1. Create task list with name longer than 200 characters
2. Submit

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `INVALID_INPUT`
- Error message: "Task list name too long (max 200 chars)"

**Pass/Fail Criteria:**
- PASS: Error thrown with correct message
- FAIL: Task list created or wrong error

---

#### TC-TL-006: Load Existing Task List

**Objective:** Verify task list loading by ID.

**Steps:**
1. Create a task list
2. Note the task list ID
3. Load the task list using `loadTaskList(id)`

**Expected Results:**
- Task list returned with all fields
- Tasks array is present (empty or populated)
- All metadata matches file contents

**Pass/Fail Criteria:**
- PASS: Task list loaded successfully
- FAIL: Null returned or error thrown

---

#### TC-TL-007: Load Non-Existent Task List

**Objective:** Verify handling of missing task lists.

**Steps:**
1. Attempt to load task list with non-existent ID: "non-existent-123"

**Expected Results:**
- `null` returned (not an error)
- No error thrown

**Pass/Fail Criteria:**
- PASS: Returns null without error
- FAIL: Error thrown or undefined returned

---

#### TC-TL-008: List All Task Lists

**Objective:** Verify task list listing with metadata.

**Steps:**
1. Create 3 task lists with different names
2. Add tasks to one of them
3. Call `listTaskLists()`

**Expected Results:**
- Returns `TaskListMeta[]` array
- Length is 3
- Each entry has: id, name, description, taskCount, pendingCount, inProgressCount, completedCount, createdAt, updatedAt
- Lists sorted by most recently updated first
- Task counts are accurate

**Verification:**
```bash
# Check all task lists
ls -lt ~/.vesper/task-lists/*.json | head
```

**Pass/Fail Criteria:**
- PASS: All lists returned with correct metadata
- FAIL: Missing lists, incorrect counts, or wrong sort order

---

#### TC-TL-009: Delete Task List

**Objective:** Verify task list deletion.

**Steps:**
1. Create a task list
2. Note the ID
3. Delete the task list using `deleteTaskList(id)`
4. Attempt to load the deleted list

**Expected Results:**
- Delete operation succeeds
- File removed from `~/.vesper/task-lists/`
- Loading the list returns `null`

**Verification:**
```bash
# Verify file deleted
ls ~/.vesper/task-lists/{id}.json  # Should error: No such file
```

**Pass/Fail Criteria:**
- PASS: File deleted, load returns null
- FAIL: File still exists or error thrown

---

#### TC-TL-010: Delete Non-Existent Task List (Idempotent)

**Objective:** Verify idempotent delete behavior.

**Steps:**
1. Attempt to delete non-existent task list ID

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `NOT_FOUND`
- Error message: "Task list not found"

**Note:** IPC handler treats NOT_FOUND as success (idempotent), but storage layer throws error.

**Pass/Fail Criteria:**
- PASS: Error thrown from storage layer
- FAIL: No error or different error code

---

### Task CRUD Operations

#### TC-T-001: Create Task with Required Fields

**Objective:** Verify basic task creation.

**Steps:**
1. Create a task list
2. Create task with:
   - Subject: "Implement login endpoint"
   - Description: "Create POST /api/auth/login endpoint"
3. Submit

**Expected Results:**
- Task created successfully
- Task added to task list's tasks array
- Task has:
  - Unique ID (UUID)
  - Subject and description as provided
  - `activeForm` defaults to subject
  - Status: "pending"
  - Empty blocks and blockedBy arrays
  - Valid timestamps

**Verification:**
```bash
# Check task in list
cat ~/.vesper/task-lists/{task-list-id}.json | jq '.tasks[0]'
```

**Pass/Fail Criteria:**
- PASS: Task created with correct defaults
- FAIL: Error or incorrect fields

---

#### TC-T-002: Create Task with Custom Active Form

**Objective:** Verify custom activeForm field.

**Steps:**
1. Create task with:
   - Subject: "Run integration tests"
   - Description: "Execute all integration tests"
   - Active Form: "Running integration tests"

**Expected Results:**
- Task created with custom activeForm
- activeForm is "Running integration tests" (not subject)

**Pass/Fail Criteria:**
- PASS: Custom activeForm preserved
- FAIL: activeForm defaults to subject

---

#### TC-T-003: Create Task with Metadata

**Objective:** Verify metadata field support.

**Steps:**
1. Create task with metadata:
   ```json
   {
     "priority": "high",
     "labels": ["security", "backend"],
     "estimatedHours": 8
   }
   ```

**Expected Results:**
- Task created with metadata field
- Metadata is stored exactly as provided
- Metadata is a nested object in JSON

**Pass/Fail Criteria:**
- PASS: Metadata stored correctly
- FAIL: Metadata missing or malformed

---

#### TC-T-004: Create Task with Empty Subject

**Objective:** Verify subject validation.

**Steps:**
1. Attempt to create task with empty subject: ""
2. Provide valid description

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `INVALID_INPUT`
- Error message: "Task subject is required"

**Pass/Fail Criteria:**
- PASS: Error thrown, no task created
- FAIL: Task created or wrong error

---

#### TC-T-005: Create Task with Empty Description

**Objective:** Verify description validation.

**Steps:**
1. Provide valid subject
2. Attempt to create task with empty description: ""

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `INVALID_INPUT`
- Error message: "Task description is required"

**Pass/Fail Criteria:**
- PASS: Error thrown, no task created
- FAIL: Task created or wrong error

---

#### TC-T-006: Create Task in Non-Existent List

**Objective:** Verify task list existence check.

**Steps:**
1. Attempt to create task in non-existent task list ID

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `NOT_FOUND` or `IO_ERROR` (lockfile fails on missing file)

**Pass/Fail Criteria:**
- PASS: Error thrown
- FAIL: Task created or no error

---

#### TC-T-007: Update Task Subject

**Objective:** Verify task subject updates.

**Steps:**
1. Create a task
2. Update task with new subject: "Updated Subject"

**Expected Results:**
- Task subject updated
- Other fields unchanged
- `updatedAt` timestamp updated

**Verification:**
```bash
# Check updated task
cat ~/.vesper/task-lists/{id}.json | jq '.tasks[] | select(.id == "{task-id}")'
```

**Pass/Fail Criteria:**
- PASS: Subject updated, timestamp changed
- FAIL: Subject unchanged or other fields modified

---

#### TC-T-008: Update Task Status

**Objective:** Verify status transitions.

**Steps:**
1. Create task (status: "pending")
2. Update status to "in_progress"
3. Update status to "completed"

**Expected Results:**
- Status updates correctly through workflow
- Each update changes `updatedAt` timestamp

**Pass/Fail Criteria:**
- PASS: Status progresses through pending → in_progress → completed
- FAIL: Status update fails or incorrect value

---

#### TC-T-009: Update Task Owner

**Objective:** Verify owner assignment.

**Steps:**
1. Create task (no owner)
2. Update owner to "agent-123"

**Expected Results:**
- Task owner set to "agent-123"
- Owner field persisted in JSON

**Pass/Fail Criteria:**
- PASS: Owner set correctly
- FAIL: Owner not set or incorrect value

---

#### TC-T-010: Merge Task Metadata

**Objective:** Verify metadata merging behavior.

**Steps:**
1. Create task with metadata: `{ "priority": "low" }`
2. Update task with metadata: `{ "labels": ["feature"] }`

**Expected Results:**
- Metadata merged: `{ "priority": "low", "labels": ["feature"] }`
- Existing metadata preserved
- New metadata added

**Pass/Fail Criteria:**
- PASS: Metadata merged correctly
- FAIL: Metadata replaced or lost

---

#### TC-T-011: Add Task Dependencies (blocks)

**Objective:** Verify dependency tracking with blocks.

**Steps:**
1. Create 3 tasks (task1, task2, task3)
2. Update task1 to add blocks: [task2.id, task3.id]

**Expected Results:**
- task1.blocks contains [task2.id, task3.id]
- task2 and task3 are unaffected

**Pass/Fail Criteria:**
- PASS: Blocks array updated correctly
- FAIL: Blocks missing or incorrect

---

#### TC-T-012: Add Task Dependencies (blockedBy)

**Objective:** Verify dependency tracking with blockedBy.

**Steps:**
1. Create 2 tasks (task1, task2)
2. Update task2 to add blockedBy: [task1.id]

**Expected Results:**
- task2.blockedBy contains [task1.id]
- task1 is unaffected

**Pass/Fail Criteria:**
- PASS: blockedBy array updated correctly
- FAIL: blockedBy missing or incorrect

---

#### TC-T-013: Prevent Duplicate Dependencies

**Objective:** Verify duplicate prevention in dependency arrays.

**Steps:**
1. Create 2 tasks
2. Update task1 to add blocks: [task2.id]
3. Update task1 again to add blocks: [task2.id]

**Expected Results:**
- task1.blocks contains [task2.id] only once
- No duplicates in array

**Pass/Fail Criteria:**
- PASS: No duplicates
- FAIL: Duplicate IDs present

---

#### TC-T-014: Update Non-Existent Task

**Objective:** Verify error handling for missing tasks.

**Steps:**
1. Attempt to update non-existent task ID in valid task list

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `NOT_FOUND`
- Error message: "Task not found"

**Pass/Fail Criteria:**
- PASS: Error thrown
- FAIL: Update succeeds or wrong error

---

#### TC-T-015: Delete Task

**Objective:** Verify task deletion.

**Steps:**
1. Create a task in task list
2. Delete the task

**Expected Results:**
- Task removed from tasks array
- Task list `updatedAt` timestamp updated
- Task count decremented

**Verification:**
```bash
# Check task removed
cat ~/.vesper/task-lists/{id}.json | jq '.tasks | length'
```

**Pass/Fail Criteria:**
- PASS: Task removed from array
- FAIL: Task still present

---

#### TC-T-016: Delete Task with Dependencies

**Objective:** Verify dependency cleanup on task deletion.

**Steps:**
1. Create 3 tasks (task1, task2, task3)
2. Set task1.blocks = [task2.id, task3.id]
3. Set task2.blockedBy = [task1.id]
4. Set task3.blockedBy = [task1.id]
5. Delete task1

**Expected Results:**
- task1 removed from tasks array
- task2.blockedBy no longer contains task1.id
- task3.blockedBy no longer contains task1.id
- All references to task1 cleaned up

**Verification:**
```bash
# Check dependencies cleaned up
cat ~/.vesper/task-lists/{id}.json | jq '.tasks[] | select(.blockedBy | contains(["{task1-id}"]))'
# Should return nothing
```

**Pass/Fail Criteria:**
- PASS: Task deleted, all references removed
- FAIL: References remain or deletion fails

---

#### TC-T-017: Delete Non-Existent Task

**Objective:** Verify error handling for missing task deletion.

**Steps:**
1. Attempt to delete non-existent task ID

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `NOT_FOUND`
- Error message: "Task not found"

**Pass/Fail Criteria:**
- PASS: Error thrown
- FAIL: No error or wrong error

---

### Batch Task Creation

#### TC-B-001: Batch Create Multiple Tasks

**Objective:** Verify batch creation efficiency.

**Steps:**
1. Create task list
2. Batch create 5 tasks with:
   ```json
   [
     { "subject": "Task 1", "description": "First" },
     { "subject": "Task 2", "description": "Second" },
     { "subject": "Task 3", "description": "Third" },
     { "subject": "Task 4", "description": "Fourth" },
     { "subject": "Task 5", "description": "Fifth" }
   ]
   ```

**Expected Results:**
- All 5 tasks created in single operation
- Single file lock acquired (not 5 separate locks)
- All tasks have same `createdAt` timestamp
- Task list contains 5 tasks

**Verification:**
```bash
# Check task count and timestamps
cat ~/.vesper/task-lists/{id}.json | jq '.tasks | length'
cat ~/.vesper/task-lists/{id}.json | jq '.tasks[].createdAt' | sort -u | wc -l  # Should be 1
```

**Pass/Fail Criteria:**
- PASS: All tasks created with same timestamp
- FAIL: Tasks created separately or timestamps differ

---

#### TC-B-002: Batch Create with Custom Fields

**Objective:** Verify batch creation with activeForm and metadata.

**Steps:**
1. Batch create tasks with custom fields:
   ```json
   [
     {
       "subject": "Build feature",
       "description": "Implement",
       "activeForm": "Building feature",
       "metadata": { "priority": "high" }
     }
   ]
   ```

**Expected Results:**
- Task created with custom activeForm
- Metadata preserved

**Pass/Fail Criteria:**
- PASS: Custom fields preserved
- FAIL: Fields missing or default values used

---

#### TC-B-003: Batch Create with Dependencies

**Objective:** Verify batch creation with initial dependencies.

**Steps:**
1. Batch create tasks with dependencies:
   ```json
   [
     { "subject": "Task 1", "description": "First" },
     {
       "subject": "Task 2",
       "description": "Second",
       "blockedBy": ["placeholder-id"]
     }
   ]
   ```

**Expected Results:**
- Task 2 created with blockedBy array

**Pass/Fail Criteria:**
- PASS: Dependencies preserved
- FAIL: Dependencies lost

---

#### TC-B-004: Batch Create with Empty Array

**Objective:** Verify validation for empty batch.

**Steps:**
1. Attempt to batch create with empty array: []

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `INVALID_INPUT`
- Error message: "Tasks array is required and must not be empty"

**Pass/Fail Criteria:**
- PASS: Error thrown
- FAIL: No error or tasks created

---

#### TC-B-005: Batch Create with Invalid Task (Empty Subject)

**Objective:** Verify validation for batch tasks.

**Steps:**
1. Attempt to batch create with one invalid task:
   ```json
   [
     { "subject": "Valid", "description": "Good" },
     { "subject": "", "description": "Bad subject" }
   ]
   ```

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `INVALID_INPUT`
- Error message: "All tasks must have a subject"
- No tasks created (atomic operation)

**Pass/Fail Criteria:**
- PASS: Error thrown, no tasks created
- FAIL: Valid task created or wrong error

---

#### TC-B-006: Batch Create with Invalid Task (Empty Description)

**Objective:** Verify description validation in batch.

**Steps:**
1. Attempt to batch create with invalid description:
   ```json
   [
     { "subject": "Valid", "description": "Good" },
     { "subject": "Bad", "description": "" }
   ]
   ```

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `INVALID_INPUT`
- Error message: "All tasks must have a description"

**Pass/Fail Criteria:**
- PASS: Error thrown, no tasks created
- FAIL: Valid task created or wrong error

---

#### TC-B-007: Batch Create in Non-Existent List

**Objective:** Verify task list existence check for batch.

**Steps:**
1. Attempt to batch create in non-existent task list

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `NOT_FOUND` or `IO_ERROR`

**Pass/Fail Criteria:**
- PASS: Error thrown
- FAIL: Tasks created or no error

---

### Task Dependencies

#### TC-D-001: Create Linear Dependency Chain

**Objective:** Verify sequential task dependencies.

**Steps:**
1. Create 4 tasks
2. Set up chain: task1 → task2 → task3 → task4
   - task1 blocks task2
   - task2 blocks task3
   - task3 blocks task4

**Expected Results:**
- task1: blocks=[task2.id], blockedBy=[]
- task2: blocks=[task3.id], blockedBy=[task1.id]
- task3: blocks=[task4.id], blockedBy=[task2.id]
- task4: blocks=[], blockedBy=[task3.id]

**Verification:**
```bash
# Check dependency chain
cat ~/.vesper/task-lists/{id}.json | jq '.tasks[] | { id, blocks, blockedBy }'
```

**Pass/Fail Criteria:**
- PASS: Dependency chain correct
- FAIL: Incorrect dependencies

---

#### TC-D-002: Create Parallel Dependencies

**Objective:** Verify multiple blockers for single task.

**Steps:**
1. Create 4 tasks
2. Set up: task1, task2, task3 all block task4
   - task1 blocks task4
   - task2 blocks task4
   - task3 blocks task4

**Expected Results:**
- task4.blockedBy contains [task1.id, task2.id, task3.id]
- task1, task2, task3 each have task4.id in blocks

**Pass/Fail Criteria:**
- PASS: Parallel dependencies correct
- FAIL: Missing dependencies

---

#### TC-D-003: Update to Add Multiple Dependencies

**Objective:** Verify adding multiple dependencies at once.

**Steps:**
1. Create 4 tasks
2. Update task4 to add blockedBy: [task1.id, task2.id, task3.id]

**Expected Results:**
- task4.blockedBy contains all 3 IDs

**Pass/Fail Criteria:**
- PASS: All dependencies added
- FAIL: Some dependencies missing

---

#### TC-D-004: Preserve Existing Dependencies

**Objective:** Verify additive dependency updates.

**Steps:**
1. Create 3 tasks
2. Update task1 to add blocks: [task2.id]
3. Update task1 again to add blocks: [task3.id]

**Expected Results:**
- task1.blocks contains both [task2.id, task3.id]
- Previous dependencies preserved

**Pass/Fail Criteria:**
- PASS: Both dependencies present
- FAIL: First dependency lost

---

### Session Integration

#### TC-S-001: Set Task List ID on Agent

**Objective:** Verify VesperAgent task list ID injection.

**Steps:**
1. Create a VesperAgent instance
2. Call `agent.setTaskListId('test-task-list-123')`
3. Trigger `agent.chat('Hello')`
4. Inspect environment variables passed to SDK

**Expected Results:**
- `CLAUDE_CODE_TASK_LIST_ID` env var set to 'test-task-list-123'
- Env var accessible in agent tools

**Note:** This test requires access to agent internals or debugging output.

**Pass/Fail Criteria:**
- PASS: Env var set correctly
- FAIL: Env var missing or incorrect

---

#### TC-S-002: Clear Task List ID on Agent

**Objective:** Verify clearing task list ID.

**Steps:**
1. Create VesperAgent
2. Set task list ID: `agent.setTaskListId('test-123')`
3. Clear task list ID: `agent.setTaskListId(undefined)`
4. Trigger `agent.chat('Hello')`

**Expected Results:**
- `CLAUDE_CODE_TASK_LIST_ID` env var NOT set
- No env var pollution

**Pass/Fail Criteria:**
- PASS: Env var not set
- FAIL: Env var still present

---

#### TC-S-003: Per-Session Task List Isolation

**Objective:** Verify no cross-session contamination.

**Steps:**
1. Create 2 VesperAgent instances (agent1, agent2)
2. Set different task list IDs:
   - agent1: `setTaskListId('list-1')`
   - agent2: `setTaskListId('list-2')`
3. Trigger chats on both agents
4. Inspect env vars for each

**Expected Results:**
- agent1 uses `CLAUDE_CODE_TASK_LIST_ID=list-1`
- agent2 uses `CLAUDE_CODE_TASK_LIST_ID=list-2`
- No contamination between agents

**Pass/Fail Criteria:**
- PASS: Each agent uses its own task list ID
- FAIL: Env vars mixed or incorrect

---

#### TC-S-004: Task List ID Persistence Across Chats

**Objective:** Verify task list ID persists across multiple chat invocations.

**Steps:**
1. Create VesperAgent
2. Set task list ID: `agent.setTaskListId('persistent-list')`
3. Call `agent.chat()` three times
4. Inspect env var for each call

**Expected Results:**
- All three chats use same task list ID
- Env var consistent across calls

**Pass/Fail Criteria:**
- PASS: Task list ID consistent
- FAIL: Task list ID changes or clears

---

#### TC-S-005: Update Task List ID Between Chats

**Objective:** Verify task list ID can be changed between chats.

**Steps:**
1. Create VesperAgent
2. Set task list ID: `agent.setTaskListId('list-1')`
3. Call `agent.chat('First message')`
4. Change task list ID: `agent.setTaskListId('list-2')`
5. Call `agent.chat('Second message')`
6. Clear task list ID: `agent.setTaskListId(undefined)`
7. Call `agent.chat('Third message')`

**Expected Results:**
- First chat uses 'list-1'
- Second chat uses 'list-2'
- Third chat has no env var set

**Pass/Fail Criteria:**
- PASS: Each chat uses current task list ID
- FAIL: Stale or incorrect task list ID used

---

### Ralph Loop Integration

#### TC-R-001: Upfront Task Creation from PRD

**Objective:** Verify automatic task creation from PRD stories.

**Steps:**
1. Create task list: `taskList = createTaskList('Ralph Loop Test')`
2. Create PRD with 5 stories (see Test Data Setup)
3. Start Ralph Loop with config:
   ```json
   {
     "taskListId": taskList.id,
     "autoCreateTasks": true
   }
   ```
4. Let loop start (don't wait for completion)
5. Check task list

**Expected Results:**
- 5 tasks created upfront (before any stories processed)
- Each task matches a PRD story:
  - subject = story title
  - description = story content
  - activeForm = "Processing {story title}"
  - metadata includes: storyId, loopId, lineNumber
- All tasks created in single batch operation

**Verification:**
```bash
# Check tasks created
cat ~/.vesper/task-lists/{id}.json | jq '.tasks | length'
cat ~/.vesper/task-lists/{id}.json | jq '.tasks[] | { subject, metadata }'
```

**Pass/Fail Criteria:**
- PASS: All 5 tasks created with correct metadata
- FAIL: Missing tasks or incorrect metadata

---

#### TC-R-002: Disable Auto Task Creation

**Objective:** Verify autoCreateTasks flag.

**Steps:**
1. Create task list
2. Create PRD with stories
3. Start Ralph Loop with:
   ```json
   {
     "taskListId": taskList.id,
     "autoCreateTasks": false
   }
   ```
4. Check task list

**Expected Results:**
- No tasks created
- Task list remains empty

**Pass/Fail Criteria:**
- PASS: No tasks created
- FAIL: Tasks created despite flag

---

#### TC-R-003: Task Status Update on Story Start

**Objective:** Verify task status sync when story processing begins.

**Steps:**
1. Create task list and start Ralph Loop with autoCreateTasks
2. Monitor task list as loop runs
3. Check task status when first story starts processing

**Expected Results:**
- Task status changes to "in_progress"
- Task owner set to session ID
- metadata.startedAt timestamp added (if implemented)

**Verification:**
```bash
# Watch task status changes
watch -n 1 "cat ~/.vesper/task-lists/{id}.json | jq '.tasks[] | { subject, status, owner }'"
```

**Pass/Fail Criteria:**
- PASS: Status updated to in_progress with owner
- FAIL: Status remains pending or owner not set

---

#### TC-R-004: Task Status Update on Story Success

**Objective:** Verify task status sync on successful story completion.

**Steps:**
1. Let Ralph Loop complete one story successfully
2. Check task status

**Expected Results:**
- Task status changes to "completed"
- metadata.completedAt timestamp added
- metadata.iterations shows iteration count
- metadata.commitSha includes commit SHA (if auto-commit enabled and commit created)

**Verification:**
```bash
# Check completed task metadata
cat ~/.vesper/task-lists/{id}.json | jq '.tasks[] | select(.status == "completed") | .metadata'
```

**Pass/Fail Criteria:**
- PASS: Status completed with metadata
- FAIL: Status not updated or metadata missing

---

#### TC-R-005: Task Metadata on Story Failure

**Objective:** Verify task metadata when story fails.

**Steps:**
1. Configure Ralph Loop to fail (use invalid config or broken PRD)
2. Let story processing fail
3. Check task metadata

**Expected Results:**
- Task status remains "in_progress" (not changed to completed)
- metadata.failed = true
- metadata.failedAt timestamp
- metadata.error contains error message
- metadata.iterations shows attempts made

**Pass/Fail Criteria:**
- PASS: Metadata reflects failure, status not completed
- FAIL: Status changed to completed or metadata missing

---

#### TC-R-006: Task Metadata on Story Timeout

**Objective:** Verify task metadata when story times out.

**Steps:**
1. Configure Ralph Loop with very short timeout (e.g., 50ms)
2. Let story time out
3. Check task metadata

**Expected Results:**
- metadata.timeout = true
- metadata.timedOutAt timestamp
- metadata.error contains timeout message

**Pass/Fail Criteria:**
- PASS: Timeout metadata present
- FAIL: Metadata missing or incorrect

---

#### TC-R-007: Non-Fatal Task Update Errors

**Objective:** Verify Ralph Loop continues despite task update failures.

**Steps:**
1. Create task list
2. Start Ralph Loop
3. Manually corrupt task list file during loop execution (e.g., delete file)
4. Observe loop continues processing

**Expected Results:**
- Loop continues processing stories
- Task update errors logged but not fatal
- Loop completes or continues to next story

**Pass/Fail Criteria:**
- PASS: Loop continues despite errors
- FAIL: Loop crashes or stops

---

#### TC-R-008: Task List Validation on Loop Start

**Objective:** Verify task list existence check.

**Steps:**
1. Configure Ralph Loop with non-existent task list ID
2. Start loop

**Expected Results:**
- Error logged: "Task list not found"
- Loop continues without task tracking
- No crash or fatal error

**Pass/Fail Criteria:**
- PASS: Loop continues, error logged
- FAIL: Loop crashes

---

### IPC Handler Validation

#### TC-IPC-001: task-lists:list Handler

**Objective:** Verify list handler returns metadata.

**Steps:**
1. Create 2 task lists
2. Call IPC handler `task-lists:list`

**Expected Results:**
- Returns `TaskListMeta[]` array
- Each entry has correct fields
- Sorted by most recently updated first
- No tasks array included (metadata only)

**Pass/Fail Criteria:**
- PASS: Metadata returned correctly
- FAIL: Full task lists returned or missing fields

---

#### TC-IPC-002: task-lists:create Handler

**Objective:** Verify create handler with broadcasting.

**Steps:**
1. Listen for `task-lists:changed` event
2. Call `task-lists:create` with name and description
3. Verify event broadcast

**Expected Results:**
- Task list created
- `task-lists:changed` event broadcast with task list ID
- All renderer windows notified

**Pass/Fail Criteria:**
- PASS: Created and event broadcast
- FAIL: No event or wrong ID

---

#### TC-IPC-003: task-lists:get Handler

**Objective:** Verify get handler returns full task list.

**Steps:**
1. Create task list with tasks
2. Call `task-lists:get` with ID

**Expected Results:**
- Full TaskList object returned
- Includes tasks array
- All fields present

**Pass/Fail Criteria:**
- PASS: Full task list returned
- FAIL: Metadata only or missing fields

---

#### TC-IPC-004: task-lists:delete Handler (Idempotent)

**Objective:** Verify idempotent delete in IPC.

**Steps:**
1. Call `task-lists:delete` with non-existent ID
2. Observe no error thrown

**Expected Results:**
- Handler returns success (no error)
- No `task-lists:changed` event broadcast
- Idempotent behavior (IPC level handles NOT_FOUND)

**Pass/Fail Criteria:**
- PASS: No error, no event
- FAIL: Error thrown

---

#### TC-IPC-005: task-lists:task-create Handler

**Objective:** Verify task creation with event broadcast.

**Steps:**
1. Listen for `task-lists:changed` event
2. Call `task-lists:task-create`
3. Verify event

**Expected Results:**
- Task created
- Event broadcast with task list ID

**Pass/Fail Criteria:**
- PASS: Task created, event broadcast
- FAIL: No event or wrong ID

---

#### TC-IPC-006: task-lists:task-batch-create Handler

**Objective:** Verify batch creation broadcasts single event.

**Steps:**
1. Listen for `task-lists:changed` event
2. Batch create 5 tasks
3. Count events

**Expected Results:**
- All tasks created
- Single `task-lists:changed` event (not 5)

**Pass/Fail Criteria:**
- PASS: Single event for batch
- FAIL: Multiple events

---

#### TC-IPC-007: task-lists:task-update Handler

**Objective:** Verify update handler with event.

**Steps:**
1. Create task
2. Listen for event
3. Update task
4. Verify event

**Expected Results:**
- Task updated
- Event broadcast

**Pass/Fail Criteria:**
- PASS: Updated and event broadcast
- FAIL: No event

---

#### TC-IPC-008: task-lists:task-delete Handler (Idempotent)

**Objective:** Verify idempotent task delete.

**Steps:**
1. Call `task-lists:task-delete` with non-existent task ID

**Expected Results:**
- Handler returns success (no error)
- No event broadcast (IPC level handles NOT_FOUND)

**Pass/Fail Criteria:**
- PASS: No error, no event
- FAIL: Error thrown

---

#### TC-IPC-009: task-lists:tasks-list Handler

**Objective:** Verify tasks list handler.

**Steps:**
1. Create task list with 3 tasks
2. Call `task-lists:tasks-list`

**Expected Results:**
- Returns Task[] array
- All tasks included
- No event broadcast (read operation)

**Pass/Fail Criteria:**
- PASS: All tasks returned, no event
- FAIL: Missing tasks or event broadcast

---

#### TC-IPC-010: Event Broadcasting for All Windows

**Objective:** Verify events sent to all browser windows.

**Steps:**
1. Open multiple Vesper windows (if possible in test environment)
2. Perform write operation (create/update/delete)
3. Verify all windows receive event

**Expected Results:**
- All windows notified
- Event includes task list ID

**Pass/Fail Criteria:**
- PASS: All windows receive event
- FAIL: Some windows miss event

---

### Error Handling

#### TC-E-001: Corrupt Task List File (Invalid JSON)

**Objective:** Verify handling of corrupt JSON.

**Steps:**
1. Create task list
2. Manually corrupt file with invalid JSON:
   ```bash
   echo "{ invalid json" > ~/.vesper/task-lists/{id}.json
   ```
3. Attempt to load task list

**Expected Results:**
- `loadTaskList()` returns `null`
- Error logged to console
- No crash or exception thrown

**Pass/Fail Criteria:**
- PASS: Returns null, error logged
- FAIL: Exception thrown or crashes

---

#### TC-E-002: Task List File Missing Required Fields

**Objective:** Verify structure validation.

**Steps:**
1. Create task list
2. Remove required field from JSON:
   ```bash
   echo '{"id": "123"}' > ~/.vesper/task-lists/{id}.json
   ```
3. Attempt to load

**Expected Results:**
- Returns `null`
- Error logged about invalid structure

**Pass/Fail Criteria:**
- PASS: Returns null with error
- FAIL: Returns invalid object or crashes

---

#### TC-E-003: File Lock Timeout

**Objective:** Verify lock timeout handling.

**Steps:**
1. Manually create a lock file:
   ```bash
   touch ~/.vesper/task-lists/.{id}.json.lock
   ```
2. Attempt write operation (create/update task)

**Expected Results:**
- Operation retries (up to 5 times)
- If lock persists, error thrown: `TaskListError`
- Error code: `LOCK_TIMEOUT`

**Pass/Fail Criteria:**
- PASS: Retries and eventual timeout
- FAIL: Immediate failure or hangs

---

#### TC-E-004: Concurrent Write Operations

**Objective:** Verify file locking prevents corruption.

**Steps:**
1. Create task list
2. Trigger multiple concurrent write operations (5 simultaneous updates)
3. Wait for all to complete
4. Verify task list integrity

**Expected Results:**
- All writes complete successfully (may be serialized by lock)
- Task list file not corrupted
- All updates applied (last write wins)

**Verification:**
```bash
# Validate JSON structure
cat ~/.vesper/task-lists/{id}.json | jq .
```

**Pass/Fail Criteria:**
- PASS: File valid, all writes complete
- FAIL: File corrupt or writes fail

---

#### TC-E-005: Disk Full Scenario

**Objective:** Verify handling when disk is full.

**Steps:**
1. Fill disk to capacity (use test partition if available)
2. Attempt to create task list

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `IO_ERROR`
- Error details include system error

**Note:** This test may not be feasible in all environments.

**Pass/Fail Criteria:**
- PASS: Error thrown with IO_ERROR
- FAIL: Silent failure or crash

---

#### TC-E-006: Permission Denied on Directory

**Objective:** Verify handling of permission errors.

**Steps:**
1. Remove write permissions from task-lists directory:
   ```bash
   chmod 000 ~/.vesper/task-lists
   ```
2. Attempt to create task list
3. Restore permissions:
   ```bash
   chmod 755 ~/.vesper/task-lists
   ```

**Expected Results:**
- Error thrown: `TaskListError`
- Error code: `IO_ERROR`

**Pass/Fail Criteria:**
- PASS: Error thrown
- FAIL: Silent failure or crash

---

#### TC-E-007: Network-Mounted Storage (NFS/SMB)

**Objective:** Verify file locking on network storage.

**Steps:**
1. Move `~/.vesper/task-lists/` to network mount
2. Create symlink
3. Perform CRUD operations

**Expected Results:**
- Operations work (may be slower)
- File locking may behave differently (depends on network FS)

**Note:** This is an edge case and may not be fully supported.

**Pass/Fail Criteria:**
- PASS: Operations succeed
- FAIL: Locks fail or corruption occurs

---

### Edge Cases

#### TC-EC-001: Task List with 100+ Tasks

**Objective:** Verify performance with large task lists.

**Steps:**
1. Batch create 150 tasks in single list
2. Perform operations:
   - List all tasks
   - Update task status
   - Delete task
3. Measure operation times

**Expected Results:**
- All operations complete
- Reasonable performance (under 1 second for most ops)
- No memory issues

**Pass/Fail Criteria:**
- PASS: Operations succeed with acceptable performance
- FAIL: Timeout, crash, or extreme slowness

---

#### TC-EC-002: Task with Very Long Subject/Description

**Objective:** Verify handling of large text fields.

**Steps:**
1. Create task with:
   - Subject: 1000 characters
   - Description: 10,000 characters

**Expected Results:**
- Task created successfully
- Full text stored and retrieved
- No truncation

**Pass/Fail Criteria:**
- PASS: Full text preserved
- FAIL: Truncation or error

---

#### TC-EC-003: Task with Complex Nested Metadata

**Objective:** Verify deep object support.

**Steps:**
1. Create task with deeply nested metadata:
   ```json
   {
     "priority": "high",
     "tags": ["a", "b", "c"],
     "nested": {
       "level1": {
         "level2": {
           "level3": {
             "value": "deep"
           }
         }
       }
     },
     "array": [1, 2, { "key": "value" }]
   }
   ```

**Expected Results:**
- Metadata stored correctly
- Structure preserved on retrieval

**Pass/Fail Criteria:**
- PASS: Full structure preserved
- FAIL: Flattened or corrupted

---

#### TC-EC-004: Special Characters in Names

**Objective:** Verify Unicode and special character support.

**Steps:**
1. Create task list with name: `Test & List (v2) - "Special" 中文 🎉`
2. Create task with subject: `Fix bug: \`authentication\` failed`

**Expected Results:**
- Special characters preserved
- Unicode handled correctly
- No encoding issues

**Pass/Fail Criteria:**
- PASS: All characters preserved
- FAIL: Encoding corruption

---

#### TC-EC-005: Empty Task-Lists Directory

**Objective:** Verify handling of empty directory.

**Steps:**
1. Delete all task list files
2. Call `listTaskLists()`

**Expected Results:**
- Returns empty array `[]`
- No error thrown

**Pass/Fail Criteria:**
- PASS: Empty array returned
- FAIL: Error or null

---

#### TC-EC-006: Missing Task-Lists Directory

**Objective:** Verify directory creation.

**Steps:**
1. Delete `~/.vesper/task-lists/` directory
2. Create a task list

**Expected Results:**
- Directory created automatically
- Task list created successfully

**Verification:**
```bash
# Check directory created
ls -ld ~/.vesper/task-lists
```

**Pass/Fail Criteria:**
- PASS: Directory created, task list saved
- FAIL: Error or directory not created

---

#### TC-EC-007: Non-JSON Files in Directory

**Objective:** Verify filtering of non-JSON files.

**Steps:**
1. Create non-JSON files in task-lists directory:
   ```bash
   echo "test" > ~/.vesper/task-lists/readme.txt
   echo "lock" > ~/.vesper/task-lists/.lock-file
   ```
2. Call `listTaskLists()`

**Expected Results:**
- Non-JSON files ignored
- Only JSON files processed
- No errors

**Pass/Fail Criteria:**
- PASS: Non-JSON files skipped
- FAIL: Error or files processed

---

#### TC-EC-008: Concurrent Access from Multiple Processes

**Objective:** Verify file locking across processes.

**Steps:**
1. Start two Vesper instances
2. Open same workspace in both
3. Perform write operations simultaneously

**Expected Results:**
- File locks prevent corruption
- One process waits for other
- No data loss

**Note:** This test requires multi-process environment.

**Pass/Fail Criteria:**
- PASS: No corruption, all writes succeed
- FAIL: Corruption or lost writes

---

#### TC-EC-009: Task List Name at 200 Character Boundary

**Objective:** Verify exact boundary condition.

**Steps:**
1. Create task list with name exactly 200 characters
2. Create task list with name 201 characters

**Expected Results:**
- 200 chars: succeeds
- 201 chars: fails with INVALID_INPUT

**Pass/Fail Criteria:**
- PASS: Boundary enforced correctly
- FAIL: Wrong behavior at boundary

---

#### TC-EC-010: Rapid Successive Updates

**Objective:** Verify handling of rapid updates.

**Steps:**
1. Create task
2. Perform 50 rapid updates to same task (status changes)
3. Verify final state

**Expected Results:**
- All updates processed
- Final state reflects last update
- No lost updates

**Pass/Fail Criteria:**
- PASS: Final state correct
- FAIL: Lost updates or corruption

---

## Regression Test Checklist

Run these tests before each release to ensure no regressions:

### Core Functionality
- [ ] TC-TL-001: Create task list
- [ ] TC-TL-006: Load task list
- [ ] TC-TL-008: List all task lists
- [ ] TC-TL-009: Delete task list
- [ ] TC-T-001: Create task
- [ ] TC-T-007: Update task subject
- [ ] TC-T-008: Update task status
- [ ] TC-T-015: Delete task
- [ ] TC-B-001: Batch create tasks

### Validation
- [ ] TC-TL-004: Empty name validation
- [ ] TC-TL-005: Long name validation
- [ ] TC-T-004: Empty subject validation
- [ ] TC-T-005: Empty description validation

### Dependencies
- [ ] TC-D-001: Linear dependency chain
- [ ] TC-D-002: Parallel dependencies
- [ ] TC-T-016: Delete task with dependencies

### Integration
- [ ] TC-S-001: Set task list ID on agent
- [ ] TC-S-003: Per-session isolation
- [ ] TC-R-001: Ralph Loop upfront task creation
- [ ] TC-R-003: Task status on story start
- [ ] TC-R-004: Task status on story success

### IPC
- [ ] TC-IPC-001: List handler
- [ ] TC-IPC-002: Create handler with broadcast
- [ ] TC-IPC-006: Batch create single event

### Error Handling
- [ ] TC-E-001: Corrupt JSON handling
- [ ] TC-E-004: Concurrent writes
- [ ] TC-T-016: Delete with dependency cleanup

### Edge Cases
- [ ] TC-EC-001: Large task list (100+ tasks)
- [ ] TC-EC-004: Special characters
- [ ] TC-EC-006: Missing directory auto-creation

---

## Performance Test Scenarios

### Scenario 1: Large Task List Operations

**Objective:** Measure performance with 500 tasks.

**Steps:**
1. Batch create 500 tasks
2. Measure time for:
   - `listTaskLists()` call
   - `loadTaskList()` call
   - Single task update
   - Task deletion

**Acceptance Criteria:**
- `listTaskLists()`: < 500ms
- `loadTaskList()`: < 200ms
- Task update: < 100ms
- Task deletion: < 100ms

---

### Scenario 2: Concurrent Session Operations

**Objective:** Test multi-session access.

**Steps:**
1. Create 5 sessions with same task list
2. Perform simultaneous updates from all sessions
3. Measure:
   - Lock wait time
   - Total completion time
   - Final consistency

**Acceptance Criteria:**
- All updates succeed
- No corruption
- Total time < 5 seconds

---

### Scenario 3: Ralph Loop Task Sync Performance

**Objective:** Measure task update overhead.

**Steps:**
1. Create Ralph Loop with 20 stories
2. Measure:
   - Upfront task creation time
   - Status update time per story
   - Total overhead vs. no task list

**Acceptance Criteria:**
- Upfront creation: < 500ms
- Status update per story: < 50ms
- Total overhead: < 10% of loop time

---

### Scenario 4: IPC Event Broadcasting Latency

**Objective:** Measure event propagation time.

**Steps:**
1. Open 3 renderer windows
2. Create task list
3. Measure time from create to event received in all windows

**Acceptance Criteria:**
- Event propagation: < 100ms
- All windows receive event

---

### Scenario 5: File System Stress Test

**Objective:** Test rapid CRUD operations.

**Steps:**
1. Perform 1000 operations in rapid succession:
   - 250 creates
   - 250 updates
   - 250 deletes
   - 250 reads
2. Measure:
   - Total time
   - Error rate
   - File system health

**Acceptance Criteria:**
- All operations complete
- Error rate < 1%
- Total time < 60 seconds
- No file corruption

---

## Test Execution Log Template

Use this template to record test results:

```markdown
# Test Execution Log

**Date:** YYYY-MM-DD
**Tester:** Name
**Version:** Vesper vX.Y.Z
**Environment:** macOS version, hardware

## Summary
- Total Tests: X
- Passed: X
- Failed: X
- Skipped: X

## Test Results

### TC-TL-001: Create Task List with Valid Name
- **Status:** PASS/FAIL
- **Duration:** Xms
- **Notes:** Any observations
- **Evidence:** Screenshot/log path

### [Continue for all tests...]

## Failed Tests
List all failed tests with detailed failure analysis.

## Blockers
List any blockers encountered.

## Recommendations
Suggestions for improvements.
```

---

## Appendix: Common Issues and Solutions

### Issue 1: Lock File Not Releasing

**Symptoms:** Operations hang, lock timeout errors.

**Cause:** Process crashed while holding lock.

**Solution:**
```bash
# Manually remove stale lock files
rm ~/.vesper/task-lists/.*.lock
```

---

### Issue 2: Corrupt Task List File

**Symptoms:** Load returns null, console errors.

**Cause:** Write interrupted or manual editing error.

**Solution:**
```bash
# Validate JSON
cat ~/.vesper/task-lists/{id}.json | jq .
# If corrupt, restore from backup or recreate
```

---

### Issue 3: Task List Not Found in Ralph Loop

**Symptoms:** Loop runs but no tasks created.

**Cause:** Task list ID doesn't exist or was deleted.

**Solution:**
1. Verify task list exists: `listTaskLists()`
2. Recreate if missing
3. Update Ralph Loop config with correct ID

---

### Issue 4: IPC Events Not Received

**Symptoms:** UI not updating after operations.

**Cause:** Event listener not registered or window closed.

**Solution:**
1. Check event listener registration
2. Verify window is still open
3. Manually refresh UI

---

**End of Manual Testing Guide**
