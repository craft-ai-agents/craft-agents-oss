---
status: draft
owner: agent
last_verified: 2026-06-28
source_of_truth: false
---

# Mission Intake Operator Drawer Spec

## Decision

Mission intake should be a **right-side operator drawer**, not a popup chat and not a full-page form.

The command center remains the main surface. The agent appears beside the work, extracts useful context, asks better follow-ups, and lets the artist approve what becomes durable mission context.

## Product Principle

```text
Work stays center.
Agent appears beside the work.
Context becomes the operating system.
```

Chat is an input method. The durable output is the mission brief.

## First Build

When an artist creates a new workspace/project space, the home page starts in an empty but usable state:

```text
Untitled Mission
Start with a goal, files, or an agent.

[Create Mission] [Drop Files] [Ask Agent]
```

No fake stats. No empty dashboard noise.

### Create Mission Click

`Create Mission` opens a docked right drawer:

```text
Command Center Home                 Mission Brief Drawer

Untitled Mission                    What are we building toward?
State of Play: Not enough context   [freeform answer box]
Approvals: None yet
Today: No mission timeline

                                     Extracted so far
                                     Type: -
                                     Title: -
                                     Date: -
                                     Goal: -

                                     [Accept] [Go deeper] [Skip for now]
```

The drawer can be dismissed without losing progress.

## Core Objects

There are two context layers.

### Creator Profile

Global to the app/workspace owner.

Examples:

- artist name
- genre/style
- brand voice
- similar artists
- audience demographics
- visual identity
- platform links
- hard preferences

This belongs in global creator context / user profile memory.

### Mission Brief

Scoped to one creative mission.

For artist-first V1, a mission usually maps to a song, EP, album, rollout, video, merch drop, or campaign.

Required minimum:

- `missionType`
- `title`
- `goal`
- `timeline`

Recommended:

- `releaseDate`
- `phase`
- `mood`
- `visualWorld`
- `references`
- `targetListener`
- `assets`
- `collaborators`
- `budget`
- `channels`
- `openQuestions`

The command center should work at any completeness level.

## Completeness States

### Empty

User has not created a mission brief.

Home shows:

- `Untitled Mission`
- `Mission context: empty`
- primary action: `Create Mission`
- secondary actions: `Drop Files`, `Ask Agent`

Agents can still run, but should disclose missing context.

Example:

```text
I only know your creator profile so far. I can help, but release date and goal would make this sharper.
```

### Light

User gave the basics.

Home shows:

- real mission title
- mission type
- broad timeline
- next suggested action
- context completeness

Widgets stay conservative. Do not invent Spotify stats, approvals, or timeline events.

### Full

User confirmed enough context and/or connected data sources.

Home can show:

- State of Play
- approvals
- today timeline
- active agents
- intelligence
- connected source data

## Agent / Skill / Workflow Split

### Mission Intake Agent

Owns conversation quality.

Responsibilities:

- ask one clean question at a time
- detect vague answers
- ask creative follow-ups
- translate rambling into usable language
- identify contradictions
- propose enhanced wording
- never silently overwrite user truth

### Mission Brief Skill

Owns structure.

Responsibilities:

- define the mission schema
- extract fields from conversation
- score completeness
- generate follow-up priorities
- produce a patch to the mission brief
- validate before save

### Mission Intake Workflow

Owns control flow.

```text
start
→ ask focused question
→ extract structured fields
→ score completeness
→ show proposed updates
→ user accepts / edits / skips
→ save mission brief
→ update command center
```

This should be a workflow-like state machine with persisted checkpoints, not a brittle one-shot prompt.

## Reliability Rules

1. Never treat raw chat as mission truth.
2. Extract to structured JSON.
3. Validate against a schema.
4. Show proposed changes before saving.
5. Save only accepted fields.
6. Keep skipped fields explicitly unknown.
7. Persist workflow progress after every step.
8. Let the user exit and resume later.
9. Separate global creator context from mission context.
10. Do not unlock fake widgets before real data exists.

## Suggested Data Shape

```ts
type MissionBrief = {
  id: string
  workspaceId: string
  status: 'empty' | 'light' | 'full'
  completeness: number
  missionType?: 'single' | 'ep' | 'album' | 'video' | 'tour' | 'merch' | 'campaign' | 'other'
  title?: string
  goal?: string
  phase?: string
  timeline?: string
  releaseDate?: string
  mood?: string
  visualWorld?: string
  references?: Array<{ type: 'artist' | 'song' | 'visual' | 'brand' | 'other'; value: string }>
  targetListener?: string
  assets?: Array<{ kind: string; name: string; path?: string; status?: string }>
  collaborators?: Array<{ name: string; role?: string }>
  budget?: { amount?: number; currency?: string; notes?: string }
  channels?: string[]
  openQuestions?: string[]
  confirmedAt?: string
  updatedAt: string
}
```

