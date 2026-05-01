# `workflow-creator` skill

Lets a conversational agent draft a new reusable `WORKFLOW.md` through a short dialogue.

## What the user experience looks like

```
User: I want a workflow that takes a bug report, has @triager classify it,
      then @coder propose a fix and @critic review the plan.

Concierge: I can draft a manual workflow for that. What fields do you want to
            enter when you click Run: just the bug report, or repo context too?

User: Bug report and affected package.

Concierge: Here's the WORKFLOW.md draft:
            ...
            Use this as the workflow source?

User: Yes.

Concierge: Use slug `bug-fix-plan`. Create a workflow from Workflows, then
            paste this source into the editor.
```

## Current limitation

There is no `create_workflow` session tool today. Unlike `agent-creator` and
`automation-creator`, this skill does not claim it can save directly. It drafts
valid `WORKFLOW.md` source that the user can paste into the workflow editor.
It can use `list_agents` to verify agent slugs and `list_workflows` /
`get_workflow` to avoid duplicating an existing workflow.

## Skill frontmatter

```yaml
---
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
```

## Supported `WORKFLOW.md` surface

Match the parser and runner in `packages/shared/src/workflows/` and
`packages/server-core/src/workflows/runner.ts`.

- Top-level fields: `name`, `description`, optional `avatar`, `trigger`, `steps`.
- Trigger: only `type: manual`.
- Trigger inputs: `name`, `type` (`string`, `number`, `boolean`), optional
  `required`, `default`, `description`.
- Step fields: `id`, `agent`, `input`, optional `description`, `outputSchema`,
  `timeout`, `retries`, `onFailure`.
- `outputSchema` must be a JSON Schema object with at least a top-level `type`.
- `timeout` is positive seconds.
- `retries` is a non-negative integer.
- `onFailure` parses as `stop`, `continue`, or `ask`, but the current runner
  still stops the workflow after exhausted retries. Prefer omitting it or using
  `stop` until non-stop policies are implemented.

Unsupported today: schedule/webhook/automation workflow triggers, `when`,
`humanCheckpoint`, `parallelGroup`, loops, branches, and sub-workflows.

## Interview script

Ask only the missing pieces:

1. **Outcome** — what final artifact should the workflow produce?
2. **Run inputs** — what fields should the user fill in on the Run page?
3. **Steps** — which agents run, in what order, and what each receives?
4. **Reliability** — does any step need structured JSON output, timeout, or retry?

If the user already supplied enough detail, draft immediately.

## Validity checklist

- Use a kebab-case workflow slug and kebab-case step IDs.
- Use trigger input names like `topic`, `bug_report`, or `include_tests`; no
  hyphens and no leading digits.
- Every template reference must point to a declared trigger input, an earlier
  step, or `run.id` / `run.startedAt`.
- Use `{{trigger.<name>}}` for run inputs.
- Use `{{steps.<id>.output}}` for an earlier step's whole output.
- Use `{{steps.<id>.output.<field>}}` only when that earlier step has an
  `outputSchema`.
- Do not use expressions, filters, conditionals, loops, or future-step references.

## Draft and handoff

Always show a complete `WORKFLOW.md` source draft and ask for explicit
confirmation. After confirmation, provide:

- the suggested slug;
- the confirmed source;
- the exact handoff: create a workflow from Workflows and paste the source into
  the editor.

If a structured workflow save tool is added later, keep the same draft-first
confirmation flow before invoking it.
