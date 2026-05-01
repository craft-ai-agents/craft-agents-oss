/**
 * Starter SKILL.md templates seeded into the global skills library.
 *
 * Mirrors the agent-definitions starter pattern. Each entry maps to a single
 * SKILL.md written under `~/.agents/skills/<slug>/`. Idempotent: existing
 * SKILL.md files are never overwritten.
 *
 * The "creator skills" (agent-creator, automation-creator) ship as built-in
 * because they're load-bearing — Concierge and Orchestrator depend on them
 * to translate "make me an agent / automation" into a structured save.
 */

export interface StarterSkill {
  slug: string;
  /** Full SKILL.md content (frontmatter + body). */
  content: string;
}

const AGENT_CREATOR_SKILL = `---
name: Agent Creator
description: Builds a new agent through a short conversational interview, then writes the AGENT.md.
tools:
  - create_agent
inputs: A wish for a new agent — anything from one sentence to a full spec.
outputs: A saved agent activated in the current workspace, plus a chat confirmation with a link.
tags: [creator, meta, agents]
---

# Agent Creator

Use this skill when the user wants to **create a new agent**.

## What you're producing

A complete AGENT.md saved at \`~/.agents/agents/<slug>/\`. Mandatory fields:
\`name\`, \`description\`, \`systemPrompt\`. Strongly preferred fields:
\`avatar\`, \`inputs\`, \`outputs\`, \`tags\`, \`permissionMode\`, \`thinkingLevel\`.
Optional: \`skills\`, \`sources\`, \`model\`, \`llmConnection\`, \`greeting\`.

## Minimum interview

Don't ask everything at once. Ask the smallest set you need to draft something:

1. **Purpose** — "What's its job?" (one sentence)
2. **I/O** — "What does it expect as input? What should it produce?"
3. **Voice** — "Cautious, neutral, or opinionated?"

That's enough to draft. Ask follow-ups only when ambiguous.

## Inferring sensibly

Most fields you can infer:

- **Slug** — kebab-case the name. If the slug already exists, the \`create_agent\` tool will suggest a numbered variant (e.g. \`-v2\`).
- **Avatar** — pick a single emoji that matches the job. Don't ask.
- **Permission mode** — default to \`ask\`. Use \`safe\` only for read-only/research roles. Never default to \`allow-all\`; only set it if the user explicitly opts in and understands the risk.
- **Thinking level** — \`medium\` for most agents; \`high\` for research/critique/planning; \`low\` only when latency matters.
- **Tags** — pull 2–4 from the description. Use lowercase, hyphenated.

## System prompt

The system prompt is the agent's persona and operating instructions. Keep it tight (~150–300 words). Include:

1. Identity — who the agent is in one sentence.
2. Inputs and how to handle them.
3. Output format expectations.
4. Constraints (what to avoid, what to never do).
5. Voice notes if the user cared about voice.

Show the prompt to the user before saving — don't bury it.

## Bundles (skills, sources)

Don't bundle anything by default. Suggest bundles only when obvious:

- A research-style agent → suggest the user add their web-search tool / source.
- A coder agent → suggest the project's MCP server.
- A writer → suggest a "voice and style" workspace context doc instead.

If the user hasn't activated a relevant skill or source, mention it but don't add a slug that won't resolve.

## The save

Always show a complete draft before saving. The draft has every field
you're going to write. After the user confirms with a clear "yes",
"save it", "looks good", or similar, call:

    create_agent({
      slug: "...",
      metadata: { name, description, avatar, permissionMode, thinkingLevel,
                  inputs, outputs, tags, ... },
      systemPrompt: "...",
      activateInWorkspace: true
    })

After the tool returns success, post a one-line confirmation with a
clickable route link: \`/agents/<slug>\`.

## Refusals / sanity checks

Refuse to create an agent that:

- Has a slug clashing with a built-in (\`concierge\`, \`orchestrator\`) — the tool will reject these.
- Has an empty or single-word system prompt — push for at least the identity sentence.
- Asks for \`permissionMode: 'allow-all'\` without the user demonstrating awareness of what that means.

If the user just wants you to do the job yourself (one-shot), do the job
instead of creating an agent. Creating an agent is for *reusable*
personas the user will run repeatedly.
`;

