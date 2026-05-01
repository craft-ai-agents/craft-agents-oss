# `automation-creator` skill

Lets a conversational agent build a new automation matcher for the user via dialogue.

## What the user experience looks like

```
User:    Every morning at 8 I want my @researcher agent to summarize the
         top of Hacker News and send it to Telegram.

Concierge:  That's a scheduled trigger plus a follow-up message. A few
            checks:
            - Is your Telegram messaging tool already activated?
            - Should it summarize the front page only, or top N comments
              too?

User:    Telegram is set up. Front page is fine.

Concierge:  Here's the draft:

            **Slug:** hn-morning-digest
            **Trigger:** Schedule (cron `0 8 * * *`)
            **Action:** Run agent @researcher with prompt
              "Summarize today's HN front page in 5 punchy bullets,
               then send the result to me on Telegram."
            **Active in workspace:** yes

            Save it?

User:    Yep.

Concierge:  ✅ Created automation `hn-morning-digest`. Next fire: tomorrow
            8:00am. Manage it: /automations/hn-morning-digest
```

## File location

Mirror the existing automation storage path. The skill writes through the
`create_automation` session-tool and the host-provided automation creation
handler; it doesn't reinvent storage.

## Skill frontmatter

```yaml
---
name: Automation Creator
description: Builds a new automation through a short conversational interview, then writes the matcher.
tools:
  - create_automation
inputs: A description of what should fire automatically and what should happen.
outputs: A saved automation activated in the current workspace, plus a chat confirmation with a link.
tags: [creator, meta, automations]
---
```

## Skill body — interview script

```markdown
# Automation Creator

Use this skill when the user wants to **automate something** — a scheduled
job, a reaction to an external event, or a recurring task.

## What an automation IS

A pairing of a **trigger** (when does this fire?) and one or more
**actions** (what happens when it fires?).

Available trigger types in this workspace today:

- **SchedulerTick** — cron expression. e.g. "every weekday at 9am".
- **WebhookReceive** — incoming HTTP POST to a unique slug-keyed URL.
- **FileWatch** — a file/path on disk changes/appears/disappears.
- **PollUrl** — a watched URL's response changes.
- **MessageReceive** — inbound chat (Telegram, WhatsApp, etc., depending
  on which messaging-gateway adapters are activated).

Available actions today:
- `{ type: 'prompt', prompt }` — spawn a session with a rendered prompt.
  Optional `llmConnection`, `model`, and `thinkingLevel`.
- `{ type: 'webhook', url, method?, headers?, body? }` — send an outbound
  HTTP request.

Automation actions cannot run workflows directly today. If the user asks for
"run this workflow on a schedule", explain that scheduled workflow triggers
are not implemented yet and offer a scheduled prompt action as the closest
available option.

If the user describes something that can't be expressed as one of the
trigger types above, say so plainly — don't fudge a fit. Suggest the
closest available, or recommend the user open a feature request.

## Minimum interview

1. **The trigger.** "When should this fire?" — listen for time-based
   ("every morning"), event-based ("when an email arrives"), or
   external-system ("when a GitHub PR is opened").
2. **The action.** "What should happen?" — usually a prompt action. Get
   the prompt text, including how it should reference the trigger payload.
3. **The slug** — for WebhookReceive only. Otherwise infer a `name` from
   the description.

## Templating: `$CRAFT_*` env vars

Automation prompts use shell-style env-var expansion (`$VAR` or `${VAR}`),
not workflow-style `{{...}}` templating. The trigger payload is exposed as
`CRAFT_*` env vars at run time.

Always available:
- `$CRAFT_EVENT` — event name
- `$CRAFT_EVENT_DATA` — full payload as JSON
- `$CRAFT_SESSION_ID`, `$CRAFT_WORKSPACE_ID`

Common trigger-specific fields:

| Trigger | Use in prompt |
|---------|---------------|
| SchedulerTick | `$CRAFT_LOCAL_TIME`, `$CRAFT_LOCAL_DATE` |
| WebhookReceive | `$CRAFT_BODY`, `$CRAFT_HEADER_<KEY>`, `$CRAFT_QUERY_<KEY>` |
| FileWatch | `$CRAFT_RELATIVE_PATH`, `$CRAFT_CHANGE_TYPE` |
| PollUrl | response fields under `$CRAFT_*`; inspect `$CRAFT_EVENT_DATA` for the full payload |
| MessageReceive | `$CRAFT_FROM`, `$CRAFT_TEXT`, `$CRAFT_PLATFORM` |

## Sanity checks before saving

- If the prompt references an agent (e.g. `@researcher`), confirm that
  agent exists. If it doesn't, offer to create it via `agent-creator` first.
- The trigger's prerequisite is met (e.g. MessageReceive needs a
  messaging-gateway adapter activated; if none is, refuse and say why).
- Cron expressions parse successfully. Reuse `croner` (already a dep)
  to validate before writing.
- Slug uniqueness — same `-v2` suggestion pattern as `agent-creator`.

## The save

Always show a complete draft including:
- Slug
- Trigger type + the matcher's specific fields (cron, URL pattern, file
  glob, etc.)
- Each action: type and prompt or webhook target, with `$CRAFT_*` references shown
- Whether it'll be enabled immediately

After explicit user confirmation, call:

    create_automation({
      eventName: "SchedulerTick",
      matcher: {
        name: "HN morning digest",
        cron: "0 8 * * *",
        timezone: "America/New_York",
        permissionMode: "ask",
        actions: [{
          type: "prompt",
          prompt: "Summarize today's HN front page in 5 bullets. It's $CRAFT_LOCAL_DATE."
        }]
      }
    })

Post a one-line confirmation. Include the next-fire time if it's a schedule.

## Refusals

Refuse to create an automation that:

- Uses an unsupported `eventName`.
- Uses a trigger type whose adapter isn't installed.
- Has a malformed cron / regex / glob.
- Has empty `actions`, or a prompt action with empty `prompt`.
- Would loop infinitely (an action that fires the same trigger again —
  hard to detect generally; flag obvious cases).
```

