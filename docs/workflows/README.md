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

Core workflow storage, parsing, starter seeding, manual runs, sequential runner
execution, structured step output, timeouts, and retries are implemented. The
implementation plan remains useful for follow-up work, but the current runtime
surface is defined by [`01-spec.md`](./01-spec.md) and [`02-runtime.md`](./02-runtime.md).

## Hard non-goals (current runtime)

- Visual node-graph editor (later — YAML editing covers MVP).
- Cross-machine durable execution (no need; RunnerOS is local-first).
- Branching / conditionals (`when:` is not supported yet).
- Sub-workflows / nesting (compose by reference later).
- Workflow versioning / migrations (file is the source of truth — git it).

## North star demo

> Kick off a 4-step manual "weekly content" workflow. Walk away. Come back to
> a Run page where completed steps are green and the active step links to its
> underlying session transcript.

Scheduled triggers, human checkpoints, and parallel execution are later work.
