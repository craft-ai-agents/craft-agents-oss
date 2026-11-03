# Automations Configuration Guide

This guide explains how to configure automations in Craft Agent to automate workflows based on events.

> **CLI-first workflow (recommended):** Use `craft-agent automation ...` commands instead of editing JSON directly.
> - `craft-agent automation --help`
> - Canonical command reference: [craft-cli.md](./craft-cli.md)

## What Are Automations?

Automations allow you to trigger actions automatically when specific events occur in Craft Agent. You can:
- Send prompts to create agent sessions based on events
- Send webhook HTTP requests to external services (Slack, Discord, custom APIs, etc.)
- Run scripts from the workspace (Bun, Node or Python) with the event data in `CRAFT_*` environment variables
- Execute actions on a schedule using cron expressions
- Automate workflows based on permission mode changes, flags, or session status changes

## automations.json Location

Automations are configured in `automations.json` at the root of your workspace:

```
~/.craft-agent/workspaces/{workspaceId}/automations.json
```

## Recommended CLI Commands

```bash
craft-agent automation list
craft-agent automation get <id>
craft-agent automation create --event LabelAdd --matcher "^urgent$" --prompt "..."
craft-agent automation update <id> --json '{...}'
craft-agent automation enable <id>
craft-agent automation disable <id>
craft-agent automation duplicate <id>
craft-agent automation history [<id>] --limit 20
craft-agent automation last-executed <id>
craft-agent automation test <id> --match "..."
craft-agent automation lint
craft-agent automation validate
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
| `LabelAdd` | Label added to session | The label entry: the ID for a plain label (`bug`, not `Bug`), `id::value` for a valued one (`priority::3`; match it with `^priority(::|$)`) |
| `LabelRemove` | Label removed from session | The label entry, as for `LabelAdd` |
| `LabelConfigChange` | Label configuration changed | Always matches |
| `PermissionModeChange` | Permission mode changed | New mode name |
| `FlagChange` | Session flagged/unflagged | `true` or `false` |
| `SessionStatusChange` | Session status changed | New status (e.g., `done`, `in_progress`) |
| `SchedulerTick` | Runs every minute | Uses cron matching |

> **Note:** `TodoStateChange` is a deprecated alias for `SessionStatusChange`. Existing configs using the old name will continue to work but will show a deprecation warning during validation.

> **Only these events run actions.** Agent hook events such as `PreToolUse`, `PostToolUse`, `UserPromptSubmit` or `Stop` are not automation triggers: `automations.json` still accepts them, but no action ever runs for them. Do not create automations on them.

## Action Types

### Prompt Actions

Send a prompt to Craft Agent (creates a new session for scheduled prompts).

```json
{
  "type": "prompt",
  "prompt": "Run the @weather skill and summarize the forecast"
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `"prompt"` | Required | Action type |
| `prompt` | string | Required | Prompt text to send |
| `llmConnection` | string | Workspace default | LLM connection slug (configured in AI Settings) |
| `model` | string | Workspace default | Model ID for the created session |

**Features:**
- Use `@mentions` to reference sources or skills
- The event's `CRAFT_*` variables are expanded (e.g., `$CRAFT_LABEL`); no other environment variables, so `$HOME` or an API key expands to nothing

**LLM Connection & Model:** Optionally specify which AI provider and model to use for the created session. If omitted, the workspace default connection and model are used.

```json
{
  "type": "prompt",
  "prompt": "Quick code review of recent changes",
  "llmConnection": "my-copilot-connection",
  "model": "gemini-2.5-flash"
}
```

The `llmConnection` value is the slug of an LLM connection configured in AI Settings. The `model` value is a model ID supported by the provider. If either is invalid or not found, it gracefully falls back to the workspace default. Both can be used independently or together.

### Webhook Actions

Send an HTTP request to an external endpoint when an event fires. Useful for notifications (Slack, Discord), logging to external services, or triggering external workflows.

```json
{
  "type": "webhook",
  "url": "https://hooks.slack.com/services/${CRAFT_WH_SLACK_PATH}",
  "method": "POST",
  "body": {
    "text": "Session ${CRAFT_SESSION_NAME} status changed to ${CRAFT_NEW_STATE}"
  }
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `"webhook"` | Required | Action type |
| `url` | string | Required | Target URL (http or https) |
| `method` | `"GET"` \| `"POST"` \| `"PUT"` \| `"PATCH"` \| `"DELETE"` | `"POST"` | HTTP method |
| `headers` | `Record<string, string>` | `{}` | HTTP headers as key-value pairs |
| `bodyFormat` | `"json"` \| `"form"` \| `"raw"` | `"json"` | Body serialization format |
| `body` | object or string | - | Request body (omitted for GET requests) |
| `auth` | object | - | Authentication shorthand (see below) |
| `captureResponse` | boolean | `false` | Capture response body in result (truncated to 4KB) |

> **URL validation:** Literal URLs are validated at config load time. Templated URLs (containing `$VAR`) are validated at runtime after variable expansion. Both must resolve to `http://` or `https://` — other protocols are rejected.

**Body format:**
- `json` (default) — Body is serialized as JSON. `Content-Type: application/json` is set automatically unless you override it in `headers`.
- `form` — Body object keys are URL-encoded as `application/x-www-form-urlencoded`. Useful for OAuth token endpoints, Stripe, and legacy APIs. Each value supports `$VAR` expansion.
- `raw` — Body is sent as a plain string. Set `Content-Type` in `headers` yourself.

**Authentication:**

Instead of manually constructing `Authorization` headers, you can use the `auth` shorthand:

**Bearer token:**
```json
{
  "type": "webhook",
  "url": "https://api.example.com/events",
  "auth": {
    "type": "bearer",
    "token": "${CRAFT_WH_API_TOKEN}"
  },
  "body": { "event": "$CRAFT_EVENT" }
}
```

**Basic auth (username/password):**
```json
{
  "type": "webhook",
  "url": "https://legacy.example.com/webhook",
  "auth": {
    "type": "basic",
    "username": "${CRAFT_WH_USER}",
    "password": "${CRAFT_WH_PASS}"
  }
}
```

The `auth` field is applied before custom `headers`, so you can override the generated `Authorization` header if needed. All auth field values support `$VAR` expansion.

**Response capture:** By default, webhook response bodies are discarded after reading (to release connections). Set `captureResponse: true` to capture the response body (truncated to 4KB). The captured body is included in the execution result and recorded in automation history (truncated to 500 chars).

```json
{
  "type": "webhook",
  "url": "https://api.example.com/status",
  "method": "GET",
  "captureResponse": true
}
```

> **Note:** Response capture adds memory overhead proportional to the response size. Only enable it for endpoints where you need to inspect the response.

**Variable expansion:** The `url`, `headers` values, `body`, and `auth` fields all support `$VAR` and `${VAR}` syntax for environment variable expansion. See [Environment Variables](#environment-variables) below.

**Security:** Webhook actions only have access to `CRAFT_*` system variables and `CRAFT_WH_*` user-defined secrets. They do **not** have access to your full system environment (e.g., `$HOME`, `$PATH`, or other process variables).

### Script Actions

Run a script that lives in the workspace. No session is created and no model is called, so script actions are the way to do deterministic work when an event fires: pull data, write a log, or call another program.

```json
{
  "type": "script",
  "script": "scripts/log-label.ts",
  "args": ["--verbose"],
  "runtime": "bun",
  "timeoutMs": 60000
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `"script"` | Required | Action type |
| `script` | string | Required | Script path relative to the workspace root. Absolute paths and paths that leave the workspace (also through symlinks) are rejected. |
| `args` | string[] | `[]` | Extra arguments passed after the script path |
| `runtime` | `"bun"` \| `"node"` \| `"python3"` | `"bun"` | Runtime the script runs under |
| `timeoutMs` | number | `60000` | Per-run timeout, clamped to 1,000–900,000 ms (15 min). The script gets SIGTERM, then SIGKILL if it doesn't exit. |
| `page` | string | - | Slug of the page this script refreshes: adds the `CRAFT_PAGE_*` variables and records the run on the page (see [pages.md](./pages.md)) |

**How a script runs:**
- It is spawned directly with its arguments, never through a shell, so `$(...)`, pipes and redirects are not interpreted.
- The working directory is the workspace root.
- The environment contains only `HOME` (on Windows, the basic system variables such as `USERPROFILE` and `TEMP`), the event's `CRAFT_*` variables (see [Environment Variables](#environment-variables)), `CRAFT_WORKSPACE_PATH`, and any `CRAFT_*` variables exported in your shell profile. There is **no `PATH`** and no credentials, so call other programs by absolute path (e.g. `/usr/bin/osascript`).
- Runs of the same automation never overlap: if the previous run is still going, the new one is skipped and recorded as skipped in the history.
- The exit code, stdout and stderr are recorded in the automation history (truncated).

Example script (`scripts/log-label.ts`, run by Bun):

```ts
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const session = process.env.CRAFT_SESSION_NAME ?? process.env.CRAFT_SESSION_ID;
const line = `${new Date().toISOString()} ${process.env.CRAFT_EVENT} ${process.env.CRAFT_LABEL} (${session})\n`;
appendFileSync(join(process.env.CRAFT_WORKSPACE_PATH!, 'label-log.txt'), line);
```

> **Page data on a schedule:** to refresh a Page's data, give the page a `refresh` spec (`refresh: { cron, script }`) instead of writing a `SchedulerTick` automation. See "Scheduled refresh" in [pages.md](./pages.md); it uses the same script runner.

## Environment Variables

Prompt and webhook actions expand `$VAR` and `${VAR}` in their fields; a value is inserted as it is and never expanded again. Script actions receive the same variables as environment variables (`process.env.CRAFT_LABEL`, `os.environ["CRAFT_LABEL"]`, …).

### System Variables (CRAFT_*)

These are automatically set by the automation system based on the triggering event:

| Variable | Description | Available For |
|----------|-------------|---------------|
| `$CRAFT_EVENT` | Event name (e.g., `LabelAdd`) | All events |
| `$CRAFT_EVENT_DATA` | Full event payload as JSON | All events |
| `$CRAFT_SESSION_ID` | Session ID | Events with session context |
| `$CRAFT_SESSION_NAME` | Session name | Events with session context |
| `$CRAFT_WORKSPACE_ID` | Workspace ID | All events |

**Per-event variables:**

| Event | Variable | Description |
|-------|----------|-------------|
| `LabelAdd` / `LabelRemove` | `$CRAFT_LABEL` | The label entry that was added/removed (`bug`, `priority::3`) |
| `PermissionModeChange` | `$CRAFT_OLD_MODE`, `$CRAFT_NEW_MODE` | Previous and new permission mode |
| `FlagChange` | `$CRAFT_IS_FLAGGED` | `true` or `false` |
| `SessionStatusChange` | `$CRAFT_OLD_STATE`, `$CRAFT_NEW_STATE` | Previous and new status |
| `SchedulerTick` | `$CRAFT_LOCAL_TIME`, `$CRAFT_LOCAL_DATE` | Current time (`14:30`) and date (`2026-03-09`) |

### User-Defined Webhook Secrets (CRAFT_WH_*)

For webhook actions, you can define your own secrets by setting environment variables with the `CRAFT_WH_` prefix in your shell profile (e.g., `~/.zshrc`, `~/.bashrc`):

```bash
# In your shell profile
export CRAFT_WH_SLACK_URL="https://hooks.slack.com/services/T.../B.../xxx"
export CRAFT_WH_DISCORD_URL="https://discord.com/api/webhooks/123/abc"
export CRAFT_WH_API_TOKEN="your-secret-token"
```

Then reference them in `automations.json`:

```json
{
  "type": "webhook",
  "url": "${CRAFT_WH_SLACK_URL}",
  "method": "POST",
  "body": { "text": "Hello from Craft Agent!" }
}
```

```json
{
  "type": "webhook",
  "url": "https://api.example.com/events",
  "headers": { "Authorization": "Bearer ${CRAFT_WH_API_TOKEN}" },
  "body": { "event": "${CRAFT_EVENT}", "session": "${CRAFT_SESSION_NAME}" }
}
```

This keeps secrets out of `automations.json` (which may be shared or committed to version control).

> **Note:** Only variables prefixed with `CRAFT_WH_` are injected into webhook actions. Other environment variables (like `$HOME` or `$DATABASE_URL`) are not accessible to webhooks.

> **Note:** Environment variables are not expanded during test runs (the "Test" button in the UI). Tests send the raw URL/body as configured.

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

## Conditions

Conditions are optional filters that run **after** the matcher/cron matches but **before** actions fire. All conditions in the array must pass (implicit AND). If the array is empty or omitted, actions fire unconditionally.

```json
{
  "cron": "0 9 * * *",
  "timezone": "Europe/Budapest",
  "conditions": [
    {
      "condition": "time",
      "weekday": ["mon", "tue", "wed", "thu", "fri"]
    }
  ],
  "actions": [
    { "type": "prompt", "prompt": "Good morning! Here's your daily briefing." }
  ]
}
```

### Time Conditions

Check time-of-day and day-of-week in a given timezone.

```json
{
  "condition": "time",
  "after": "09:00",
  "before": "17:00",
  "weekday": ["mon", "tue", "wed", "thu", "fri"],
  "timezone": "Europe/Budapest"
}
```

| Property | Type | Description |
|----------|------|-------------|
| `after` | `"HH:MM"` | Start of time window (inclusive) |
| `before` | `"HH:MM"` | End of time window (exclusive) |
| `weekday` | `string[]` | Allowed days: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun` |
| `timezone` | string | IANA timezone. Falls back to matcher timezone, then system local |

**Overnight ranges:** If `after` is later than `before` (e.g., `"after": "22:00", "before": "06:00"`), the range wraps across midnight.

### State Conditions

Check fields from the event payload. Useful for filtering on specific transitions or values.

```json
{
  "condition": "state",
  "field": "permissionMode",
  "from": "safe",
  "to": "allow-all"
}
```

| Property | Type | Description |
|----------|------|-------------|
| `field` | string | Payload field name (e.g., `permissionMode`, `sessionStatus`, `labels`, `isFlagged`) |
| `value` | any | Exact match |
| `from` | any | Previous value (for transition events) |
| `to` | any | New value (for transition events) |
| `contains` | string | Array membership check (e.g., check if a label is present) |
| `not_value` | any | Matches anything except this value |

**Transition fields:** For `permissionMode` and `sessionStatus`, `from`/`to` automatically resolve to the correct payload keys (`oldMode`/`newMode`, `oldState`/`newState`).

### Logical Composition

Combine conditions with `and`, `or`, and `not`:

```json
{
  "condition": "and",
  "conditions": [
    { "condition": "time", "weekday": ["mon", "tue", "wed", "thu", "fri"] },
    { "condition": "time", "after": "09:00", "before": "17:00" }
  ]
}
```

```json
{
  "condition": "or",
  "conditions": [
    { "condition": "state", "field": "permissionMode", "value": "allow-all" },
    { "condition": "state", "field": "isFlagged", "value": true }
  ]
}
```

```json
{
  "condition": "not",
  "conditions": [
    { "condition": "time", "weekday": ["sat", "sun"] }
  ]
}
```

| Type | Behaviour |
|------|-----------|
| `and` | All sub-conditions must pass |
| `or` | At least one sub-condition must pass |
| `not` | None of the sub-conditions may pass |

**Nesting depth:** Conditions can be nested up to 8 levels deep. A simplification warning is emitted at depth 4. Unknown condition types fail closed (evaluate to false).

### Semantic Condition (requires the Decision Model)

`conditions` can only compare fields. `semanticCondition` asks a yes/no question that the decision model (Jev, Settings > AI > Decision model, toggle "Automation conditions") answers before a prompt action starts a session:

```json
{
  "matcher": "^needs-triage$",
  "semanticCondition": {
    "question": "Is the user reporting a bug or crash, rather than asking a question?",
    "threshold": 0.6
  },
  "actions": [{ "type": "prompt", "prompt": "Triage the bug in session $CRAFT_SESSION_NAME" }]
}
```

| Property | Type | Description |
|----------|------|-------------|
| `question` | string | **Required.** The yes/no question, in English (max 500 characters). |
| `threshold` | number | "Yes" probability needed to run, `0 < threshold <= 1`. Default `0.5`. |

- The model sees the event (name, automation name, payload fields) and, for session events, the session's name, labels, status and its latest user and assistant messages (1,500 characters each).
- Below the threshold the run is skipped and the automation history records it as skipped, not failed.
- A matcher is judged once per event: all of its prompt actions run, or all are skipped.
- **Inert without the decision model:** when it is off, unavailable or fails, the automation runs as it would without the condition.
- **Loop guard:** an automation never runs for an event about a session it created itself (its own prompt matching a label rule would otherwise re-trigger it forever), and a chain of automation-created sessions triggering further automations stops at 3 sessions deep. Such runs are recorded as skipped.
- It applies to prompt actions only; webhook and script actions are not gated.

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

## Telegram Topic Routing

When a Telegram supergroup is paired in **Settings → Messaging → Telegram**, set
`telegramTopic` on a matcher to route its spawned sessions into a dedicated
forum topic. The topic is created on first use and reused thereafter.

```json
{
  "matcher": "^urgent$",
  "telegramTopic": "Urgent Alerts",
  "actions": [
    { "type": "prompt", "prompt": "Look at the urgent issue: $LABEL" }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `telegramTopic` | string (1–128 chars) | Topic name. Created on first use, reused thereafter. Multiple matchers using the same value share one topic. |

**Activation requirements** (all must hold; otherwise the field is silently ignored):

- A Telegram supergroup is paired in Settings → Messaging → Telegram
- The Telegram bot is connected
- The bot has the **Manage Topics** admin permission

Names are case-sensitive: `"Reports"` and `"reports"` create separate topics.

### Setting up the Telegram supergroup

If you haven't paired a supergroup yet:

1. **Create / convert a supergroup with Topics enabled.** In Telegram, open the group → tap the group name → Edit (pencil icon) → toggle **Topics** on → Save. The group must be a forum supergroup; regular groups can't host topics.
2. **Add the bot to the supergroup.** Group name → Add members → search for your bot's username → add.
3. **Promote the bot to admin with "Manage Topics".** Group name → Edit → Administrators → Add Administrator → pick the bot → toggle on **Manage Topics** → Save. This is the step most people miss; without it, topic creation fails with `400: not enough rights to create a topic`.
4. **Pair the supergroup.** In Craft Agent: Settings → Messaging → Telegram → **Pair Supergroup**. Copy the 6-digit code, then in any topic of the supergroup type `/pair <code>`. The bot confirms and the Settings row updates with the group's title.

Verify by checking the supergroup row in Settings shows the group title. If automation runs fail later, `~/.craft-agent/logs/messaging-gateway.log` will show `automation_topic_bind_failed` with the underlying Telegram error.

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

### Weekday-Only AI News (with Conditions)

Use a `time` condition to restrict a daily schedule to weekdays only:

```json
{
  "version": 2,
  "automations": {
    "SchedulerTick": [
      {
        "name": "Morning AI news",
        "cron": "0 9 * * *",
        "timezone": "Europe/Budapest",
        "conditions": [
          {
            "condition": "time",
            "weekday": ["mon", "tue", "wed", "thu", "fri"],
            "timezone": "Europe/Budapest"
          }
        ],
        "labels": ["Scheduled", "ai-news"],
        "actions": [
          { "type": "prompt", "prompt": "Run the @ai-news skill and summarize today's AI developments" }
        ]
      }
    ]
  }
}
```

### Permission Mode Gate (with Conditions)

Only notify when permission mode changes specifically from `safe` to `allow-all`:

```json
{
  "version": 2,
  "automations": {
    "PermissionModeChange": [
      {
        "conditions": [
          {
            "condition": "state",
            "field": "permissionMode",
            "from": "safe",
            "to": "allow-all"
          }
        ],
        "actions": [
          {
            "type": "webhook",
            "url": "${CRAFT_WH_SLACK_URL}",
            "method": "POST",
            "body": { "text": ":warning: Permission escalated from safe to allow-all in *${CRAFT_SESSION_NAME}*" }
          }
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

### Slack Notification on Status Change

Sends a Slack message when a session is marked as done. Requires `CRAFT_WH_SLACK_URL` in your shell profile.

```json
{
  "version": 2,
  "automations": {
    "SessionStatusChange": [
      {
        "name": "Notify Slack on Done",
        "matcher": "^done$",
        "actions": [
          {
            "type": "webhook",
            "url": "${CRAFT_WH_SLACK_URL}",
            "method": "POST",
            "body": {
              "text": ":white_check_mark: Session *${CRAFT_SESSION_NAME}* marked as done"
            }
          }
        ]
      }
    ]
  }
}
```

### Mixed Actions (Prompt + Webhook)

A single automation can have both prompt and webhook actions. They execute in order.

```json
{
  "version": 2,
  "automations": {
    "LabelAdd": [
      {
        "name": "Urgent: Notify and Triage",
        "matcher": "^urgent$",
        "actions": [
          {
            "type": "webhook",
            "url": "${CRAFT_WH_SLACK_URL}",
            "method": "POST",
            "body": { "text": ":rotating_light: Urgent label added to *${CRAFT_SESSION_NAME}*" }
          },
          {
            "type": "prompt",
            "prompt": "An urgent label was added. Triage the session and summarise what needs immediate attention."
          }
        ]
      }
    ]
  }
}
```

### Form-Encoded Request (OAuth / Stripe)

```json
{
  "version": 2,
  "automations": {
    "SchedulerTick": [
      {
        "name": "Refresh API Token",
        "cron": "0 */6 * * *",
        "actions": [
          {
            "type": "webhook",
            "url": "https://auth.example.com/oauth/token",
            "method": "POST",
            "bodyFormat": "form",
            "body": {
              "grant_type": "client_credentials",
              "client_id": "${CRAFT_WH_CLIENT_ID}",
              "client_secret": "${CRAFT_WH_CLIENT_SECRET}"
            }
          }
        ]
      }
    ]
  }
}
```

### Webhook with Custom Headers

```json
{
  "version": 2,
  "automations": {
    "SessionStatusChange": [
      {
        "name": "Log to External API",
        "actions": [
          {
            "type": "webhook",
            "url": "https://api.example.com/craft-events",
            "method": "POST",
            "headers": {
              "Authorization": "Bearer ${CRAFT_WH_API_TOKEN}",
              "X-Source": "craft-agent"
            },
            "body": {
              "event": "${CRAFT_EVENT}",
              "session_id": "${CRAFT_SESSION_ID}",
              "old_status": "${CRAFT_OLD_STATE}",
              "new_status": "${CRAFT_NEW_STATE}"
            }
          }
        ]
      }
    ]
  }
}
```

## Validation

Automations are validated when:
1. The workspace is loaded
2. You change automations with the `craft-agent automation` CLI (a direct Write/Edit of `automations.json` is redirected to the CLI, which validates before writing)
3. You run `config_validate` with target `automations` or `all`

**An invalid automation only stops itself.** When the file is loaded, each automation is checked on its own: one that fails (an unknown action type such as the removed `command`, a bad cron or regex, an unknown event) is skipped and the others keep running. The Automations screen marks it **Not running** and its page says why; agent-event automations get the same mark, because they never run. If `automations.json` isn't valid JSON, nothing new can load: the last loaded automations keep running and the screen shows the parse error.

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

## Retry Behavior

Webhook actions have two levels of automatic retry:

### Immediate retry (transient failures)

When a webhook fails with a server error (5xx), timeout, or connection error, it is automatically retried up to **2 times** with exponential backoff (1s → 2s → 4s). Client errors (4xx) are not retried — they indicate a configuration problem.

### Deferred retry (extended outages)

If all immediate retries fail, the webhook is added to a **persistent retry queue**. The queue retries at increasing intervals:

| Attempt | Delay | Cumulative |
|---------|-------|------------|
| 1st deferred | 5 minutes | 5 min |
| 2nd deferred | 30 minutes | 35 min |
| 3rd deferred | 1 hour | ~1.5 hours |

After the final deferred attempt fails, the webhook is marked as permanently failed in the history. Deferred retries survive app restarts.

> **Note:** Only transient failures (5xx, timeouts, connection errors) are retried. Client errors (4xx) indicate a configuration problem and should be fixed in `automations.json`.

> **Retry and rate limiting:** Retried webhook requests count toward the per-endpoint rate limit (30/min per origin). If a retry would exceed the limit, it is deferred to the next retry window.

## Rate Limits

To protect against runaway automations (e.g., an automation that indirectly triggers itself in a loop), the event bus enforces per-event-type rate limits:

| Event | Max fires / minute |
|-------|--------------------|
| `SchedulerTick` | 60 (1/sec) |
| All other events (`LabelAdd`, `FlagChange`, etc.) | 10 |

When a limit is hit, further events of that type are **silently dropped** for the remainder of the 60-second window. A warning is logged. The window resets automatically.

**Example:** If you have a `LabelAdd` task that triggers a prompt which adds a label back to a session, it will fire at most 10 times before being rate-limited — preventing infinite session creation.

## Troubleshooting

### Automation not firing

1. **Check event name** - Must be exact (e.g., `LabelAdd` not `labeladd`)
2. **Check the event is supported** - Only the events under [Supported Events](#supported-events) run actions; hook events such as `PreToolUse` or `Stop` never do
3. **Check matcher** - Regex must match the event value
4. **Check cron** - For SchedulerTick, verify cron expression with an online tool
5. **Check logs** - Look for `[automations]` or `[Scheduler]` in the logs

### Script not running

1. **Check the path** - `script` must be relative to the workspace root and stay inside it
2. **Check the history** - The automation history shows the exit code, stdout and stderr of each run; a run marked skipped means the previous run was still going
3. **Check programs it calls** - Scripts get no `PATH`; call other programs by absolute path
4. **Check the timeout** - Long-running scripts are stopped after `timeoutMs` (default 60 s)

### Prompt not creating session

1. Check that the prompt is not empty
2. Verify @mentions reference valid sources/skills

### Webhook not working

1. **Check URL** — Must be a valid `http://` or `https://` URL. Other protocols (ftp, ws, etc.) are rejected at runtime with a clear error.
2. **Check env vars** — Ensure `CRAFT_WH_*` variables are set in your shell profile and Craft Agent was restarted after adding them. URLs using `$VAR` templates are validated after variable expansion — if the variable is empty or unset, the URL will be invalid.
3. **Use the Test button** — Tests connectivity to the URL (note: env vars are not expanded during test)
4. **Check method** — Some endpoints require specific HTTP methods (POST, PUT, etc.)
5. **Check response** — The automation history shows HTTP status codes for webhook executions

### Retrying failed webhooks

When a webhook execution fails (shown with a red indicator in the timeline), you can retry it:

1. Open the automation's detail page
2. In the "Recent Activity" timeline, failed webhook entries show a **Retry** button
3. Click "Retry" to re-execute the webhook actions immediately
4. The retry result is recorded as a new history entry

> **Note:** Retries execute the webhook actions as currently configured. If you've changed the URL or headers since the original failure, the retry uses the updated configuration. Environment variables are not expanded during replay (same as the Test button).

## Best Practices

1. **Start simple** - Test with a basic prompt before building complex workflows
2. **Use labels** - Tag scheduled sessions for easy filtering
3. **Be specific** - Use matchers to avoid triggering on every event
4. **Test cron** - Use [crontab.guru](https://crontab.guru/) to verify expressions
5. **Keep secrets out of config** - Use `CRAFT_WH_*` env vars for webhook URLs and tokens instead of hardcoding them in automations.json
6. **Combine actions** - Use both webhook and prompt actions in a single automation for notification + AI response workflows
