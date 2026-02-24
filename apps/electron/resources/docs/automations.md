# Automations Configuration Guide

This guide explains how to configure automations in Craft Agent to automate workflows based on events.

## What Are Automations?

Automations allow you to trigger actions automatically when specific events occur in Craft Agent. You can:
- Send prompts to create agent sessions based on events
- Execute prompts on a schedule using cron expressions
- Automate workflows based on permission mode changes, flags, or session status changes

> **Note:** Automations were previously called "Hooks" / "Tasks". If you have an existing `hooks.json` or `tasks.json` file, it will be automatically migrated to `automations.json` on workspace load. A backup is kept at the original filename with `.old` appended.

## automations.json Location

Automations are configured in `automations.json` at the root of your workspace:

```
~/.craft-agent/workspaces/{workspaceId}/automations.json
```

## Basic Structure

```json
{
  "version": 2,
  "automations": {
    "EventName": [
      {
        "name": "Optional display name",
        "matcher": "regex-pattern",
        "actions": [
          { "type": "prompt", "prompt": "Check for updates and report status" }
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
| `SessionStatusChange` | Session status changed | New status (e.g., `done`, `in_progress`) |
| `SchedulerTick` | Runs every minute | Uses cron matching |

> **Note:** `TodoStateChange` is a deprecated alias for `SessionStatusChange`. Existing configs using the old name will continue to work but will show a deprecation warning during validation.

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

## Action Types

### Prompt Actions

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

## Matcher Configuration

### Display Name

Use the optional `name` field to give an automation a human-readable display name. If omitted, the name is automatically derived from the first action.

```json
{
  "name": "Morning Weather Report",
  "cron": "0 8 * * *",
  "actions": [
    { "type": "prompt", "prompt": "Run the @weather skill" }
  ]
}
```

### Regex Matching (for most events)

Use the `matcher` field to filter which events trigger your automations:

```json
{
  "matcher": "^urgent$",
  "actions": [
    { "type": "prompt", "prompt": "An urgent label was added. Review the session and summarise the issue." }
  ]
}
```

If `matcher` is omitted, the automation triggers for all events of that type.

### Cron Matching (for SchedulerTick)

For `SchedulerTick` events, use cron expressions instead of regex:

```json
{
  "cron": "0 9 * * 1-5",
  "timezone": "America/New_York",
  "actions": [
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

The `permissionMode` field controls the permission level of sessions created by prompt actions.

```json
{
  "cron": "*/10 * * * *",
  "permissionMode": "allow-all",
  "actions": [
    { "type": "prompt", "prompt": "Check system health and log the results" }
  ]
}
```

**Permission modes:**
- `safe` - Session runs in Explore mode (default)
- `ask` - Session prompts for approval before write operations
- `allow-all` - Session auto-approves all operations

## Labels for Prompt Actions

Prompt actions can specify labels that will be applied to the session they create:

```json
{
  "cron": "0 9 * * *",
  "labels": ["Scheduled", "morning-briefing"],
  "actions": [
    { "type": "prompt", "prompt": "Give me today's priorities" }
  ]
}
```

This creates a session with the "Scheduled" and "morning-briefing" labels applied automatically.

## Complete Examples

### Daily Weather Report

```json
{
  "version": 2,
  "automations": {
    "SchedulerTick": [
      {
        "name": "Daily Weather Report",
        "cron": "0 8 * * *",
        "timezone": "Europe/Budapest",
        "labels": ["Scheduled", "weather"],
        "actions": [
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
  "version": 2,
  "automations": {
    "LabelAdd": [
      {
        "actions": [
          { "type": "prompt", "prompt": "The label $CRAFT_LABEL was added. Log this change with a timestamp." }
        ]
      }
    ],
    "LabelRemove": [
      {
        "actions": [
          { "type": "prompt", "prompt": "The label $CRAFT_LABEL was removed. Log this change with a timestamp." }
        ]
      }
    ]
  }
}
```

### Urgent Label Notification

```json
{
  "version": 2,
  "automations": {
    "LabelAdd": [
      {
        "matcher": "^urgent$",
        "actions": [
          { "type": "prompt", "prompt": "An urgent label was added to this session. Triage the session and summarise what needs immediate attention." }
        ]
      }
    ]
  }
}
```

### Permission Mode Change Notification

```json
{
  "version": 2,
  "automations": {
    "PermissionModeChange": [
      {
        "matcher": "allow-all",
        "actions": [
          { "type": "prompt", "prompt": "The permission mode was changed to allow-all. Log the change and note any security implications." }
        ]
      }
    ]
  }
}
```

## Migration from hooks.json

If you have an existing `hooks.json` or `tasks.json` file, it will be automatically migrated to `automations.json` when the workspace loads:

1. The `"hooks"` or `"tasks"` top-level key is renamed to `"automations"`
2. Inner `"hooks"` arrays are renamed to `"actions"`
3. The version is set to `2`
4. The original file is renamed with `.old` appended as a backup

All three formats (`hooks.json`, `tasks.json`, and `automations.json`) are recognized during the transition.

## Validation

Automations are validated when:
1. The workspace is loaded
2. You edit automations.json (via PreToolUse hook)
3. You run `config_validate` with target `automations` or `all`

**Using config_validate:**

Ask Craft Agent to validate your automations configuration:

```
Validate my automations configuration
```

Or use the `config_validate` tool directly with `target: "automations"`.

**Common validation errors:**
- Invalid JSON syntax
- Unknown event names
- Empty actions array
- Invalid cron expression
- Invalid timezone
- Invalid regex pattern
- Potentially unsafe regex patterns (nested quantifiers)

**To validate manually:**

```bash
# Check automations.json syntax
cat automations.json | jq .
```

## Rate Limits

To protect against runaway automations (e.g., an automation that indirectly triggers itself in a loop), the event bus enforces per-event-type rate limits:

| Event | Max fires / minute |
|-------|--------------------|
| `SchedulerTick` | 60 (1/sec) |
| All others (`LabelAdd`, `FlagChange`, `PreToolUse`, etc.) | 10 |

When a limit is hit, further events of that type are **silently dropped** for the remainder of the 60-second window. A warning is logged. The window resets automatically.

**Example:** If you have a `LabelAdd` task that triggers a prompt which adds a label back to a session, it will fire at most 10 times before being rate-limited — preventing infinite session creation.

## Troubleshooting

### Automation not firing

1. **Check event name** - Must be exact (e.g., `LabelAdd` not `labeladd`)
2. **Check matcher** - Regex must match the event value
3. **Check cron** - For SchedulerTick, verify cron expression with an online tool
4. **Check logs** - Look for `[automations]` or `[Scheduler]` in the logs

### Prompt not creating session

1. Check that the prompt is not empty
2. Verify @mentions reference valid sources/skills

## Best Practices

1. **Start simple** - Test with a basic prompt before building complex workflows
2. **Use labels** - Tag scheduled sessions for easy filtering
3. **Be specific** - Use matchers to avoid triggering on every event
4. **Test cron** - Use [crontab.guru](https://crontab.guru/) to verify expressions
