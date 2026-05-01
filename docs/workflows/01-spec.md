# Workflow file format — `WORKFLOW.md`

A workflow is one file. Same YAML+markdown idiom as `AGENT.md`, `SKILL.md`, `CONTEXT.md`. The frontmatter declares the pipeline; the body is free-form notes (purpose, intended use, gotchas — like a top-of-file comment).

## Storage location

```
~/.workflows/<slug>/WORKFLOW.md
```

Global library, like agents — workflows are reusable across workspaces. A per-workspace activation manifest decides which subset is visible (mirror the agent activation pattern from `packages/shared/src/agent-definitions/storage.ts`).

Slug rules: same as agents — lowercase letters, digits, hyphens; 1–64 chars; no leading/trailing hyphen. Reuse `AGENT_SLUG_REGEX`.

## Frontmatter schema (current)

```yaml
---
name: Weekly Content Pipeline
description: Research a topic, draft a post, critique it, hand off for publish.
avatar: 📝               # optional — emoji shown in lists/picker
trigger:
  type: manual           # only manual is supported today
  inputs:                # optional — input form schema for manual runs
    - name: topic
      type: string
      required: true
      description: What to write about
    - name: word_count
      type: number
      default: 600
steps:
  - id: research          # required, unique within workflow, slug-shaped
    agent: researcher     # agent slug
    input: |
      Research {{trigger.topic}}. Cite primary sources.
    timeout: 300          # optional, seconds
    retries: 1            # optional, non-negative integer
  - id: draft
    agent: writer
    input: |
      Write a {{trigger.word_count}}-word post from this research:

      {{steps.research.output}}
  - id: critique
    agent: critic
    input: "{{steps.draft.output}}"
  - id: revise
    agent: writer
    input: |
      Revise the draft using this critique. Keep the same word count.

      Draft: {{steps.draft.output}}
      Critique: {{steps.critique.output}}
---
# Weekly Content Pipeline

Notes for humans go in the body — when to run this, what good output looks like, etc. The runner ignores the body entirely.
```

## Field reference

### Top level

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | Human-readable display name. |
| `description` | string | yes | One-sentence summary; shown in pickers. |
| `avatar` | string | no | Single emoji for UI. |
| `trigger` | object | no | Defaults to `{ type: 'manual' }`. |
| `steps` | array | yes | 1+ steps. See below. |

### Step object

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Unique slug within the workflow. Used in templating. |
| `agent` | string | yes | Agent slug. Slug shape is checked at parse time; existence is checked when the step runs. |
| `input` | string | yes | The user-message for that step's session. Supports `{{...}}` templating. |
| `description` | string | no | Human-readable note for the step. UI hint only. |
| `outputSchema` | JSON Schema | no | If set, the step's session is asked to emit JSON matching this schema. The schema must be an object with a top-level `type`. |
| `timeout` | number (seconds) | no | Step session is aborted and the attempt fails if it exceeds this positive duration. |
| `retries` | number | no | Non-negative integer. How many times to retry after a failed attempt. Default 0. |
| `onFailure` | `stop` \| `continue` \| `ask` | no | Parsed for compatibility, but the current runner stops the workflow after exhausted retries. Prefer omitting or using `stop` until non-stop policies are implemented. |

Unsupported step fields today: `when`, `humanCheckpoint`, and `parallelGroup`.

### Trigger types

| Type | Behavior |
|------|----------|
| `manual` | User clicks Run, fills in the optional `trigger.inputs` form. |

Unsupported trigger types today: `schedule`, `automation`, and `webhook`.

## Templating

Mustache-ish, intentionally tiny. **Do not pull in a templating library** — write a 50-line resolver.

| Token | Resolves to |
|-------|-------------|
| `{{trigger.<field>}}` | Value from the trigger inputs. |
| `{{steps.<id>.output}}` | The whole output of step `<id>` (string when no `outputSchema`, JSON otherwise). |
| `{{steps.<id>.output.<path>}}` | Dot-path into structured output (only valid when step had `outputSchema`). |
| `{{run.id}}` | Current run ID (UUID). |
| `{{run.startedAt}}` | ISO timestamp. |

Templating rules:
- Resolution happens **just before** a step executes, not at parse time. (You may want one step's output to influence whether the next runs.)
- A reference to a step that hasn't run yet → validation error at parse time.
- Unknown references resolve to an empty string at runtime and emit a warning, but the parser rejects references it can prove are invalid.
- No expressions, no filters, no conditionals, and no loops. If you reach for that complexity, reconsider whether this should be a workflow or a Room.

## Validation (parse time)

A `WORKFLOW.md` is invalid (and the runner refuses to start) if any of:
- `name`, `description`, or `steps` are missing or empty
- a step `id` is duplicated, missing, or non-slug-shaped
- a step `agent` is missing or not slug-shaped
- a templating reference points to a non-existent step or future step
- a templating reference points to an undeclared trigger input
- `outputSchema` is present but is not a JSON Schema object with a top-level `type`
- `timeout` is present but is not a positive number
- `retries` is present but is not a non-negative integer
- `onFailure` is present but is not `stop`, `continue`, or `ask`

Validation runs at write time (in the editor) and again at the start of every run. UI surfaces the error inline; the runner refuses to start with a clear message.

## What goes in the body?

Free-form markdown. Suggested sections:

- **When to run this** — manual cadence, triggering condition.
- **Inputs cheatsheet** — what the user should put in each input.
- **Known limitations** — flaky steps, expected failure modes.
- **Changelog** — small log of edits. Optional; git is the canonical history.

The runner does not read the body. It exists for humans browsing the file, and for the future "fork this workflow" gesture.

## Round-trip guarantee

Like AGENT.md and CONTEXT.md, the file is the source of truth. The editor reads → mutates → writes the same shape. No hidden DB row. `git diff` is meaningful.
