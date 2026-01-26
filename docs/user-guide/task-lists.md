# Task Lists User Guide

Welcome to the Task Lists user guide. This document will help you understand and use Task Lists in Vesper to organize, track, and coordinate work across AI agents and sessions.

---

## Table of Contents

1. [What are Task Lists?](#what-are-task-lists)
2. [When to Use Task Lists](#when-to-use-task-lists)
3. [Creating a Task List](#creating-a-task-list)
4. [Working with Tasks](#working-with-tasks)
5. [Task Status Workflow](#task-status-workflow)
6. [Task Dependencies](#task-dependencies)
7. [Integration with Sessions](#integration-with-sessions)
8. [Integration with Ralph Loop](#integration-with-ralph-loop)
9. [Integration with Templates](#integration-with-templates)
10. [Common Use Cases](#common-use-cases)
11. [Best Practices](#best-practices)
12. [Troubleshooting](#troubleshooting)

---

## What are Task Lists?

Task Lists are a structured way to organize and track work in Vesper. They provide a central place to manage related tasks, coordinate dependencies between tasks, and track progress across multiple AI agents or sessions.

### Key Features

- **Structured Organization**: Group related tasks in named lists
- **Status Tracking**: Monitor task progress through pending, in-progress, and completed states
- **Dependency Management**: Define which tasks must complete before others can start
- **Multi-Agent Coordination**: Share task lists across multiple AI agents or sessions
- **Ralph Loop Integration**: Automatically create tasks from PRD stories for tracking
- **Session Templates**: Include task lists in session templates for repeatable workflows
- **Metadata Support**: Attach custom metadata to tasks for extensibility

### How Task Lists Differ from Sessions

| Feature | Sessions | Task Lists |
|---------|----------|-----------|
| Purpose | Conversational history with AI | Structured task tracking |
| Lifecycle | Created per conversation | Shared across multiple sessions |
| Content | Messages, attachments, tool calls | Tasks with status and dependencies |
| Coordination | Single-threaded | Multi-agent parallel work |
| Persistence | Per-workspace sessions directory | Global task-lists directory |

---

## When to Use Task Lists

Task Lists are ideal when you have:

### Multi-Step Projects
- **Feature implementations** that require multiple coordinated tasks
- **Refactoring work** that spans several files or modules
- **Bug fixes** with multiple related changes
- **Documentation updates** across many pages

### Multi-Agent Workflows
- **Parallel processing** where multiple agents work on independent tasks
- **Dependency chains** where some tasks must complete before others begin
- **Load balancing** by distributing tasks to available agents
- **Progress tracking** across distributed work

### Ralph Loop Automation
- **PRD-driven development** where stories are tracked as tasks
- **Autonomous workflows** that need visibility into progress
- **Checkpoint recovery** where you can see what's completed if interrupted
- **Quality assurance** to verify all PRD stories were addressed

### Repeatable Workflows
- **Project templates** that include predefined task lists
- **Onboarding checklists** for new team members
- **Release processes** with standard validation steps
- **Code review** with consistent review criteria

---

## Creating a Task List

Task Lists are created programmatically through the agent's tools. When you ask the agent to work on complex tasks, it may proactively create a task list to track progress.

### Agent-Initiated Creation

The most common way to create a task list is to let the agent do it for you:

```
User: "I need to implement user authentication with login, logout, and password reset."

Agent: I'll create a task list to track this work.
[Agent creates task list "User Authentication Implementation"]
[Agent creates tasks for login, logout, and password reset]
```

### Task List Structure

Each task list contains:
- **ID**: Unique identifier (automatically generated UUID)
- **Name**: Human-readable name (max 200 characters)
- **Description**: Optional detailed description
- **Tasks**: Array of tasks in the list
- **Timestamps**: Creation and last updated times

---

## Working with Tasks

Tasks are the individual work items within a task list. Each task represents a single, focused piece of work that can be completed independently.

### Creating Tasks

Tasks are created by the agent using the `TaskCreate` tool:

```javascript
// Agent creates a task
TaskCreate({
  subject: "Implement login endpoint",
  description: "Create POST /api/auth/login endpoint with email/password validation",
  activeForm: "Implementing login endpoint"
})
```

### Task Fields

Each task contains:

| Field | Description | Example |
|-------|-------------|---------|
| `id` | Unique identifier (UUID) | `"550e8400-e29b-41d4-a716-446655440000"` |
| `subject` | Brief, actionable title (imperative form) | `"Fix authentication bug in login flow"` |
| `description` | Detailed requirements and acceptance criteria | `"The login endpoint returns 500 when..."` |
| `activeForm` | Present continuous form shown in progress spinner | `"Fixing authentication bug"` |
| `status` | Current status (pending/in_progress/completed) | `"in_progress"` |
| `owner` | Agent ID who owns the task (optional) | `"agent-1"` |
| `metadata` | Custom metadata for extensibility | `{ priority: "high", tags: ["auth"] }` |
| `blocks` | Tasks that can't start until this one completes | `["task-id-2", "task-id-3"]` |
| `blockedBy` | Tasks that must complete before this one starts | `["task-id-0"]` |
| `createdAt` | Creation timestamp (ISO 8601) | `"2026-01-25T10:30:00Z"` |
| `updatedAt` | Last update timestamp (ISO 8601) | `"2026-01-25T11:45:00Z"` |

### Subject vs Active Form

The `subject` and `activeForm` serve different purposes:

- **Subject**: Imperative form, describes the outcome
  - "Run integration tests"
  - "Update API documentation"
  - "Fix memory leak in worker thread"

- **Active Form**: Present continuous, shown while working
  - "Running integration tests"
  - "Updating API documentation"
  - "Fixing memory leak"

---

## Task Status Workflow

Tasks progress through three states in a linear workflow:

```
pending → in_progress → completed
```

### Status Definitions

| Status | Meaning | When to Use |
|--------|---------|-------------|
| **pending** | Task not started yet | Initial state, or waiting for dependencies |
| **in_progress** | Task currently being worked on | Agent has claimed the task and started work |
| **completed** | Task finished successfully | All acceptance criteria met |

### Status Transitions

**pending → in_progress**
```javascript
// Agent claims and starts a task
TaskUpdate({
  taskId: "1",
  status: "in_progress",
  owner: "my-agent-id"
})
```

**in_progress → completed**
```javascript
// Agent marks task as done
TaskUpdate({
  taskId: "1",
  status: "completed"
})
```

### Important Rules

1. **Only mark completed when fully done**: If you encounter errors, blockers, or can't finish, keep the task as in_progress
2. **Create new tasks for blockers**: If blocked, create a new task describing what needs to be resolved
3. **Never mark incomplete work as completed**: Failed tests, partial implementations, or unresolved errors mean the task is not complete

---

## Task Dependencies

Task dependencies enable you to control execution order and coordinate parallel work.

### Dependency Types

**blocks**: Tasks that cannot start until this one completes
```javascript
TaskUpdate({
  taskId: "1",
  addBlocks: ["2", "3"]  // Tasks 2 and 3 must wait for task 1
})
```

**blockedBy**: Tasks that must complete before this one can start
```javascript
TaskUpdate({
  taskId: "2",
  addBlockedBy: ["1"]  // Task 2 requires task 1 to finish first
})
```

### Dependency Best Practices

1. **Model natural dependencies**: Database setup before data migration
2. **Enable parallelism**: Only block when truly necessary
3. **Avoid circular dependencies**: Never create dependency loops (A blocks B, B blocks A)
4. **Check before starting**: Verify `blockedBy` is empty before claiming a task

### Example: Sequential Build Pipeline

```
Task 1: "Install dependencies" (no dependencies)
  → blocks Task 2

Task 2: "Run tests" (blockedBy: Task 1)
  → blocks Task 3

Task 3: "Build production bundle" (blockedBy: Task 2)
  → blocks Task 4

Task 4: "Deploy to staging" (blockedBy: Task 3)
```

### Example: Parallel Feature Development

```
Task 1: "Design database schema" (no dependencies)
  → blocks Tasks 2, 3, 4

Task 2: "Implement users table" (blockedBy: Task 1)
Task 3: "Implement posts table" (blockedBy: Task 1)  } Can run in parallel
Task 4: "Implement comments table" (blockedBy: Task 1)

Task 5: "Write integration tests" (blockedBy: Tasks 2, 3, 4)
```

---

## Integration with Sessions

Sessions can be linked to task lists for coordinated work tracking.

### Linking a Session to a Task List

When you create a session or use a template, you can specify a task list ID:

```javascript
// Session configuration
{
  taskListId: "550e8400-e29b-41d4-a716-446655440000"
}
```

### How It Works

1. **Environment Variable Injection**: When a session has a `taskListId`, the agent sets the `CLAUDE_CODE_TASK_LIST_ID` environment variable
2. **Agent Access**: The agent can read this environment variable to access the task list
3. **Session Isolation**: Each session's task list is independent (no cross-contamination)
4. **Multi-Session Coordination**: Multiple sessions can share the same task list for parallel work

### Use Cases

**Single Session with Task Tracking**
- Create a task list for a complex project
- Link a session to the task list
- Agent uses the task list to track its progress through the work

**Multi-Session Parallel Processing**
- Create a task list with 10 independent tasks
- Start 3 sessions, all linked to the same task list
- Each session claims and works on different tasks
- Track overall progress across all sessions

**Session Resume with Context**
- Session crashes mid-work
- Resume the session (task list ID preserved)
- Agent sees which tasks are completed and which remain
- Continue from where it left off

---

## Integration with Ralph Loop

Ralph Loop automatically integrates with task lists when configured, providing visibility into PRD story processing.

### Automatic Task Creation

When you start a Ralph Loop with a task list ID:

1. **Upfront Task Creation**: All PRD stories are created as tasks at loop start
2. **Story-to-Task Mapping**: Each story gets a corresponding task with matching metadata
3. **Status Synchronization**: As stories complete, their tasks are marked as completed
4. **Progress Visibility**: Track loop progress through the task list

### Configuration

Enable task list integration in your Ralph Loop config:

```javascript
{
  taskListId: "550e8400-e29b-41d4-a716-446655440000",
  autoCreateTasks: true  // Default: true (set false to disable)
}
```

### Task Metadata

Tasks created from PRD stories include metadata:

```javascript
{
  metadata: {
    storyId: "US-001",
    loopId: "loop-1737899234-abc123",
    lineNumber: 42
  }
}
```

### Example Workflow

```markdown
# PRD: User Authentication

## Stories

- [ ] Implement login endpoint
- [ ] Implement logout endpoint
- [ ] Add password reset flow
- [ ] Write integration tests
```

**Ralph Loop starts:**
1. Creates task list or uses existing one
2. Creates 4 tasks from the PRD stories
3. Processes story 1, updates task 1 to in_progress
4. Completes story 1, marks task 1 as completed
5. Repeats for remaining stories

**Benefits:**
- See which stories are complete at a glance
- Resume if loop crashes (completed tasks show what's done)
- Share task list with other agents for parallel work on remaining stories
- Audit trail of which stories were processed and when

---

## Integration with Templates

Session templates can include task lists for repeatable workflows.

### Including a Task List in a Template

When creating a template from a session:

```javascript
{
  name: "Feature Development Workflow",
  permissionMode: "ask",
  model: "claude-opus-4-5",
  workingDirectory: "/Users/me/projects/myapp",
  taskListId: "550e8400-e29b-41d4-a716-446655440000"  // Task list ID
}
```

### Use Cases

**Onboarding Template**
- Create a task list with onboarding steps
- Save as template "New Developer Onboarding"
- Each new developer gets a session with the same task checklist
- Track their progress through the tasks

**Release Checklist Template**
- Create a task list with release validation steps
- Save as template "Production Release"
- Each release gets a session with the checklist
- Ensure no steps are skipped

**Code Review Template**
- Create a task list with review criteria
- Save as template "Code Review Process"
- Each PR review gets a session with the checklist
- Consistent review quality

---

## Common Use Cases

### Use Case 1: Feature Implementation

**Scenario**: Implementing a new user profile page with multiple components

**Approach**:
1. Agent creates task list "User Profile Page"
2. Creates tasks:
   - Design profile layout (pending)
   - Implement profile data fetching (pending, blockedBy: layout)
   - Add edit profile form (pending, blockedBy: data fetching)
   - Write component tests (pending, blockedBy: all above)
3. Agent works through tasks sequentially
4. You can see progress at each step

**Benefits**: Organized approach, clear progress tracking, easy to resume if interrupted

---

### Use Case 2: Multi-Agent Refactoring

**Scenario**: Refactoring 20 components to use a new API

**Approach**:
1. Create task list "API Migration"
2. Create 20 tasks, one per component (all pending, no dependencies)
3. Start 4 sessions, all linked to the task list
4. Each session claims 5 tasks and works independently
5. Monitor task list to see overall progress

**Benefits**: Parallel processing, faster completion, no duplicate work

---

### Use Case 3: PRD-Driven Development with Ralph Loop

**Scenario**: Building a feature from a PRD with 15 stories

**Approach**:
1. Write PRD with checkbox-formatted stories
2. Create task list "New Feature Implementation"
3. Start Ralph Loop with task list ID
4. Ralph Loop creates 15 tasks from stories
5. Process stories automatically, updating tasks as they complete
6. If loop crashes, see which stories completed via task list
7. Resume loop or manually complete remaining stories

**Benefits**: Full automation, progress visibility, crash recovery, audit trail

---

### Use Case 4: Repeatable Release Process

**Scenario**: Standard release checklist that must be followed every time

**Approach**:
1. Create task list "v1.0 Release Checklist"
2. Add tasks: run tests, update changelog, tag release, deploy staging, smoke test, deploy production
3. Save session as template "Production Release"
4. For each release, create session from template
5. Session automatically links to a new task list with same tasks
6. Work through checklist, marking tasks complete
7. Ensure nothing is skipped

**Benefits**: Consistency, quality assurance, no missed steps

---

## Best Practices

### Task Creation

1. **Keep subjects concise and actionable**: Use imperative form ("Fix bug", not "Bug is fixed")
2. **Write detailed descriptions**: Include acceptance criteria, context, and examples
3. **Provide meaningful active forms**: Help users understand what's happening in progress spinners
4. **Use metadata wisely**: Add priority, tags, or custom fields for filtering and sorting

### Task Management

1. **Check for blockers before starting**: Verify `blockedBy` is empty before claiming a task
2. **Update status promptly**: Mark in_progress when starting, completed when done
3. **Set ownership**: Claim tasks with `owner` field to avoid duplicate work
4. **Be honest about completion**: Only mark completed when truly done

### Dependency Management

1. **Model natural dependencies**: Reflect real-world constraints (setup before usage)
2. **Minimize unnecessary blocking**: Enable parallel work when possible
3. **Avoid circular dependencies**: Never create dependency loops
4. **Document dependencies**: Explain why dependencies exist in task descriptions

### Multi-Agent Coordination

1. **Use task lists for shared work**: Central coordination point for multiple agents
2. **Claim tasks atomically**: Set owner and status in a single update
3. **Check task list before creating new work**: Avoid duplicating existing tasks
4. **Communicate blockers**: Create new tasks for unexpected blockers instead of abandoning work

### Template Design

1. **Create reusable checklists**: Package task lists in templates for repeatable workflows
2. **Document template purpose**: Explain when and how to use each template
3. **Update templates regularly**: Keep task lists current as processes evolve
4. **Test templates**: Verify task lists work as expected before sharing

---

## Troubleshooting

### Task List Not Found

**Symptom**: Error message "Task list not found: {id}"

**Causes**:
- Task list was deleted
- Incorrect task list ID
- Task list created in different Vesper instance

**Solutions**:
- Verify task list exists: Check `~/.vesper/task-lists/` directory
- Create new task list if missing
- Update session or template with correct task list ID

---

### Task Not Updating

**Symptom**: Task status or fields don't change after update

**Causes**:
- File lock contention (multiple agents updating simultaneously)
- Corrupt task list file
- Incorrect task ID

**Solutions**:
- Wait a moment and retry (lock will release)
- Check task list file at `~/.vesper/task-lists/{id}.json`
- Verify task ID exists in the task list
- Check logs at `~/Library/Logs/Vesper/` for errors

---

### Circular Dependency Detected

**Symptom**: Task appears blocked but no tasks are in_progress or pending

**Causes**:
- Task A blocks Task B, Task B blocks Task A
- Longer dependency chains that loop back

**Solutions**:
- Review dependency graph: List all tasks and their blocks/blockedBy
- Remove one dependency to break the cycle
- Restructure tasks to eliminate circular dependencies

---

### Tasks Not Created by Ralph Loop

**Symptom**: Ralph Loop runs but no tasks appear in task list

**Causes**:
- `autoCreateTasks: false` in configuration
- Task list ID not provided
- Task list doesn't exist

**Solutions**:
- Verify `autoCreateTasks` is not set to `false`
- Check that `taskListId` is set in loop config
- Create task list before starting loop
- Check logs for task creation errors

---

### Multiple Agents Claiming Same Task

**Symptom**: Two agents work on the same task simultaneously

**Causes**:
- Race condition between agent task claiming
- One agent didn't set owner field
- Task list not refreshed before claiming

**Solutions**:
- Always set `owner` when marking task as in_progress
- Refresh task list (TaskList tool) before claiming tasks
- Implement retry logic if task update fails (already claimed)

---

### Task List File Corrupted

**Symptom**: Error message "Invalid task list structure" or "CORRUPT_DATA"

**Causes**:
- Manual editing of task list JSON file introduced syntax error
- Write operation interrupted (disk full, process killed)
- File encoding issue

**Solutions**:
- Open `~/.vesper/task-lists/{id}.json` in a text editor
- Validate JSON syntax (use a JSON validator)
- Restore from backup if available
- Recreate task list if unrecoverable
- Check disk space

---

## Storage Location

Task lists are stored at:

```
~/.vesper/task-lists/{id}.json
```

Each file contains:
- Task list metadata (id, name, description, timestamps)
- Complete task array with all task data
- JSON format with 2-space indentation

**Warning**: Do not manually edit task list files while agents are running. Use the provided tools to ensure proper locking and validation.

---

## Related Documentation

- [Ralph Mode User Guide](../ralph-mode-user-guide.md) - Learn about autonomous coding with Ralph Loop
- [Session Templates Guide](../features/session-templates.md) - Create reusable session configurations
- [Multi-Agent Workflows](../architecture/multi-agent-coordination.md) - Coordinate work across multiple agents

---

*Last Updated: 2026-01-25*

For questions or issues, please refer to the main [README.md](../../README.md) or open an issue on GitHub.