## The `create_automation` session-tool

Lives in `@craft-agent/session-tools-core`.

### Input schema

```ts
interface CreateAutomationToolInput {
  workspaceId?: string;
  eventName: 'SchedulerTick' | 'WebhookReceive' | 'FileWatch' | 'PollUrl' | 'MessageReceive';
  matcher: {
    name?: string;
    slug?: string;             // required for WebhookReceive
    secretEnv?: string;
    cron?: string;             // required for SchedulerTick
    timezone?: string;
    watchPath?: string;        // required for FileWatch
    watchGlob?: string;
    watchChangeTypes?: ('add' | 'change' | 'remove')[];
    pollUrl?: string;          // required for PollUrl
    pollIntervalSec?: number;
    matcher?: string;
    enabled?: boolean;
    permissionMode?: 'safe' | 'ask' | 'allow-all';
    actions: Array<
      | { type: 'prompt'; prompt: string; llmConnection?: string; model?: string; thinkingLevel?: 'high' | 'medium' | 'low' | 'disabled' }
      | { type: 'webhook'; url: string; method?: string; headers?: Record<string, string>; body?: unknown }
    >;
  };
}
```

### Behavior

1. Validate `eventName`.
2. Validate `matcher.actions` has at least one supported action.
3. Validate required trigger-specific fields.
4. For `SchedulerTick` triggers, validate the cron via `croner` and compute
   the next-fire timestamp to return in the success payload.
5. For `WebhookReceive`, validate `matcher.slug`.
6. Call the host-provided automation creation handler.
7. Return:
   ```ts
   {
     ok: true,
     slug,
     eventName,
     nextFireAt?: string  // present for SchedulerTick triggers
   }
   ```

### Failure modes

- `create_automation is not available in this context`
- unsupported `eventName`
- missing or empty `matcher.actions`
- unsupported action type
- invalid `SchedulerTick` cron
- missing or invalid `WebhookReceive` slug

The skill body is responsible for handling these gracefully — most are
recoverable in dialogue.

## Edge cases worth handling

- **Vague schedules.** "Every morning" → ask "what time?" rather than
  guessing.
- **Composite intents.** User says "fire every morning AND when X
  happens" — that's two automations, not one. Offer to make both.
- **Sensitive prompts.** If the action prompt would tell a permission-
  mode-`allow-all` agent to do something destructive, push back. Default
  to `ask` mode for the spawned session.
- **External adapter not installed.** Don't pretend; tell the user what
  needs to be activated first. Optionally offer to deep-link to that
  setting.

## Implementation pointers

- Read `packages/session-tools-core/src/handlers/create-automation.ts` and
  `packages/shared/src/automations/` before changing the tool. Mirror the
  existing `eventName` + `matcher` payload shape; do not invent a new one.
- Each trigger type already has a matcher schema. The tool's job is to
  pass the user's draft into that schema, not to rebuild it.
- The "next-fire" UX bit is small but high-value — users want to know
  when the thing they just made will actually run.

## Test plan

- Unit test each failure mode (invalid cron, missing actions, invalid webhook slug).
- Integration test: tool call → automation file written → matcher
  registered with the trigger HTTP server / scheduler → emits the
  appropriate `automation.CHANGED` event.
- E2E manual: have Concierge run the skill, save a SchedulerTick automation
  with cron `* * * * *`, observe it fire within a minute and spawn the
  expected session.
