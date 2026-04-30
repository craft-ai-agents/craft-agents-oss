# Implementation plan

A fresh agent should be able to ship Phase 1 from this doc + [`01-spec.md`](./01-spec.md) + [`02-runtime.md`](./02-runtime.md) + [`03-ux.md`](./03-ux.md) without re-deciding anything.

`bun` is at `~/.bun/bin/bun` (not on PATH).

## Phase 0 — Design checkpoint (you are here)

**Done when:** these five docs are reviewed by the user and signed off. No code yet.

**Output:** any spec changes the user wants, baked back into these docs.

---

## Phase 1 — Linear MVP (≈1 week)

**Goal:** ship the smallest end-to-end thing. Manual trigger, sequential steps, plain string outputs, no retries, no parallelism, no human-checkpoints. The Run page works. Output of step N becomes input of step N+1 via templating.

### Scope

✅ In:
- `WORKFLOW.md` parse/serialize/validate, global library at `~/.workflows/<slug>/`, per-workspace activation manifest.
- `WorkflowRunner` walks steps sequentially; each step is a real `Session`; output = last assistant message.
- Templating: `{{trigger.x}}` and `{{steps.<id>.output}}` (string only).
- RPC + IPC bridge for: list workflows, get one, upsert, delete, activate/deactivate, start run, get run, list runs, cancel run, subscribe to run updates.
- Renderer atoms + hooks mirroring the workspace-context pattern.
- Sidebar: top-level **Workflows** entry with children (activated workflows + Manage + Recent runs).
- Pages: list, detail, editor (raw `WORKFLOW.md` mode only — form mode is Phase 1.5), run input form, **Run page**, Recent runs.
- Two seeded starter workflows (see [`05-examples.md`](./05-examples.md)).

❌ Out (deferred):
- Form-mode editor (raw mode is enough to ship).
- `outputSchema` / structured outputs.
- `retries`, `timeout`, `when`, `humanCheckpoint`, `parallelGroup`.
- Schedule / automation / webhook triggers.
- Resume-on-restart for `running` runs (just mark them failed).
- Side-pane drill-down. Phase 1 ships with a simple "View session" link on each card that navigates away — full embedded side-pane comes Phase 1.5.
- Templating autocomplete. Users see a help tooltip with the syntax instead.

### Files to add (proposed; mirror existing patterns)

```
packages/shared/src/workflows/
  types.ts
  storage.ts                 # parse, serialize, CRUD on global library + activation manifest
  template.ts                # ~50 LOC tiny resolver
  storage.test.ts
  template.test.ts
  index.ts

packages/server-core/src/workflows/
  runner.ts                  # state machine; step loop; subscribes to SessionManager events
  runs.ts                    # persistence: read/write/list runs

packages/server-core/src/handlers/rpc/
  workflows.ts               # RPC handlers (list/get/upsert/delete/activate)
  workflow-runs.ts           # RPC handlers (start/get/list/cancel + change events)

packages/shared/src/protocol/
  channels.ts                # add `workflows` and `workflowRuns` namespaces
  events.ts                  # add change events

apps/electron/src/transport/
  channel-map.ts             # bridge + listeners

apps/electron/src/shared/
  types.ts                   # DTO re-exports + ElectronAPI extensions

apps/electron/src/renderer/state/
  workflows.ts               # atoms + hooks

apps/electron/src/renderer/pages/workflows/
  WorkflowsListPage.tsx
  WorkflowDetailPage.tsx
  WorkflowEditPage.tsx
  RunInputDialog.tsx

apps/electron/src/renderer/pages/workflow-run/
  WorkflowRunPage.tsx
  StepCard.tsx
  RunControls.tsx

apps/electron/src/renderer/pages/runs/
  RecentRunsPage.tsx

apps/electron/src/shared/routes.ts
  # add routes.view.workflows, routes.view.workflow(slug),
  # routes.view.workflowEdit(slug), routes.view.workflowRun(runId),
  # routes.view.recentRuns
```

### Build order (within Phase 1)

1. **Shared module first** (`packages/shared/src/workflows/`). Types, parser/serializer, validation, templating resolver. Tests for each. **Stop and run typecheck + tests before moving on.**
2. **Runner** (`server-core/src/workflows/`). Unit tests with a mock SessionManager — assert state transitions and event emissions for happy path, cancel, and one failing step. Don't try to write integration tests against the real LLM.
3. **RPC layer.** Mirror the workspace-context handler verbatim. Add the channels, register the handler, extend the bridge + ElectronAPI.
4. **Renderer state.** Atom family keyed by workspaceId, hooks, RPC subscriptions.
5. **UI top-down.** Sidebar entries → Workflows list → Detail → Editor (raw mode) → Run input dialog → Run page → Recent runs.
6. **Seed starters** in `SessionManager.initialize` alongside Concierge/Orchestrator.
7. **Verify all three packages typecheck.** Click through the demo flow manually.