## Storage Recommendation

V1 should save mission brief as a workspace/project context document, not a new database subsystem.

Recommended path:

```text
<workspace-root>/context/mission-brief/CONTEXT.md
```

Use frontmatter for structured fields and markdown body for the human-readable brief.

Why:

- matches RunnerOS file-first patterns
- easy for agents to read
- easy to diff
- avoids premature schema sprawl
- can later graduate to a richer mission registry

## UI Architecture

Use one reusable **Operator Drawer** shell.

Drawer modes:

- `mission-brief`
- `approval-review`
- `agent-run`
- `context-inspector`
- `scoped-chat`

For V1, only implement `mission-brief`.

The drawer should:

- dock right on desktop
- become full-screen or bottom sheet on narrow screens
- keep the command center visible when possible
- preserve draft state on close
- restore focus to the button that opened it

The repo already has `vaul` drawer primitives and overlay detection, so reuse those instead of creating a custom modal system.

## First Intake Questions

Do not start with a huge form.

Ask:

1. What are we building toward?
2. What is the release/project called?
3. Is there a date or rough timeline?
4. What should this make people feel?
5. What references should I understand?

After that, the agent decides the next best follow-up.

## Agent Enhancement Pattern

The drawer should show:

```text
Your answer
"dark pop single about leaving someone but still missing them"

Agent structure
Type: Single
Emotional lane: dark pop / post-breakup tension
Core feeling: freedom mixed with withdrawal
Visual world: night driving, neon, empty rooms
Missing: release date, references, target listener

[Accept] [Edit] [Go deeper]
```

The user confirms. Then save.

## Source-Backed Reliability Notes

- OpenAI Structured Outputs with `strict: true` are the right direction for schema-following extraction, but schema support has limits. Keep schemas simple and validate locally too.
- WAI-ARIA dialog guidance matters for drawers that behave like modal surfaces: focus should move predictably, Escape should close, and focus should restore to the trigger.
- WAI-ARIA disclosure guidance applies to collapsed agent/activity sections: use real buttons with expanded/collapsed state, not fake clickable divs.

References:

- OpenAI Structured Outputs: `https://developers.openai.com/api/docs/guides/structured-outputs`
- WAI-ARIA Dialog Modal Pattern: `https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/`
- WAI-ARIA Disclosure Pattern: `https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/`

## RunnerOS Implementation Fit

Use existing primitives:

- UI: `apps/electron/src/renderer/components/ui/drawer.tsx`
- State: Jotai atoms
- Context: existing Workspace Context patterns
- Workflow: existing workflow runner mental model
- Validation: Zod / existing structured output validation
- Command center surface: `ArtistCommandCenterHome`

Do not build:

- separate onboarding app
- popup chat modal
- fake analytics layer
- mission database before file/context storage proves insufficient

## Build Order

### Phase 1: Local Prototype

- Add `OperatorDrawer` shell.
- Add `mission-brief` drawer mode.
- Wire `Create Mission` button from command center.
- Store draft locally in component/Jotai state.
- Show extracted-field mock behavior.

### Phase 2: Real Mission Context

- Add `MissionBrief` type and schema.
- Save/load `mission-brief.md` through workspace context storage.
- Render empty/light/full home states from saved brief.

### Phase 3: Real Agent Loop

- Add Mission Intake Agent.
- Add Mission Brief Skill.
- Add Mission Intake Workflow.
- Use structured extraction with schema validation.
- Add accept/edit/skip save flow.

### Phase 4: Pack Integration

- Music Artist Pack declares the mission schema, default intake agent, home widgets, workflows, and source expectations.
- Future creator packs can swap schema fields and drawer prompts without replacing the core drawer component.

## V1 Non-Goals

- voice-avatar intake
- domain pack marketplace
- live Spotify stats
- automated publishing
- background campaign automation
- perfect multi-domain abstraction

Those come after the artist mission intake loop works.

## Acceptance Criteria

- User can create an empty mission workspace and still use agents.
- `Create Mission` opens a right-side drawer, not a popup.
- User can answer casually and see structured extracted fields.
- User can accept/edit/skip before saving.
- Saved mission context changes the command center hero.
- Missing context is explicit, not hidden.
- Agent runs receive both creator profile and mission brief context.
- No fake dashboard widgets appear without source/context backing.
