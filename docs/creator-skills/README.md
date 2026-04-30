# Creator Skills — Spec

A pair of bundled skills that let a conversational agent (default: Concierge) **set up agents and automations through natural-language dialogue** instead of forcing the user through a modal form.

## Scope

| Skill | Status | What it does |
|-------|--------|--------------|
| [`agent-creator`](./01-agent-creator.md) | ✅ Build now | Interviews the user, drafts an AGENT.md, writes it. |
| [`automation-creator`](./02-automation-creator.md) | ✅ Build now | Interviews the user, drafts an automation matcher, writes it. |
| `workflow-creator` | ⏸ Deferred | Until workflows ship and we know what an interview needs to extract, building this is premature. |
| `skill-creator` | ⏸ Maybe later | Useful but lower-priority — skills are easier to write by hand than agents/automations. |

## Why "creator skills" and not "creator agents"

A skill is reusable across agents. Building this as a skill means:
- Concierge gets it bundled by default (its raison d'être is to know everything and route).
- Orchestrator gets it bundled too (a planner sometimes needs to spin up the executor it just planned).
- Any custom agent the user builds can opt in by listing the skill in its `skills:` frontmatter.

If we hardcoded "agent creation" into the Concierge slug, every other agent would need its own duplicate. Wrong shape.

## Shared design

Every creator skill follows the same pattern:

1. **Conversational interview.** The skill body teaches the calling agent how to ask: minimum questions to extract, when to defer, how to propose, when to confirm.
2. **Structured write tool.** The skill bundles a session-tool (defined in `@craft-agent/session-tools-core`) that takes a typed payload and calls the appropriate existing RPC (`upsertAgentDefinition`, `upsertAutomation`, etc.). The agent never writes the file directly.
3. **Always confirm before write.** The agent shows a draft, asks "save this?", waits for explicit yes. No silent writes.
4. **Auto-activate on save.** Newly created entities are activated in the current workspace by default — the user expects to see what they just made.
5. **Surface success in chat.** After the tool fires, the agent posts a brief "✅ Created `<slug>`. You can find it at <route>" with a clickable link.

## Why we are NOT giving the agent generic file-write tools for this

Two reasons:

1. **Validation lives in one place.** A structured tool calls the same RPC the UI calls — slug-shape checks, conflict detection, schema validation, "agent created" events all happen automatically. A freehand `Write(~/.agents/agents/<slug>/AGENT.md)` would silently bypass them.
2. **Auditable.** A structured tool call shows up cleanly in the session transcript: `create_agent({ slug: "researcher-v2", … })`. Users can see exactly what happened without diffing files.

The agent **also** gets a generic scoped Write tool for things like saving conversation transcripts to a PRD — see the Concierge file-write decision in this README's parent context. Creator skills don't replace that; they complement it.

## Concierge's prompt

The Concierge's system prompt should be extended (when these skills land) with one paragraph teaching it when to reach for which:

> When the user's intent is to **create** something — a new agent persona, a new automation that fires on some trigger, a new workspace context doc — reach for the matching creator skill. The skill will guide you through the conversation. Always show a draft and confirm before saving. After saving, give the user a clickable link to where the thing now lives.

## Built-in vs. user-editable

These skills ship as **built-in / load-bearing**, mirroring the Concierge and Orchestrator agent treatment:

- Seeded into the global skill library on first run.
- Re-ensured on every startup if the user hasn't explicitly deleted them.
- Tombstoned (`.deleted-skills.json`) if deleted, so they don't come back.
- Activated by default in every workspace.

Users can fork them like any skill if they want a custom interview style.

## Hard non-goals

- Multi-step "wizards" with branching UI. The conversation IS the wizard.
- Headless / API mode for these skills (use the existing RPCs directly if you want headless).
- Auto-detection ("looks like you want an automation, want me to make one?"). Concierge can suggest a creator skill, but the user has to consent.

## Status

**Spec only.** Read [`01-agent-creator.md`](./01-agent-creator.md) and [`02-automation-creator.md`](./02-automation-creator.md), then [`03-implementation-plan.md`](./03-implementation-plan.md) to start building.