const AUTOMATION_CREATOR_SKILL = `---
name: Automation Creator
description: Builds a new automation through a short conversational interview, then writes the matcher.
tools:
  - create_automation
inputs: A description of what should fire automatically and what should happen.
outputs: A saved automation activated in the current workspace, plus a chat confirmation with a link.
tags: [creator, meta, automations]
---

# Automation Creator

Use this skill when the user wants to **automate something** — a scheduled
job, a reaction to an external event, or a recurring task.

## What an automation IS

A pairing of a **trigger** (when does this fire?) and one or more
**actions** (what happens when it fires?).

### Trigger types available today

- **SchedulerTick** — cron expression. e.g. "every weekday at 9am" → \`0 9 * * 1-5\`. Optional IANA \`timezone\`.
- **WebhookReceive** — inbound HTTP POST to a unique slug-keyed URL. Requires a unique \`slug\`.
- **FileWatch** — a file/path on disk changes/appears/disappears. Needs \`watchPath\` (and optional \`watchGlob\`, \`watchChangeTypes\`).
- **PollUrl** — a watched URL's response changes. Needs \`pollUrl\` and \`pollIntervalSec\` (min 30).
- **MessageReceive** — inbound chat from an active messaging gateway (Telegram, WhatsApp, etc.).

### Action types

- \`{ type: 'prompt', prompt }\` — spawns a session with the rendered prompt. Optional \`llmConnection\`, \`model\`, \`thinkingLevel\`.
- \`{ type: 'webhook', url, method?, headers?, body? }\` — sends an outbound HTTP request.

If the user describes something that can't be expressed as one of the
trigger types above, say so plainly — don't fudge a fit. Suggest the
closest available, or recommend opening a feature request.

## Minimum interview

1. **The trigger.** "When should this fire?" — listen for time-based
   ("every morning"), event-based ("when an email arrives"), or
   external-system ("when a GitHub PR is opened") cues.
2. **The action.** "What should happen?" — usually a prompt action
   referencing an agent (e.g. "Run @researcher with..."). Get the prompt
   text, including how it should reference the trigger payload.
3. **The slug** — for WebhookReceive only. Otherwise infer a \`name\` from
   the description.

## Templating: \`$CRAFT_*\` env vars

**Important:** automation prompts use **shell-style env-var expansion**
(\`$VAR\` or \`\${VAR}\`), NOT mustache/handlebars syntax. The trigger
payload is exposed as \`CRAFT_*\` env vars at run time.

Always available:
- \`$CRAFT_EVENT\` — event name
- \`$CRAFT_EVENT_DATA\` — full payload as JSON
- \`$CRAFT_SESSION_ID\`, \`$CRAFT_WORKSPACE_ID\`

Common trigger-specific fields:

| Trigger | Use in prompt |
|---------|---------------|
| SchedulerTick | \`$CRAFT_LOCAL_TIME\`, \`$CRAFT_LOCAL_DATE\` |
| WebhookReceive | \`$CRAFT_BODY\`, \`$CRAFT_HEADER_<KEY>\` (e.g. \`$CRAFT_HEADER_FROM\`), \`$CRAFT_QUERY_<KEY>\` |
| FileWatch | \`$CRAFT_RELATIVE_PATH\`, \`$CRAFT_CHANGE_TYPE\` |
| PollUrl | response fields under \`$CRAFT_*\` (check \`$CRAFT_EVENT_DATA\` for the full payload) |
| MessageReceive | \`$CRAFT_FROM\`, \`$CRAFT_TEXT\`, \`$CRAFT_PLATFORM\` |

When in doubt, fall back to \`$CRAFT_EVENT_DATA\` (the full JSON) and let
the prompt parse it.

## Sanity checks before saving

- If the prompt references an agent (e.g. \`@researcher\`), confirm that
  agent exists. If not, offer to create it via \`agent-creator\` first.
- For MessageReceive, verify a messaging gateway adapter is active. If
  none is, refuse and explain what needs to be set up.
- Cron expressions must parse — the tool validates via croner before
  writing. Bad cron = clear error back.
- For WebhookReceive, slugs must be globally unique within the
  workspace. The tool returns \`slug-exists\` if you collide.

## The save

Always show a complete draft before saving:

- Trigger type + the matcher's specific fields (cron, slug, watchPath, etc.)
- Each action: type, target agent (for prompt), prompt text with \`$CRAFT_*\` references shown
- Permission mode for spawned sessions (default \`ask\`)
- Whether it's enabled (default true)

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

After success, post a one-line confirmation. For SchedulerTick triggers,
include the next-fire timestamp returned by the tool.

## Refusals

Refuse to create an automation that:

- Uses an unsupported \`eventName\`.
- Has empty \`actions\` or a prompt action with empty \`prompt\` text.
- Has a malformed cron, or (for WebhookReceive) a malformed/duplicate slug.
- Would obviously loop infinitely (an action that fires the same trigger
  again — flag visible cases).

If the user just wants you to do the job once, do it inline instead of
creating an automation. Automations are for *recurring* or
*event-triggered* work.
`;

export const STARTER_SKILLS: StarterSkill[] = [
  { slug: 'agent-creator', content: AGENT_CREATOR_SKILL },
  { slug: 'automation-creator', content: AUTOMATION_CREATOR_SKILL },
];
