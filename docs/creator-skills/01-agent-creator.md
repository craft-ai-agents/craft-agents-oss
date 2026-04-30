# `agent-creator` skill

Lets a conversational agent build a new agent for the user via dialogue.

## What the user experience looks like

```
User:    I'd like an agent that helps me prep for sales calls.

Concierge:  A few quick questions:
            1. What does it produce — a brief? a checklist? talking points?
            2. What input does it need — a company name? a CRM record?
            3. Should it lean conservative or have strong opinions?

User:    Talking points + objection handling. Just give it the company name
         and a one-line context. Strong opinions are good.

Concierge:  Got it. Here's a draft:

            **Name:** Sales Call Prep
            **Slug:** sales-call-prep
            **Avatar:** 📞
            **Inputs:** A company name and a one-line context
            **Outputs:** Talking points + likely objections + counters
            **Permission mode:** ask
            **Thinking:** medium
            **System prompt:** [shown in chat — ~200 words]

            Want me to save this?

User:    Yes.

Concierge:  ✅ Created `@sales-call-prep`. It's activated in this workspace —
            you can run it from the sidebar or @-mention it anywhere.
            Open it: /agents/sales-call-prep
```

The whole flow is conversational. The skill body trains the agent on what to ask and when. The structured `create_agent` tool does the actual save.

## File location

```
~/.craft-agent/skills/agent-creator/SKILL.md
```

(Or wherever the global skill library lives in this codebase — mirror the path used by other built-in skills. Today skills are per-workspace; there's a known migration to a global library happening alongside agents. This skill should live in whichever tier is global.)

## Skill frontmatter

```yaml
---
name: Agent Creator
description: Builds a new agent through a short conversational interview, then writes the AGENT.md.
tools:
  - create_agent       # session-tool defined alongside the skill
inputs: A wish for a new agent — anything from one sentence to a full spec.
outputs: A saved agent activated in the current workspace, plus a chat confirmation with a link.
tags: [creator, meta, agents]
---
```

## Skill body — interview script

The body is what the calling agent reads. Approximate text below; tune to taste at implementation time.

```markdown
# Agent Creator

Use this skill when the user wants to **create a new agent**.

## What you're producing

A complete AGENT.md saved at `~/.agents/agents/<slug>/`. Mandatory fields:
`name`, `description`, `systemPrompt`. Strongly preferred fields:
`avatar`, `inputs`, `outputs`, `tags`, `permissionMode`, `thinkingLevel`.
Optional: `skills`, `sources`, `model`, `llmConnection`, `greeting`.

## Minimum interview

Don't ask everything at once. Ask the smallest set you need to draft something:

1. **Purpose** — "What's its job?" (one sentence)
2. **I/O** — "What does it expect as input? What should it produce?"
3. **Voice** — "Cautious, neutral, or opinionated?"

That's enough to draft. Ask follow-ups only when ambiguous.

## Inferring sensibly

Most fields you can infer:

- **Slug** — kebab-case the name. If the slug already exists, suggest a numbered variant (`-v2`).
- **Avatar** — pick a single emoji that matches the job. Don't ask.
- **Permission mode** — default to `ask`. Use `safe` only for read-only/research roles. Never default to `allow-all`; only set it if the user explicitly opts in and understands the risk.
- **Thinking level** — `medium` for most agents; `high` for research/critique/planning; `low` only when latency matters.
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
      activateInWorkspace: true   // default true; ask if the user said
                                  // "global only, don't activate yet"
    })

After the tool returns success, post a one-line confirmation with a
clickable route link: `/agents/<slug>`.

## Refusals / sanity checks

Refuse to create an agent that:

- Has a slug clashing with a built-in (`concierge`, `orchestrator`).
- Has an empty or single-word system prompt — push for at least the
  identity sentence.
- Asks for `permissionMode: 'allow-all'` without the user demonstrating
  awareness of what that means.

If the user just wants you to do the job yourself (one-shot), do the job
instead of creating an agent. Creating an agent is for *reusable*
personas the user will run repeatedly.
```

## The `create_agent` session-tool

Lives in `@craft-agent/session-tools-core`. Registers like other session-tools.

### Input schema

```ts
interface CreateAgentToolInput {
  slug: string;                     // 1-64 chars, kebab-case
  metadata: {
    name: string;
    description: string;
    avatar?: string;
    permissionMode?: 'safe' | 'ask' | 'allow-all';
    thinkingLevel?: ThinkingLevel;
    skills?: string[];
    sources?: string[];
    inputs?: string;
    outputs?: string;
    tags?: string[];
    greeting?: string;
    model?: string;
    llmConnection?: string;
  };
  systemPrompt: string;             // required, non-empty
  activateInWorkspace?: boolean;    // default true
  overwrite?: boolean;              // default false; if false, conflicts fail
}
```

### Behavior

1. Validate slug shape (`AGENT_SLUG_REGEX`).
2. Check for conflict with built-ins (`CONCIERGE_SLUG`, `ORCHESTRATOR_SLUG`) → reject.
3. Check if slug already exists in the global library:
   - If yes and `overwrite` is false → return `{ ok: false, error: 'slug-exists', suggestedSlug: '<slug>-v2' }`.
   - If yes and `overwrite` is true → proceed.
4. Call existing `upsertAgentDefinition` RPC with the same payload.
5. If `activateInWorkspace !== false`, call `setAgentDefinitionActive(currentWorkspaceId, slug, true)`.
6. Return `{ ok: true, slug, route: '/agents/<slug>' }`.

### Why a tool and not just `Write`

Already covered in [`README.md`](./README.md#why-we-are-not-giving-the-agent-generic-file-write-tools-for-this) — single source of validation truth, clean audit trail in the transcript, automatic event emission for renderer subscribers.

## Edge cases worth handling

- **User describes an agent that's basically a duplicate of an existing one.** The interview should mention this: "Looks similar to your `@researcher`. Want this as a fork or a fresh one?"
- **User asks for an agent that needs a tool/source they don't have.** Don't fail silently. Mention it: "This needs a Notion tool, which isn't activated. Want me to skip the bundle now, or wait while you set it up?"
- **User's voice description is too vague.** Ask one clarifying question, no more. If still vague, draft a neutral persona and let them iterate.
- **User wants an agent's system prompt to be a paste of their own writing voice.** Encourage that — paste-as-prompt is a great pattern for writer agents. Just wrap it in basic identity + I/O scaffolding.

## Implementation pointers

- The closest existing precedent is the `AgentEditDialog.tsx` form — it knows every field and how to validate. Read it before drafting the interview, so you don't ask for fields the form already infers.
- `upsertAgentDefinition` already exists as an RPC. Don't reinvent it; the tool is a thin wrapper that adds the `activateInWorkspace` step and surfaces a clean route.
- For the "suggest a slug variant" path, just append `-v2`, `-v3`, etc. until one is free. No need for fancy disambiguation.

## Test plan

- Unit test the tool's validation paths (invalid slug, built-in conflict, existing slug).
- Integration test the happy path: tool call → file written → activation manifest updated → emits the expected `agentDefinitions.CHANGED` event.
- E2E manual: have Concierge run the skill, save an agent, verify it shows up in the sidebar and is runnable.
