# Workflow Recovery + Rerun From Step

## Goal

Workflows should survive normal desktop reality: app reloads, crashes, machine
sleep, and imperfect agent steps. A multistep job should never be left as a
mysterious forever-running run, and users should not need to restart a full
pipeline after one late step fails.

## User Contract

- If RunnerOS disappears while a workflow is running, the run becomes
  `interrupted` on the next startup/recovery pass.
- `interrupted` means execution stopped outside the workflow's logic. It is not
  the same as `failed`, `cancelled`, or `succeeded`.
- The Run page shows where execution stopped and why.
- The user can resume by starting a new run from the first incomplete step, or
  rerun from a chosen step.
- Prior successful step outputs are copied into the resumed run so downstream
  templates still resolve.

## State Model

Add run state:

```ts
type WorkflowRunState =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
```

Add recovery metadata to `WorkflowRunSnapshot`:

```ts
interruptedAt?: string
interruptionReason?: string
resumeFromStepId?: string
resumedFromRunId?: string
resumedByRunId?: string
```

`resumedFromRunId` belongs on the new run. `resumedByRunId` may be written to
the previous run if we choose to link history.

## Startup Recovery

On server/session-manager initialization, scan each workspace's workflow runs:

1. Find runs with `state: 'running'`.
2. Mark each as `interrupted`.
3. Mark the currently `running` step as failed with:
   - `error.code = 'run-interrupted'`
   - `error.message = <reason>`
4. Persist with the existing atomic `run.json` write path.
5. Broadcast workflow-run updates if the workspace is active.

Conservative first version: do not auto-resume. Make interruption visible and
let the user resume intentionally.

## Rerun From Step

Create a new run from an existing run:

1. Load the previous run.
2. Validate `stepId`, or choose the first non-succeeded step.
3. Use the previous run's `workflowSnapshot`, not the live workflow file.
4. Copy all successful step records before the target step.
5. Queue target and later steps.
6. Preserve original trigger inputs.
7. Execute normally from the target step.

This avoids rerunning expensive successful work while keeping the new run's
history clean.

## Run Page UX

- Show `interrupted` as its own state.
- Header action: `Resume from next incomplete step`.
- Step action: `Rerun from this step` for failed, interrupted, and queued steps.
- Keep the hidden session drill-down for detailed transcripts.
- After resume starts, navigate to the new run page.

## Not In This Slice

- Automatic resume without user confirmation.
- Branching/loops/parallel execution.
- Cross-machine distributed durability.
- Temporal/queue-backed execution.
- Editing old run snapshots.
