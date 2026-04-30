# Workflow runtime — architecture

How a `WORKFLOW.md` actually runs. Read [`01-spec.md`](./01-spec.md) first.

## TL;DR

- A `WorkflowRun` is the in-memory + on-disk record of one execution.
- A `WorkflowRunner` walks the steps. **Each step spawns a real Session** (the same `Session` type used by solo agents and Rooms). The runner waits for the session to complete, extracts its output, then advances.
- Run state is checkpointed to disk after every step transition. Restart resumes cleanly.
- The runner emits events on the existing event bus so the renderer's Run page can update live.

The runner is *not* magical. It's a state machine with a step loop, persisted between transitions.

## Where the code lives

| Concern | Package | File (proposed) |
|---------|---------|-----------------|
| Workflow file format (parser, serializer, types, slug rules, validation) | `@craft-agent/shared` | `src/workflows/{types,storage}.ts` |
| Runner state machine | `@craft-agent/server-core` | `src/workflows/runner.ts` |
| Run persistence (read/write/list) | `@craft-agent/server-core` | `src/workflows/runs.ts` |
| Templating resolver (tiny — ~50 LOC) | `@craft-agent/shared` | `src/workflows/template.ts` |
| RPC channels + handler | `@craft-agent/shared` + `@craft-agent/server-core` | `protocol/channels.ts`, `handlers/rpc/workflows.ts` |
| Renderer state (atoms, hooks) | `apps/electron` | `renderer/state/workflows.ts` |
| Run page UI | `apps/electron` | `renderer/pages/workflow-run/...` |

Mirror the existing patterns in `agent-definitions/` and `workspace-context/` — those are the closest analogs.

## Step execution — the load-bearing decision

**Each step is a real `Session`**, not a hidden subprocess or an anonymous LLM call. Why:

1. **Free fidelity.** Logs, replay, attachments, permission flow, source/skill bundling, the whole composed-system-prompt pipeline — all reused for free.
2. **Drill-down for free.** The Run page side-pane *is* the underlying session view. No second renderer.
3. **Rooms share infra.** When Rooms ship, they're "a session that multiple agents take turns participating in." A workflow step is "a session with one agent and a pre-filled prompt." Both fall out of the same primitive.
4. **Mid-run interjection.** User can type into a running step's session. The runner sees the additional turns and only advances when the session reports complete.

The runner's only special privilege is the **completion signal**: a step is done when the session emits its terminal assistant message *and* (if `outputSchema` is set) that message validates against the schema. Otherwise the runner waits.

## Output extraction

| Step config | Strategy |
|-------------|----------|
| No `outputSchema` (Phase 1) | Take the last assistant message's text content as `output`. Plain string. |
| `outputSchema` set (Phase 2) | Inject the schema into the agent's prompt as "your final reply MUST be a JSON object matching this schema." Validate every assistant message; the first valid one ends the step. The parsed object becomes `output`. |

The schema-injection strategy is identical to how `buildCallLlmRequest` already handles structured outputs in `packages/shared/src/agent/llm-tool.ts` — reuse that helper.

If the schema-validated reply never arrives within `timeout`, step fails with `error: 'invalid-structured-output'`. User sees the last (invalid) reply in the side-pane so they can debug.

## Run lifecycle

```
created → queued → running → (paused | succeeded | failed | cancelled)
                              ↑
                              └── humanCheckpoint
```

| State | Trigger | Notes |
|-------|---------|-------|
| `created` | User clicks Run, before validation. | UI shows the input form. |
| `queued` | Validated, waiting for a runner slot. | Phase 1: at most 1 concurrent run per workflow. Configurable later. |
| `running` | Runner picked it up. | Cards animate in. |
| `paused` | A step had `humanCheckpoint: true`. | UI shows Approve / Reject buttons. |
| `succeeded` | All steps completed without failure. | |
| `failed` | A step exhausted its retries or timed out. | Run is "completed-but-failed." |
| `cancelled` | User clicked Cancel. | Active step's session is hard-aborted (`UserStop`). |

Per-step states: `queued | running | succeeded | failed | skipped | awaiting-human`.

## Persistence layout

```
~/.craft-agent/workspaces/<wsId>/runs/
  <runId>/
    run.json              # the full run state (see schema below)
    steps/
      <stepId>.json       # per-step record: sessionId, output, durationMs, error?
```

`run.json` is rewritten atomically (write to `.tmp`, rename) after every state transition. The whole file is small — kilobytes, not megabytes — so there's no need for incremental updates.

### `run.json` schema (informal)

```ts
interface WorkflowRun {
  id: string                       // UUID
  workflowSlug: string
  workspaceId: string
  state: 'created' | 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled'
  trigger: {
    type: 'manual' | 'schedule' | 'automation' | 'webhook'
    inputs: Record<string, unknown>
    firedAt: string                // ISO
  }
  steps: Array<{
    id: string
    state: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'awaiting-human'
    sessionId?: string             // present once running
    startedAt?: string
    completedAt?: string
    output?: unknown               // string or JSON, depending on outputSchema
    error?: { code: string; message: string }
    attempts: number
  }>
  createdAt: string
  updatedAt: string
}
```

## Resume on restart

When the server starts, scan every workspace's `runs/` for runs in `running` or `paused` state.

- `paused` runs stay paused — no action.
- `running` runs are repaired:
  - The currently-active step's `sessionId` is checked. If the session is still running in the SessionManager, the runner reattaches.
  - If the session is gone (server crashed mid-step), mark the step as `failed` with `error: 'orphaned-session'` and either retry (if `retries > 0`) or mark the run failed.

This is best-effort, **not durable execution**. Users who need crash-proof multi-day workflows reach for Inngest in Phase 5+. We document this loudly so expectations are right.

## Cancellation

User clicks Cancel on the Run page → renderer sends `cancelRun(runId)` → runner sets state to `cancelled`, hard-aborts the active session via the existing `UserStop` lifecycle hook (see `packages/shared/CLAUDE.md` for the distinction between hard aborts and handoff interrupts), persists.

Already-completed steps are not undone. Output remains visible.

## Concurrency (Phase 3)

`parallelGroup` lets a contiguous slice of steps share a group name; they all run concurrently and the runner advances only when *all* have completed. Validation rule: every step in a group must declare the same `parallelGroup` value, and groups can't span non-adjacent steps.

Phase 1 is strictly sequential. Don't add `parallelGroup` plumbing until Phase 3.

## Events

The runner publishes the following events on the existing event bus (mirror `agent-definitions.CHANGED` and `workspaceContext.CHANGED` patterns):

- `workflow.run.created`
- `workflow.run.updated` — fires on any state change (run-level or step-level)
- `workflow.run.completed` — terminal (succeeded/failed/cancelled)

Renderer subscribes via the existing `onWorkflowRunUpdated` listener pattern.

## What stays out of scope

- Cross-workflow data passing — every run is its own world.
- A runtime DSL for transforming step outputs — if you need transform-then-pass, write a step whose agent is a "transformer" with a strict output schema.
- Automatic schema inference — users either declare `outputSchema` or accept string outputs.
- Multi-tenant scheduling fairness — not a problem at the personal-OS scale.
