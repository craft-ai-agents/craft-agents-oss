# Implementation plan — Creator Skills

A fresh agent should be able to ship both creator skills from this doc + [`01-agent-creator.md`](./01-agent-creator.md) + [`02-automation-creator.md`](./02-automation-creator.md) without re-deciding the architecture.

`bun` is at `~/.bun/bin/bun` (not on PATH).

## Sequencing

Build `agent-creator` first, ship it, then `automation-creator`. Two reasons:

1. The agent-creator's tool surface is simpler (one RPC, one optional activation step). Get the skill+tool pattern right on the easier case before touching automations.
2. The agent-creator unlocks a recovery path the automation-creator needs: when a user describes an automation that targets an agent they haven't built yet, the conversation can route through agent-creator first. Building automation-creator first leaves it with a dead end.

## Prereqs to verify before starting

- `upsertAgentDefinition` RPC works end-to-end (it does — it's used by `AgentEditDialog.tsx`).
- The automation creation handler supports the trigger types listed in [`02-automation-creator.md`](./02-automation-creator.md). **Confirm by reading `packages/session-tools-core/src/handlers/create-automation.ts` and `packages/shared/src/automations/` before quoting any field names in the skill body.**
- Skill bundling into agents already works (`AGENT.md` `skills:` frontmatter list) — yes, this exists.
- Session-tools registry has a clean place to add new tools — find an existing tool in `@craft-agent/session-tools-core/src/handlers/` and copy its registration.

If any of the above is shaky, fix that before adding more on top.

## Phase 1 — `agent-creator` skill (~3–4 days)

### Files to add

```
packages/session-tools-core/src/handlers/
  create-agent.ts              # the structured tool implementation
  create-agent.test.ts         # unit + integration tests

packages/shared/src/skills/                  # OR wherever built-in skills live
  agent-creator/
    SKILL.md                   # the conversational interview

packages/shared/src/agent-definitions/
  starter-templates.ts         # bundle 'agent-creator' into Concierge + Orchestrator's `skills:` array
```

### Build order

1. **Tool first.** Implement `create-agent.ts`. Mirror an existing session-tool's shape. Wire validation: slug regex, built-in conflict check, existing-slug detection with `-v2` suggestion. The tool should call `upsertAgentDefinition` + the activation manifest update.
2. **Tool tests.** Unit-test every validation path. Integration-test the happy path: tool call → AGENT.md written → activation manifest updated → `agentDefinitions.CHANGED` event observable.
3. **Skill body.** Write `SKILL.md` per the spec. Read it aloud to yourself — the language is the agent's actual training, so it has to be tight and unambiguous. Avoid weasel words.
4. **Bundle into Concierge + Orchestrator.** Edit `starter-templates.ts` so both built-ins list `agent-creator` in their `skills:` array. Verify they re-bundle on next startup (the `ensureRequiredAgents` path doesn't overwrite existing AGENT.md, so users with existing builds get this on a manual edit OR via a one-time migration — pick whichever the codebase already does for similar additions).
5. **Seed the skill globally.** Mirror the `seedGlobalLibraryIfEmpty` / `ensureRequiredSkills` pattern (the agent equivalent already exists; build the skill version if it doesn't).
6. **Manual E2E.** Open the app, message Concierge with "I want a new agent that does X." Walk through the dialogue. Verify save, activation, sidebar appearance.

### Success criteria

- 95%+ of one-shot agent-creation conversations end with the user saying "yes" to a draft and getting a working agent.
- The tool's failure modes (slug clash, built-in collision) all have clean dialogue recoveries (Concierge proposes a fix, user accepts, save succeeds).
- Typecheck clean across all touched packages.
- Tests for the tool pass.

### What to skip (defer to Phase 1.5)

- Forking from an existing agent ("make one like @researcher but more aggressive") — possible later via a `seedFrom: '<existing-slug>'` tool option.
- Pre-filling skills/sources bundles automatically — Phase 1 just suggests in chat.
- Multi-agent creation in one conversation — too much state to manage cleanly. One agent per conversation; user can chain.

---

## Phase 2 — `automation-creator` skill (~4–5 days)

Strictly more involved than agent-creator because of the trigger taxonomy + matcher validation.

### Files to add

```
packages/session-tools-core/src/handlers/
  create-automation.ts
  create-automation.test.ts

packages/shared/src/skills/
  automation-creator/
    SKILL.md
```

### Build order

1. **Audit the existing automations module.** Read `packages/shared/src/automations/` end to end. Inventory:
   - All trigger types and their matcher schemas.
   - All action types (today: prompt and webhook).
   - The exact shape of the `create_automation` `eventName` + `matcher` payload.
   - Where matchers are registered with the runtime (trigger HTTP server, scheduler, etc.) and how they propagate.
   - Existing tests — copy their patterns.

   Commit a short audit note as a comment at the top of `create-automation.ts` so the next agent doesn't have to re-do this.

2. **Tool implementation.** Cron validation via `croner`. Schedule trigger should compute and return `nextFireAt`. Pass the trigger config through the existing matcher adapter validators rather than duplicating them.
3. **Tool tests.** One test per failure mode. Plus a happy-path SchedulerTick automation that actually fires within the test (use a 1-second-from-now cron and confirm the action gets queued).
4. **Skill body.** Per the spec. The "vague schedules" and "missing prerequisites" handling are critical — those are the dialogues that differentiate this from a form.
5. **Bundle into Concierge + Orchestrator.** Same pattern as Phase 1.
6. **Manual E2E.** Try three flows:
   - SchedulerTick + prompt action (the HN digest example).
   - WebhookReceive + prompt action (paste a curl invocation, verify the session starts).
   - User asks for an automation targeting a non-existent agent → Concierge offers to create the agent first via `agent-creator` → automation creation resumes after.

### Success criteria

- Each of the three E2E flows works end-to-end.
- The "agent doesn't exist → route through agent-creator" handoff feels conversational, not mechanical.
- Typecheck + tests clean.

### What to skip (defer to later)

- Webhook URL discovery / deep-linking to the automation's URL with copy-to-clipboard — UX polish.
- Action types beyond prompt/webhook — add workflow execution only after the automation tool and workflow runner expose a supported `RunWorkflow` action.
- Visual cron builder. The dialogue handles it.

---

## Cross-phase concerns

### When Concierge's prompt changes

When you bundle these skills into Concierge, also extend Concierge's system prompt with one paragraph (per [`README.md`](./README.md#concierges-prompt)). Don't bury this — without the prompt change, Concierge has the skills available but doesn't know to use them.

### Migration for existing installs

Users who already have a Concierge AGENT.md from before these skills shipped won't get the skill bundled automatically (the seeder doesn't overwrite). Two options:

- **Option A — opt-in:** add a UI prompt: "New skill available: `agent-creator`. Add to Concierge?" — one click adds to the agent's `skills:` list.
- **Option B — silent migration:** detect built-in agents whose skills array doesn't contain the new built-in skill and append it on next load. Opinionated; matches "load-bearing built-ins are managed".

Pick **Option B** for built-in agents (Concierge, Orchestrator) and respect user customizations to other agents.

### Telemetry to watch

Once shipped, watch:
- Completion rate (started a creator dialogue → saved successfully).
- Cancellation rate per turn (where do users bail?).
- Most common failure mode hit by the tool.

If the most common bail-out is "system prompt too long to write," that's a signal to add a "use this template" picker in Phase 1.5.

## Hard rules during implementation

- Do NOT freehand file writes for agent/automation creation. Always go through the structured tool → existing RPC.
- Do NOT add new RPC channels unless the runtime lacks the needed capability. Creator tools should wrap existing save paths instead of inventing parallel storage.
- Do NOT extend AGENT.md or automation matcher schemas as a side effect. If the interview wants to capture something the existing schemas can't hold, that's a separate spec.
- Do NOT add comments that just restate code. Only "why" comments.
- One creator skill per PR/commit chunk. Don't ship them as a bundle.

## Done definition

- Both creator skills shipped, bundled into Concierge + Orchestrator by default.
- A user with a fresh install can: open Concierge → say "I want an agent that triages my GitHub issues" → save it → say "fire it whenever a new issue is opened in repo X" → save the automation → see both in the sidebar → see the automation fire on the next matching event.

That's the demo. When that flow works without breakage, this feature is done.
