# Hooks Configuration Guide

This guide explains how to configure hooks in Craft Agent to automate workflows based on events.

## What Are Hooks?

Hooks allow you to trigger actions automatically when specific events occur in Craft Agent. You can:
- Run shell commands when labels are added/removed
- Execute prompts on a schedule using cron expressions
- Automate workflows based on permission mode changes, flags, or todo state changes

## hooks.json Location

Hooks are configured in `hooks.json` at the root of your workspace:

```
~/.craft-agent/workspaces/{workspaceId}/hooks.json
```

## Basic Structure

```json
{
  "version": 1,
  "hooks": {
    "EventName": [
      {
        "matcher": "regex-pattern",
        "hooks": [
          { "type": "command", "command": "echo 'Hello'" }
        ]
      }
    ]
  }
}
```

## Supported Events

### App Events (triggered by Craft Agent)

| Event | Trigger | Match Value |
|-------|---------|-------------|
| `LabelAdd` | Label added to session | Label ID (e.g., `bug`, not `Bug`) |
| `LabelRemove` | Label removed from session | Label ID (e.g., `bug`, not `Bug`) |
| `LabelConfigChange` | Label configuration changed | Always matches |
| `PermissionModeChange` | Permission mode changed | New mode name |
| `FlagChange` | Session flagged/unflagged | `true` or `false` |
| `TodoStateChange` | Todo status changed | New status (e.g., `done`, `in_progress`) |
| `SchedulerTick` | Runs every minute | Uses cron matching |

### Agent Events (passed to Claude SDK)

| Event | Trigger | Match Value |
|-------|---------|-------------|
| `PreToolUse` | Before a tool executes | Tool name |
| `PostToolUse` | After a tool executes successfully | Tool name |
| `PostToolUseFailure` | After a tool execution fails | Tool name |
| `Notification` | Notification received | - |
| `UserPromptSubmit` | User submits a prompt | - |
| `SessionStart` | Session starts | - |
| `SessionEnd` | Session ends | - |
| `Stop` | Agent stops | - |
| `SubagentStart` | Subagent spawned | - |
| `SubagentStop` | Subagent completes | - |
| `PreCompact` | Before context compaction | - |
| `PermissionRequest` | Permission requested | - |
| `Setup` | Initial setup | - |

## Hook Types

### Command Hooks

Execute a shell command when the event fires.

```json
{
  "type": "command",
  "command": "echo 'Event triggered!'",
  "timeout": 60000
}
```

**Environment variables available:**
- `CRAFT_EVENT` - Event name (e.g., "LabelAdd")
- `CRAFT_EVENT_DATA` - Full event data as JSON
- `CRAFT_SESSION_ID` - Current session ID
- `CRAFT_WORKSPACE_ID` - Current workspace ID
- `CRAFT_WORKING_DIR` - Current working directory
- Event-specific variables (e.g., `CRAFT_LABEL` for label events)

### Prompt Hooks

Send a prompt to Craft Agent (creates a new session for scheduled prompts).

```json
{
  "type": "prompt",
  "prompt": "Run the @weather skill and summarize the forecast"
}
```

**Features:**
- Use `@mentions` to reference sources or skills
- Environment variables are expanded (e.g., `$CRAFT_LABEL`)
- Only supported for App events (not Agent events)

## Matcher Configuration

### Regex Matching (for most events)

Use the `matcher` field to filter which events trigger your hooks:

```json
{
  "matcher": "^urgent$",
  "hooks": [
    { "type": "command", "command": "notify-send 'Urgent label added!'" }
  ]
}
```

If `matcher` is omitted, the hook triggers for all events of that type.

### Cron Matching (for SchedulerTick)

For `SchedulerTick` events, use cron expressions instead of regex:

```json
{
  "cron": "0 9 * * 1-5",
  "timezone": "America/New_York",
  "hooks": [
    { "type": "prompt", "prompt": "Give me a morning briefing" }
  ]
}
```

**Cron format:** `minute hour day-of-month month day-of-week`

| Field | Values |
|-------|--------|
| Minute | 0-59 |
| Hour | 0-23 |
| Day of month | 1-31 |
| Month | 1-12 |
| Day of week | 0-6 (0 = Sunday) |

**Examples:**
- `*/15 * * * *` - Every 15 minutes
- `0 9 * * *` - Daily at 9:00 AM
- `0 9 * * 1-5` - Weekdays at 9:00 AM
- `30 14 1 * *` - 1st of each month at 2:30 PM

**Timezone:** Use IANA timezone names (e.g., `Europe/Budapest`, `America/New_York`). Defaults to system timezone if not specified.

## Permission Mode

By default, command hooks are subject to the same security rules as bash commands in Explore mode. To bypass these checks for trusted automation:

```json
{
  "cron": "*/10 * * * *",
  "permissionMode": "allow-all",
  "hooks": [
    { "type": "command", "command": "echo \"$(date)\" >> /tmp/log.txt" }
  ]
}
```

