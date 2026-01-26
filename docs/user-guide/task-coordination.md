# Task Coordination

Task coordination enables multi-agent workflows in Vesper, allowing the Dispatch skill to coordinate multiple parallel agents working on complex features.

## Overview

When task coordination is enabled, each session gets its own task list for tracking work items. This allows Claude to break down complex features into smaller tasks and spawn multiple agents to work on them in parallel, dramatically accelerating development.

## How It Works

1. **Task List ID Generation**: When you create a new session with task coordination enabled, Vesper automatically generates a unique task list ID (format: `vesper-{sessionId}`)

2. **Dispatch Skill Integration**: The Dispatch skill can create tasks, assign them to subagents, and track progress across multiple parallel agents

3. **Persistent Storage**: Tasks are stored in Claude Code's native format at `~/.claude/tasks/{listId}/` and persist across app restarts

4. **Session Isolation**: Each session has its own task list, preventing cross-contamination between different projects

## Enabling Task Coordination

### For All New Sessions

1. Go to **Settings → Workspace**
2. Scroll to **Advanced → Developer Settings**
3. Toggle **"Enable Task Coordination"** on
4. All new sessions in this workspace will automatically get task coordination

### Viewing Task List ID

When task coordination is active for a session:

1. Click the info icon (ⓘ) in the top right of the chat
2. The **Task List** field shows the current task list ID
3. Click the **📋 Copy** button to copy the ID to clipboard

## Using the Dispatch Skill

Once task coordination is enabled, you can use the Dispatch skill for complex multi-step features:

```
Create a new authentication system with:
- User login/logout
- Password reset flow
- Email verification
- Session management
```

Claude will:
1. Break the work into discrete tasks
2. Create a task list with dependencies
3. Spawn parallel agents to work on each task
4. Coordinate progress and handle task completion

## Task Storage

Tasks are stored in:
```
~/.claude/tasks/{listId}/
├── task-1.json
├── task-2.json
└── task-3.json
```

This is Claude Code's native task format, ensuring compatibility with the CLI and other integrations.

## Viewing Tasks

You can view and manage tasks using:

- **Claude Code CLI**: `claude --resume {sessionId}` (tasks are automatically available)
- **Task Files**: Directly inspect JSON files in `~/.claude/tasks/{listId}/`
- **Vesper UI**: Check the session info panel for the task list ID

## Troubleshooting

### "Task coordination is not enabled" error

**Cause**: The Dispatch skill requires task coordination to be enabled before starting a session.

**Solution**:
1. Go to Settings → Workspace → Advanced
2. Enable "Enable Task Coordination"
3. Create a new session
4. The task list ID will be auto-generated

### Task list ID not showing

**Cause**: Task coordination was enabled after the session was created.

**Solution**:
- Task coordination must be enabled BEFORE creating a session
- Create a new session to get automatic task coordination

### Multiple sessions sharing the same task list

**Cause**: Each session gets its own unique task list ID.

**Solution**:
- If you want to share tasks between sessions, you'll need to manually coordinate
- Each `vesper-{sessionId}` task list is isolated by design

## Best Practices

### When to Use Task Coordination

✅ **Good use cases**:
- Complex features requiring 5+ implementation steps
- Parallelizable work (e.g., creating multiple similar components)
- Large refactoring projects
- Features spanning multiple files/modules

❌ **Avoid for**:
- Simple bug fixes (1-2 steps)
- Single-file changes
- Quick questions or explanations

### Performance Considerations

- Each spawned agent creates a new process
- Parallel agents consume more memory
- Consider your system resources when planning large task lists
- Sonnet is recommended for task coordination (Haiku doesn't support task tools)

## Advanced: Manual Task List ID

While Vesper auto-generates task list IDs, you can manually set one if needed:

1. Task list IDs must be unique
2. Format: any alphanumeric string (e.g., `my-feature-name`)
3. Cannot be changed mid-session (would require creating a new session)

> **Note**: Manual task list ID setting is not currently supported in the UI. Use the auto-generated IDs for best results.

## Related Documentation

- [Dispatch Skill](../skills/dispatch.md) - Using the Dispatch skill for multi-agent coordination
- [Session Templates](./templates.md) - Create templates with task coordination pre-enabled
- [Workspace Settings](./workspace-settings.md) - Complete workspace configuration guide

## FAQ

**Q: Can I use task coordination with existing sessions?**
A: No, task coordination must be enabled before creating the session. Create a new session to get automatic task coordination.

**Q: Do tasks persist after closing Vesper?**
A: Yes, tasks are stored on disk at `~/.claude/tasks/` and will be available when you resume the session.

**Q: Can I see task progress in Vesper?**
A: The task list ID is visible in the session info panel. For detailed task progress, use the Claude Code CLI or inspect the task JSON files directly.

**Q: What happens if I disable task coordination?**
A: Existing sessions keep their task list IDs. New sessions won't get automatic task coordination. The Dispatch skill will show an error if you try to use it without task coordination.
