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

Mirror the existing automation storage path. (Look in `packages/shared/src/automations/` to confirm — most likely `~/.craft-agent/workspaces/<id>/automations/<slug>/automation.json` or similar. The skill writes wherever the existing `upsertAutomation` RPC writes; it doesn't reinvent storage.)

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
job, a reaction to an external event, or a recurring multi-step process.

## What an automation IS

A pairing of a **trigger** (when does this fire?) and an **action** (what
happens when it fires?).

Available trigger types in this workspace today:

- **Schedule** — cron expression. e.g. "every weekday at 9am".
- **WebhookReceive** — incoming HTTP POST to a unique URL.
- **FileWatch** — a file on disk changes/appears/disappears.
- **PollUrl** — a watched URL's response changes.
- **MessageReceive** — inbound chat (Telegram, WhatsApp, etc., depending
  on which messaging-gateway adapters are activated).

Available actions today:
- **RunAgent** — spawn a session with a chosen agent and a templated
  prompt that can reference the trigger payload.
- (Future) **RunWorkflow** — once workflows ship.

If the user describes something that can't be expressed as one of the
trigger types above, say so plainly — don't fudge a fit. Suggest the
closest available, or recommend the user open a feature request.

## Minimum interview

1. **The trigger.** "When should this fire?" — listen for time-based
   ("every morning"), event-based ("when an email arrives"), or
   external-system ("when a GitHub PR is opened").
2. **The action.** "What should happen?" — usually "run @<agent>". Get
   the prompt the agent should receive, including how to reference the
   trigger payload (e.g. `{{trigger.from}}` for an email's sender).
3. **The slug** if it isn't obvious from the description.

## Templating the action prompt

Trigger payloads expose fields via `{{trigger.<field>}}` syntax (same
shape as workflow templating). The skill should know the common payload
fields per trigger type and offer them in the draft:

| Trigger | Common fields |
|---------|---------------|
| Schedule | `{{trigger.firedAt}}` |
| WebhookReceive | `{{trigger.body}}`, `{{trigger.headers.<x>}}` |
| FileWatch | `{{trigger.path}}`, `{{trigger.changeType}}` |
| PollUrl | `{{trigger.url}}`, `{{trigger.responseBody}}` |
| MessageReceive | `{{trigger.from}}`, `{{trigger.text}}`, `{{trigger.platform}}` |

Confirm the actual schema by reading
`packages/shared/src/automations/utils.ts` (matcher adapters) before
asserting field names.

## Sanity checks before saving

- The agent the user names actually exists. If it doesn't, offer to
  create it via `agent-creator` first, then come back.
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
- Action: agent slug + the templated prompt
- Whether it'll be enabled immediately

After explicit user confirmation, call:

    create_automation({
      slug: "...",
      trigger: { type: "...", config: { ... } },
      action: { type: "RunAgent", agentSlug: "...", promptTemplate: "..." },
      enabled: true,
      activateInWorkspace: true
    })

Post a one-line confirmation with route link `/automations/<slug>` and
the next-fire time if it's a schedule.

## Refusals

Refuse to create an automation that:

- Targets an agent that doesn't exist (offer to create it first).
- Uses a trigger type whose adapter isn't installed.
- Has a malformed cron / regex / glob.
- Would loop infinitely (an action that fires the same trigger again —
  hard to detect generally; flag obvious cases).
```

## The `create_automation` session-tool

Lives in `@craft-agent/session-tools-core`.

### Input schema

```ts
interface CreateAutomationToolInput {
  slug: string;
  trigger: {
    type: 'Schedule' | 'WebhookReceive' | 'FileWatch' | 'PollUrl' | 'MessageReceive';
    // Type-specific config — match existing matcher schemas in
    // packages/shared/src/automations/
    config: Record<string, unknown>;
  };
  action: {
    type: 'RunAgent';
    agentSlug: string;
    promptTemplate: string;
    sessionOptions?: {
      permissionMode?: 'safe' | 'ask' | 'allow-all';
      thinkingLevel?: ThinkingLevel;
    };
  };
  enabled?: boolean;          // default true
  activateInWorkspace?: boolean;  // default true
  overwrite?: boolean;        // default false
}
```

### Behavior

1. Validate slug shape (same regex as agents/skills).
2. Validate trigger config against the matcher's schema (each trigger
   type has its own — wire to the existing matcher adapters in
   `src/automations/utils.ts` rather than duplicating).
3. Check that `action.agentSlug` resolves in the global library.
4. For `Schedule` triggers, validate the cron via `croner` and compute
   the next-fire timestamp to return in the success payload.
5. Check for slug conflict; honor `overwrite` flag.
6. Call existing `upsertAutomation` RPC.
7. If `activateInWorkspace !== false`, mark active in the current
   workspace.
8. Return:
   ```ts
   {
     ok: true,
     slug,
     route: '/automations/<slug>',
     nextFireAt?: string  // present for Schedule triggers
   }
   ```

### Failure modes

- `slug-exists` → `{ ok: false, error: 'slug-exists', suggestedSlug }`
- `agent-not-found` → `{ ok: false, error: 'agent-not-found', agentSlug }`
- `invalid-cron` → `{ ok: false, error: 'invalid-cron', message }`
- `trigger-prerequisite-missing` → `{ ok: false, error: 'trigger-prerequisite-missing', detail: 'No messaging-gateway adapter is active.' }`

The skill body is responsible for handling these gracefully — most are
recoverable in dialogue ("oops, the agent doesn't exist, want me to
create it first?").

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

- Read `packages/shared/src/automations/` and find the existing
  `upsertAutomation` RPC channel before writing the tool. Mirror its
  payload shape; do not invent a new one.
- Each trigger type already has a matcher schema. The tool's job is to
  pass the user's draft into that schema, not to rebuild it.
- The "next-fire" UX bit is small but high-value — users want to know
  when the thing they just made will actually run.

## Test plan

- Unit test each failure mode (invalid cron, agent not found, etc.).
- Integration test: tool call → automation file written → matcher
  registered with the trigger HTTP server / scheduler → emits the
  appropriate `automation.CHANGED` event.
- E2E manual: have Concierge run the skill, save a Schedule automation
  with cron `* * * * *`, observe it fire within a minute and spawn the
  expected session.
