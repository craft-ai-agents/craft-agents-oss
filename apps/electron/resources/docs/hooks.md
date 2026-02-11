# Hooks

Hooks enable event-driven automation in G4 OS. When specific events occur (label changes, tool usage, scheduled times), hooks execute shell commands, create sessions, or log events.

## Configuration

Create `hooks.json` in your workspace directory:

```
~/.g4os/workspaces/{workspace-id}/hooks.json
```

### Format

```json
{
  "version": 1,
  "hooks": {
    "EventType": [
      {
        "matcher": "regex-pattern",
        "permissionMode": "allow-all",
        "hooks": [
          { "type": "command", "command": "echo 'Hello'" },
          { "type": "prompt", "prompt": "Summarize this session" },
          { "type": "event-log" }
        ]
      }
    ]
  }
}
```

## Event Types

### App Events

| Event | Fires When | Match Value |
|-------|-----------|-------------|
| `LabelAdd` | Label added to session | Label name |
| `LabelRemove` | Label removed from session | Label name |
| `PermissionModeChange` | Permission mode changed | New mode |
| `FlagChange` | Session flagged/unflagged | `true`/`false` |
| `TodoStateChange` | Todo state changed | New state |
| `SchedulerTick` | Every 60 seconds (aligned to minute) | — |
| `LabelConfigChange` | Label definitions changed | — |

### Agent Events

| Event | Fires When | Match Value |
|-------|-----------|-------------|
| `PreToolUse` | Before tool execution | Tool name |
| `PostToolUse` | After successful tool execution | Tool name |
| `PostToolUseFailure` | After failed tool execution | Tool name |
| `SessionStart` | Agent created for session | — |
| `SessionEnd` | Agent destroyed | — |
| `SubagentStart` | Subagent spawned | Agent type |
| `SubagentStop` | Subagent stopped | Agent ID |

## Hook Actions

### Command

Execute a shell command:

```json
{
  "type": "command",
  "command": "notify-send 'Task flagged!'",
  "timeout": 30000,
  "cwd": "/path/to/dir"
}
```

**Environment variables** available in commands:

| Variable | Description |
|----------|-------------|
| `G4OS_HOOK_EVENT` | Event type (e.g., `LabelAdd`) |
| `G4OS_WORKSPACE_ID` | Workspace ID |
| `G4OS_SESSION_ID` | Session ID (if applicable) |
| `G4OS_TIMESTAMP` | Event timestamp |
| `G4OS_LABEL` | Label name (LabelAdd/LabelRemove) |
| `G4OS_ALL_LABELS` | Comma-separated labels |
| `G4OS_TOOL_NAME` | Tool name (PreToolUse/PostToolUse) |
| `G4OS_IS_FLAGGED` | Flag state (FlagChange) |
| `G4OS_OLD_MODE` / `G4OS_NEW_MODE` | Permission modes |
| `G4OS_OLD_TODO_STATE` / `G4OS_NEW_TODO_STATE` | Todo states |
| `G4OS_ERROR` | Error message (PostToolUseFailure) |

### Prompt

Create a new session with a prompt:

```json
{
  "type": "prompt",
  "prompt": "Good morning! Check my calendar.",
  "permissionMode": "ask",
  "model": "claude-sonnet-4-5-20250929",
  "labels": ["daily-briefing"],
  "enabledSourceSlugs": ["google-calendar"]
}
```

### Event Log

Log events to a JSONL file for debugging:

```json
{
  "type": "event-log",
  "logFile": "~/.g4os/hooks-log.jsonl"
}
```

Default log file: `~/.g4os/hooks-log.jsonl`

## Matcher Options

### Regex Matcher

Match against the event's primary value:

```json
{
  "matcher": "^urgent$",
  "hooks": [...]
}
```

### Cron (SchedulerTick only)

Fire on a schedule using cron expressions:

```json
{
  "cron": "0 9 * * 1-5",
  "timezone": "America/Sao_Paulo",
  "hooks": [...]
}
```

Supports standard 5-field cron syntax.

### Label Filter

Only fire if the session has specific labels:

```json
{
  "labels": ["project-x"],
  "hooks": [...]
}
```

### Permission Mode Override

Override permission mode for command hooks:

```json
{
  "permissionMode": "allow-all",
  "hooks": [{ "type": "command", "command": "..." }]
}
```

## Examples

### Notify on urgent labels

```json
{
  "version": 1,
  "hooks": {
    "LabelAdd": [
      {
        "matcher": "^urgent$",
        "permissionMode": "allow-all",
        "hooks": [
          { "type": "command", "command": "notify-send 'Urgent task added!'" }
        ]
      }
    ]
  }
}
```

### Daily morning briefing

```json
{
  "version": 1,
  "hooks": {
    "SchedulerTick": [
      {
        "cron": "0 9 * * 1-5",
        "timezone": "America/Sao_Paulo",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Good morning! Check my calendar and summarize today's agenda.",
            "labels": ["daily-briefing"],
            "permissionMode": "ask"
          }
        ]
      }
    ]
  }
}
```

### Log all tool usage

```json
{
  "version": 1,
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [{ "type": "event-log" }]
      }
    ],
    "PostToolUseFailure": [
      {
        "hooks": [{ "type": "event-log" }]
      }
    ]
  }
}
```

### Run tests on file edits

```json
{
  "version": 1,
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "permissionMode": "allow-all",
        "hooks": [
          { "type": "command", "command": "cd $G4OS_WORKSPACE_ID && npm test 2>&1 | tail -5" }
        ]
      }
    ]
  }
}
```

## Validation

Use the `config_validate` tool to check your hooks configuration:

```
config_validate target=hooks
```

## Security

- Command hooks sanitize event data in environment variables to prevent shell injection
- Commands have a default 30-second timeout with SIGTERM + SIGKILL fallback
- Rate limiting prevents runaway hook execution (10 events/min default, 60/min for SchedulerTick)
- Command output is capped at 100KB per execution

## Live Reload

Hooks configuration is automatically reloaded when `hooks.json` is modified. No restart required.