**Permission modes:**
- `safe` - Commands are checked against allowlist (default)
- `ask` - Not currently used for hooks
- `allow-all` - Bypass security checks (use with caution!)

**Warning:** Only use `allow-all` for commands you fully trust. It allows arbitrary shell execution.

## Labels for Prompt Hooks

Prompt hooks can specify labels that will be applied to the session they create:

```json
{
  "cron": "0 9 * * *",
  "labels": ["Scheduled", "morning-briefing"],
  "hooks": [
    { "type": "prompt", "prompt": "Give me today's priorities" }
  ]
}
```

This creates a session with the "Scheduled" and "morning-briefing" labels applied automatically.

## Complete Examples

### Daily Weather Report

```json
{
  "version": 1,
  "hooks": {
    "SchedulerTick": [
      {
        "cron": "0 8 * * *",
        "timezone": "Europe/Budapest",
        "labels": ["Scheduled", "weather"],
        "hooks": [
          { "type": "prompt", "prompt": "Run the @weather skill and give me today's forecast" }
        ]
      }
    ]
  }
}
```

### Log Label Changes

```json
{
  "version": 1,
  "hooks": {
    "LabelAdd": [
      {
        "permissionMode": "allow-all",
        "hooks": [
          { "type": "command", "command": "echo \"[$(date)] Added: $CRAFT_LABEL\" >> ~/label-log.txt" }
        ]
      }
    ],
    "LabelRemove": [
      {
        "permissionMode": "allow-all",
        "hooks": [
          { "type": "command", "command": "echo \"[$(date)] Removed: $CRAFT_LABEL\" >> ~/label-log.txt" }
        ]
      }
    ]
  }
}
```

### Urgent Label Notification

```json
{
  "version": 1,
  "hooks": {
    "LabelAdd": [
      {
        "matcher": "^urgent$",
        "permissionMode": "allow-all",
        "hooks": [
          { "type": "command", "command": "osascript -e 'display notification \"Urgent session flagged\" with title \"Craft Agent\"'" }
        ]
      }
    ]
  }
}
```

### Execute Mode Change Logging

```json
{
  "version": 1,
  "hooks": {
    "PermissionModeChange": [
      {
        "matcher": "allow-all",
        "permissionMode": "allow-all",
        "hooks": [
          { "type": "command", "command": "echo \"$(date): Execute mode enabled\" >> ~/mode-changes.log" }
        ]
      }
    ]
  }
}
```

## Validation

Hooks are validated when:
1. The workspace is loaded
2. You edit hooks.json (via PreToolUse hook)
3. You run `config_validate` with target `hooks` or `all`

**Using config_validate:**

Ask Craft Agent to validate your hooks configuration:

```
Validate my hooks configuration
```

Or use the `config_validate` tool directly with `target: "hooks"`.

**Common validation errors:**
- Invalid JSON syntax
- Unknown event names
- Empty hooks array
- Invalid cron expression
- Invalid timezone
- Invalid regex pattern
- Potentially unsafe regex patterns (nested quantifiers)

**To validate manually:**

```bash
# Check hooks.json syntax
cat hooks.json | jq .
```

## Rate Limits

To protect against runaway hooks (e.g., a hook that indirectly triggers itself in a loop), the event bus enforces per-event-type rate limits:

| Event | Max fires / minute |
|-------|--------------------|
| `SchedulerTick` | 60 (1/sec) |
| All others (`LabelAdd`, `FlagChange`, `PreToolUse`, etc.) | 10 |

When a limit is hit, further events of that type are **silently dropped** for the remainder of the 60-second window. A warning is logged. The window resets automatically.

**Example:** If you have a `LabelAdd` hook that triggers a prompt which adds a label back to a session, it will fire at most 10 times before being rate-limited — preventing infinite session creation.

## Troubleshooting

### Hook not firing

1. **Check event name** - Must be exact (e.g., `LabelAdd` not `labeladd`)
2. **Check matcher** - Regex must match the event value
3. **Check cron** - For SchedulerTick, verify cron expression with an online tool
4. **Check logs** - Look for `[hooks]` or `[Scheduler]` in the logs

### Command blocked

If you see "Bash command blocked" errors:
1. Add `"permissionMode": "allow-all"` to the hook matcher
2. Or simplify the command to avoid shell constructs like `$()`

### Prompt not creating session

1. Ensure the event is an App event (not Agent event)
2. Check that the prompt is not empty
3. Verify @mentions reference valid sources/skills

## Best Practices

1. **Start simple** - Test with echo commands before complex scripts
2. **Use labels** - Tag scheduled sessions for easy filtering
3. **Set timeouts** - Prevent runaway commands with the `timeout` field
4. **Log failures** - Redirect stderr to track issues: `command 2>> ~/hook-errors.log`
5. **Be specific** - Use matchers to avoid triggering on every event
6. **Test cron** - Use [crontab.guru](https://crontab.guru/) to verify expressions
