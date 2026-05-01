# Workflow runtime — architecture

How a `WORKFLOW.md` actually runs. Read [`01-spec.md`](./01-spec.md) first.

## TL;DR

- A `WorkflowRun` is the in-memory + on-disk record of one execution.
- A `WorkflowRunner` walks the steps. **Each step spawns a real Session** (the same `Session` type used by solo agents and Rooms). The runner waits for the session to complete, extracts its output, then advances.
- Run state is checkpointed to disk after every step transition. Restart resumes cleanly.
- The runner emits events on the existing event bus so the renderer's Run page can update live.

The runner is *not* magical. It's a state machine with a step loop, persisted between transitions.

## Where the code lives

| Concern | Package | File |
|---------|---------|-----------------|
| Workflow file format (parser, serializer, types, slug rules, validation) | `@craft-agent/shared` | `src/workflows/{types,storage}.ts` |
| Runner state machine | `@craft-agent/server-core` | `src/workflows/runner.ts` |
| Run persistence (read/write/list) | `@craft-agent/shared` | `src/workflows/run-storage.ts` |
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

The runner's special privilege is the **completion gate**: a step only succeeds
after the step session's LLM turn completes and the configured completion
contract passes. If `outputSchema` is set, the last assistant message must
parse as JSON and validate against the schema before the step succeeds.
If `completion.requireToolUse` is true, the step session must record at least
one successful tool result. Workflow step sessions are hidden from the main
session list by default; the Run page is the primary surface, with links into
the underlying hidden session for drill-down.

## Output extraction

| Step config | Strategy |
|-------------|----------|
| No `outputSchema` | Take the last assistant message's text content as `output`. Plain string. |
| `outputSchema` set | Append an instruction that the final reply must be JSON matching the schema. Parse and validate the last assistant message. The parsed object becomes `output`. |

The JSON parser accepts raw JSON or a single fenced JSON block. Schema validation currently covers `type`, `enum`, object `required` / `properties`, and array `items`.

If the step has `timeout`, the active session is aborted when the timeout expires and the attempt fails with `error.code: 'timeout'`. If structured output parsing fails, the attempt fails with `error.code: 'invalid-structured-output'`. If the completion contract fails, the attempt fails with `error.code: 'completion-output-too-short'` or `error.code: 'completion-tool-use-required'`. `retries` controls how many additional attempts are made.

## Run lifecycle

```
running → (succeeded | failed | cancelled)
```

| State | Trigger | Notes |
|-------|---------|-------|
| `running` | Runner accepted the run and persisted the initial snapshot. | At most 1 concurrent run per workflow per workspace. |
| `succeeded` | All steps completed without failure. | |
| `failed` | A step exhausted its retries or timed out. | Run is "completed-but-failed." |
| `cancelled` | User clicked Cancel. | Active step's session is hard-aborted (`UserStop`). |

Per-step states used by the current runner: `queued | running | succeeded | failed`.

The shared run types still declare `created`, `queued`, `paused`, `skipped`, and
`awaiting-human` for forward compatibility. The current runner does not emit
paused, skipped, or awaiting-human states.

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
    type: 'manual'
    inputs: Record<string, unknown>
    firedAt: string                // ISO
  }
  steps: Array<{
    id: string
    state: 'queued' | 'running' | 'succeeded' | 'failed'
    sessionId?: string             // present once running
    startedAt?: string
    completedAt?: string
    output?: unknown               // string or JSON, depending on outputSchema
    error?: { code: string; message: string }
    attempts: number
  }>
  workflowSnapshot: { metadata: WorkflowMetadata; body: string }
  createdAt: string
  updatedAt: string
}
```

## Resume on restart

When full resume support is implemented, the server should scan every workspace's
`runs/` for non-terminal runs.

- `running` runs are repaired:
  - The currently-active step's `sessionId` is checked. If the session is still running in the SessionManager, the runner reattaches.
  - If the session is gone (server crashed mid-step), mark the step as `failed` with `error: 'orphaned-session'` and either retry (if `retries > 0`) or mark the run failed.

This is best-effort, **not durable execution**. Users who need crash-proof
multi-day workflows should not treat the local runner as a durable job system.

## Cancellation

User clicks Cancel on the Run page → renderer sends `cancelRun(runId)` → runner sets state to `cancelled`, hard-aborts the active session via the existing `UserStop` lifecycle hook (see `packages/shared/CLAUDE.md` for the distinction between hard aborts and handoff interrupts), persists.

Already-completed steps are not undone. Output remains visible.

## Concurrency

The current runner is strictly sequential. It rejects a second active run for
the same `(workspaceId, workflowSlug)` pair. `parallelGroup` is not supported.

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
