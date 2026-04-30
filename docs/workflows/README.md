# Workflows — Spec & Plan

A predefined, savable, shareable pipeline of agents that work in sequence (and eventually in parallel) to accomplish a multi-step job.

## Why this exists

RunnerOS has two complementary execution modes:

1. **Fluid orchestration (Rooms)** — multiple agents in a shared session, dispatched dynamically by the Orchestrator or by user @-mentions. Open-ended; great when the path isn't known.
2. **Predefined workflows** (this doc) — a fixed pipeline you save once and run repeatedly. Great when the path *is* known: weekly report, email triage, content production, bug-investigation pipeline.

Workflows give users repeatability + reliability + shareability. Rooms give users flexibility. Both share the same agent runtime — a workflow step is just a session with a pre-filled prompt and a "resume parent run when done" callback.

## Why we are NOT using a framework

Considered: Temporal, DBOS, LangChain/LangGraph, Inngest, ChatDev.

- **Temporal / DBOS** — durable-execution infra for distributed systems. Overkill for a personal agent OS, fights the AGENT.md aesthetic, hides state behind a DB.
- **LangChain / LangGraph** — imposes its own agent abstraction; we already have one (AGENT.md + capability tags). Adopting LangGraph means rebuilding everything we've shipped.
- **Composio** — tool/integration layer, not orchestration.
- **ChatDev** — research project, not infrastructure.

A WorkflowRunner is ~300–500 LOC of plain TypeScript on top of our existing session runtime. We can graduate to Inngest or Trigger.dev later if we ever need durability across restarts or multi-day runs without changing the file format.

## How these docs are organized

| Doc | What you get |
|-----|--------------|
| [`01-spec.md`](./01-spec.md) | The `WORKFLOW.md` file format — frontmatter schema, step shape, templating syntax, validation rules. |
| [`02-runtime.md`](./02-runtime.md) | Runner architecture: how steps execute, output extraction, checkpointing, resume, storage layout. |
| [`03-ux.md`](./03-ux.md) | UI spec: list page, editor, **Run page** (the killer view — vertical pipeline of cards with side-pane drill-down). |
| [`04-implementation-plan.md`](./04-implementation-plan.md) | Phased build plan. Phase 1 is shippable in ~1 week. Each phase has scope + success criteria. |
| [`05-examples.md`](./05-examples.md) | Concrete sample `WORKFLOW.md` files showing realistic uses. |

## Status

**Spec only.** Nothing in this directory is implemented yet. A fresh agent picking up Phase 1 should start at `04-implementation-plan.md`.

## Hard non-goals (Phase 1)

- Visual node-graph editor (later — YAML editing covers MVP).
- Cross-machine durable execution (no need; RunnerOS is local-first).
- Branching / conditionals beyond a single `when:` on a step (covered in Phase 3).
- Sub-workflows / nesting (compose by reference later).
- Workflow versioning / migrations (file is the source of truth — git it).

## North star demo

> Kick off a 5-step "weekly content" workflow at 9am. Walk away. Come back to a Run page where steps 1–4 are green and step 5 is paused at a human-checkpoint. Click **Approve** → step 5 publishes. Click any step card → side pane opens its underlying session, full transcript, fork from here.

If the build is on track, this demo works at end of Phase 3.
