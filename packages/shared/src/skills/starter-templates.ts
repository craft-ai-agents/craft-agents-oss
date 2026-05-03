/**
 * Starter SKILL.md templates seeded into the global skills library.
 *
 * Mirrors the agent-definitions starter pattern. Each entry maps to a single
 * SKILL.md written under `~/.agents/skills/<slug>/`. Idempotent: existing
 * SKILL.md files are never overwritten.
 *
 * The "creator skills" (agent-creator, automation-creator) ship as built-in
 * because they're load-bearing — Concierge and Orchestrator depend on them
 * to translate "make me an agent / automation / workflow" into a structured
 * draft or save.
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
6. **Memory scope hint** — one sentence telling the new agent how to choose between \`scope: agent\` and \`scope: user\` when calling \`save_memory\`. The rule: facts about the user themselves (identity, durable preferences, cross-agent knowledge) → \`scope: user\`; facts about how *this specific agent* should collaborate with the user → \`scope: agent\` (the default).

For specialist agents (researcher, writer, coder, critic, etc.), bias the hint toward \`scope: agent\` — most of what they learn is about their own collaboration style. For coordinator/router agents (anything that summons or talks across other agents), bias toward \`scope: user\` — their facts usually generalize.

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

const WORKFLOW_CREATOR_SKILL = `---
name: Workflow Creator
description: Interviews the user briefly, then drafts a valid WORKFLOW.md for a reusable manual workflow.
tools:
  - list_agents
  - list_workflows
  - get_workflow
inputs: A description of a repeatable multi-step agent workflow.
outputs: A complete WORKFLOW.md draft the user can save in the workflow editor.
tags: [creator, meta, workflows]
---

# Workflow Creator

Use this skill when the user wants to **create a reusable workflow**: a
fixed sequence of agent steps that can be run repeatedly from the Workflows
UI.

## What you're producing

A complete \`WORKFLOW.md\` file for \`~/.workflows/<slug>/WORKFLOW.md\`.
There is no \`create_workflow\` session tool available today, so do not claim
you can save it directly. Produce the draft, get confirmation, then tell the
user to create or edit the workflow in the Workflows UI with this source.
You may use \`list_agents\` to verify agent slugs and \`list_workflows\` /
\`get_workflow\` to avoid duplicating an existing workflow.

Supported frontmatter today:

- Top level: \`name\`, \`description\`, optional \`avatar\`, \`trigger\`,
  \`steps\`.
- Trigger: only \`{ type: manual }\` is supported. Optional
  \`trigger.inputs\` drives the run form.
- Trigger inputs: \`name\`, \`type\` (\`string\`, \`number\`, or \`boolean\`),
  optional \`required\`, \`default\`, \`description\`.
- Step: \`id\`, \`agent\`, \`input\`, optional \`description\`,
  \`outputSchema\`, \`timeout\`, \`retries\`, \`onFailure\`, \`completion\`.
- \`completion\`: optional object with \`requireNonEmptyOutput\`,
  \`minOutputChars\`, and \`requireToolUse\`. Use it when a step must produce
  a substantive answer or actually call tools before it can succeed.
- \`onFailure\`: one of \`stop\`, \`continue\`, \`ask\`. \`stop\` fails the run,
  \`continue\` records the failed step and runs later steps, and \`ask\` stops
  until human checkpoint support lands.

Unsupported today: schedule/webhook/automation workflow triggers, \`when\`,
\`humanCheckpoint\`, \`parallelGroup\`, loops, branching, and sub-workflows.
If the user asks for those, explain the limitation and draft the closest
manual sequential workflow instead.

## Minimum interview

Ask only what you need to draft:

1. **Outcome** — "What should this workflow produce at the end?"
2. **Run inputs** — "What should you fill in when you click Run?"
3. **Steps and agents** — "Which agents should run, in what order?"
4. **Reliability** — only if needed: "Should any step require tool use,
   a minimum-length answer, a timeout, retries, or structured JSON output?"

If the user already gave enough detail, skip the interview and draft.

## Validity rules

- Slugs and step IDs use lowercase letters, digits, and hyphens only.
- Trigger input names use letters, digits, and underscores, and must not
  start with a digit.
- Every step needs \`id\`, \`agent\`, and non-empty \`input\`.
- Step inputs may reference only declared trigger inputs and earlier steps.
- Valid template tokens are:
  - \`{{trigger.<input_name>}}\`
  - \`{{steps.<previous_step_id>.output}}\`
  - \`{{steps.<previous_step_id>.output.<path>}}\` for structured JSON output
  - \`{{run.id}}\`
  - \`{{run.startedAt}}\`
- No expressions, filters, conditionals, loops, or future-step references.

## Structured output

Use \`outputSchema\` when a later step needs reliable fields from an earlier
step. Keep schemas simple and include a top-level \`type\`.

Example:

\`\`\`yaml
outputSchema:
  type: object
  required: [summary, priority]
  properties:
    summary:
      type: string
    priority:
      type: string
      enum: [low, medium, high]
\`\`\`

Then later steps can reference \`{{steps.triage.output.summary}}\`.

## Draft format

Always show a complete source draft:

\`\`\`markdown
---
name: Customer Feedback Digest
description: Triage feedback, summarize themes, and draft follow-up actions.
avatar: 🧭
trigger:
  type: manual
  inputs:
    - name: feedback
      type: string
      required: true
      description: Raw feedback or support transcript
steps:
  - id: triage
    agent: triager
    input: |
      Classify this feedback and extract the core issue:

      {{trigger.feedback}}
    outputSchema:
      type: object
      required: [category, summary]
      properties:
        category:
          type: string
        summary:
          type: string
    timeout: 300
    retries: 1
  - id: action-plan
    agent: writer
    input: |
      Draft a short action plan for this category:
      {{steps.triage.output.category}}

      Summary:
      {{steps.triage.output.summary}}
---
# Customer Feedback Digest

Run this when you have raw customer feedback and want a clean action plan.
\`\`\`

## Confirmation and handoff

After showing the draft, ask "Use this as the workflow source?" If the user
confirms, do not call a non-existent tool. Tell them:

1. Create a workflow from the Workflows page.
2. Use the inferred slug.
3. Paste the confirmed \`WORKFLOW.md\` source into the editor.

If a workflow save tool becomes available in the future, use it only after
showing the full draft and receiving explicit confirmation.
`;

const SOURCE_RECIPE_SKILL = `---
name: Source Recipe
description: "When the user (or another agent) is choosing which sources/tools (MCP servers, APIs, connectors) to bundle into a new agent, asking 'what sources should this agent have,' 'which tools to give it,' 'what's the right tool set for this job,' or generally curating a focused source bundle. Also triggered during agent creation when the source-bundle step is reached. Reads the live source catalog via list_sources and applies curation rules: cap at 3, match to actual job, anti-pairing detection, dormant-source activation suggestions."
tags: [creator, meta, agents, curation, sources]
metadata:
  version: 1.0.0
---

# Source Recipe

Use this skill whenever you are deciding which sources (MCP servers, APIs, local connectors)
to bundle into an agent. The cap is tighter than skills — **3 sources per agent maximum** —
because each source spawns a process and adds tool surface area to every prompt.

## Process

1. **Call \\\`list_sources\\\` with \\\`activeOnly: true\\\`** to see what's actually spawnable in this
   workspace. Sources with \\\`tier: 'global-dormant'\\\` are not returned (you can ask for them
   separately if the user explicitly wants to discover what else is available).
2. **Read the user's intent.** What concrete actions will the agent take? A research agent
   reads sources; a writer agent might not need any; a project-specific agent likely wants
   the project's MCP only.
3. **Match sources to job.** Don't bundle Notion if the agent doesn't read or write
   knowledge. Don't bundle a search source if the agent never searches.
4. **Apply the rules below.** Converge on a final bundle.
5. **Present with reasoning** — for each chosen source, one line on why. For tempting-
   but-rejected sources, one line on why not. The "why not" matters.

## Rules

### Cap: max 3 sources per agent

Each source means a spawned process, more tools in the prompt, more places auth can fail.
Three is enough for most specialists. If you find yourself adding a fourth, ask whether
this is really one role.

### One concrete job, one source set

A research agent gets research sources. A writer gets context sources (or none). A code
agent gets the project MCP. Don't mix tool sets across roles.

### Prefer specific over general

A project's MCP server beats a generic web-fetch source for project work. A scoped API
beats a kitchen-sink one when you only need 10% of the surface.

### Don't bundle dormant globals

If a relevant source is at \\\`tier: 'global-dormant'\\\`, suggest the user activate it first.
Don't include the slug in the bundle until they confirm. The slug won't resolve in the
agent's prompt until it's activated.

### Don't bundle redundant sources

Two web-search sources, two issue trackers, two doc systems — pick one. If the user really
needs both, that's two agents, not one.

### Watch for auth status

A source with \\\`auth: 'none'\\\` or \\\`isAuthenticated: true\\\` is usable. A source needing
auth that isn't authenticated will be in the bundle list but won't actually work. Surface
this — don't silently bundle a non-functional source.

## Illustrative patterns

- **A research agent in a workspace with web-search activated** → just web-search. Maybe
  Notion if the user said they research from notes. That's it.
- **A code-review agent on a project with the project MCP activated** → project MCP. Maybe
  GitHub if reviews require pulling PR context. Cap at 2.
- **A writing agent** → usually 0 sources. Writers don't need tool calls; they need a voice
  prompt and a workspace context doc.
- **A meta/builder agent** → 0 sources. The agents it creates get their own bundles; the
  meta-agent itself doesn't need any.

## Output format

\\\`\\\`\\\`
**Proposed sources (N of max 3):**
- source-slug-1 — <one line on why>
- source-slug-2 — <one line>

**Considered but excluded:**
- source-slug-3 — <one line on why it doesn't fit>

**Suggest activating (currently global-dormant):**
- source-slug-4 — <if relevant; user activates then re-bundle>
\\\`\\\`\\\`

## When you don't know

If the catalog has sources you've never reasoned about and their descriptions don't make
their fit obvious, look up their guide.md content via the existing source-info workflows
before recommending. A wrong source bundle is worse than asking.
`;

export const STARTER_SKILLS: StarterSkill[] = [
  { slug: 'agent-creator', content: AGENT_CREATOR_SKILL },
  { slug: 'automation-creator', content: AUTOMATION_CREATOR_SKILL },
  { slug: 'workflow-creator', content: WORKFLOW_CREATOR_SKILL },
  { slug: 'source-recipe', content: SOURCE_RECIPE_SKILL },
];