### Success criteria

- User can author a 3-step `WORKFLOW.md` in the editor, save, click Run, fill in inputs, watch step cards advance live, and see the final output.
- Cancel mid-run cleanly aborts and persists state.
- Reopening the app shows the cancelled run in Recent runs with correct state.
- Typecheck clean across `packages/shared`, `packages/server-core`, `apps/electron`.
- Tests for shared + runner pass; renderer atom test pattern matches existing precedent (skip if no precedent).

---

## Phase 1.5 — Polish (~3 days)

Plumbed correctly, just felt rough in Phase 1.

- Form-mode workflow editor with drag-to-reorder steps.
- Templating autocomplete in the `input` textarea.
- Side-pane drill-down on the Run page (clicking a card slides in the live session viewer).
- Streaming partial output into running step cards.
- Cross-platform notification when a run completes or hits awaiting-human (already a thing for sessions — reuse).

---

## Phase 2 — Reliability (~1 week)

**Goal:** workflows that don't fall over.

- `outputSchema` (JSON Schema in step config). Reuse `buildCallLlmRequest` + `outputSchema` plumbing from `packages/shared/src/agent/llm-tool.ts`.
- `timeout` per step (kill session, mark failed).
- `retries` per step.
- "Resume from step…" run-level control.
- Side-pane "Rerun this step alone."
- Resume-on-restart for `running` runs (best-effort reattach via SessionManager; otherwise mark failed).

**Success:** a 7-step workflow with structured outputs runs to completion 95%+ of the time on stable models. Failures are debuggable from the Run page without leaving the app.

---

## Phase 3 — Branching, parallel, human-in-the-loop (~1.5 weeks)

- `when:` expressions on steps (use `filtrex` — already in `packages/shared` deps for automations matchers).
- `parallelGroup` (concurrent execution within a group; runner advances when all complete).
- `humanCheckpoint`: pause UI, Approve / Reject / Edit-and-continue buttons, OS notification on pause.
- `Fork` run-level control: clone the WORKFLOW.md as `<slug>-fork` and open in editor.

**Success:** the north-star demo from `README.md` works end-to-end.

---

## Phase 4 — Triggers (~1 week)

- `schedule` trigger: cron expression. Reuse `croner` (already in deps).
- `automation` trigger: hook into the existing automation matcher system; a workflow can be triggered by any matcher.
- `webhook` trigger: per-workflow URL on the existing trigger HTTP server.
- Trigger inputs: matcher payload → workflow `trigger.inputs` mapping.

**Success:** a webhook-triggered workflow runs to completion when an external system POSTs to its URL.

---

## Phase 5+ — Power user / community (open-ended)

- Visual node-graph builder.
- Workflow marketplace / sharing (export/import bundles already exist in `@craft-agent/shared/resources`).
- Sub-workflows / nesting (`agent: workflow:<slug>` as a step type).
- Durable execution (wrap runner in Inngest if/when needed). **Don't do this until you have real users hitting real reliability problems.**
- Cost guardrails (per-run token budgets, hard stops).

---

## Risks & open questions

| Risk | Mitigation |
|------|-----------|
| Sessions don't reliably emit a "complete" signal at end of step. | Already a solved problem — SessionManager has lifecycle hooks; the runner subscribes the same way the renderer does. |
| Long step outputs blow the next step's context window. | Phase 2 — `outputSchema` is the answer; or a `truncate:` option on the step. Document the tradeoff. |
| User edits a workflow while a run is in flight against the previous version. | Snapshot the parsed workflow into the run at start; the in-flight run uses the snapshot, not live re-reads. Already implied by `02-runtime.md`'s `run.json` schema — make sure the snapshot lives there too. **Add this to the `run.json` schema before Phase 1 ships.** |
| User races two runs of the same workflow. | Phase 1 = at most 1 concurrent run per workflow. Trying to start a second shows "already running — view that run" with a link. Configurable later. |

## Done definition for the whole feature

User can:
1. Author a workflow in the editor (form OR raw mode).
2. Run it manually with inputs.
3. Watch it progress live, drill into any step's session.
4. Cancel cleanly.
5. See it succeed, fail, or pause for approval.
6. Schedule it, fire it from a webhook, or trigger it from any automation matcher.
7. Fork an existing workflow to tweak it without breaking the original.
8. Browse a chronological list of every run across every workflow.

When (1)–(8) all work, ship a `v1` tag and write the marketing post.
