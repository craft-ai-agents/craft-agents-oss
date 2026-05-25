# Workflow Graph Canvas Spec

## Decision

Canvas should support read-only workflow graph Outputs before adding workflow editing or live control surfaces.

The preferred agent output is:

1. `.workflow.json` for a simple graph.
2. `.workflow-run.json` for a persisted run snapshot.
3. Existing workflow/run pages for editing, cancellation, resume, and deeper details.

## Direct Graph Shape

```json
{
  "title": "Launch workflow",
  "state": "running",
  "nodes": [
    { "id": "brief", "label": "Brief", "agent": "strategist", "state": "succeeded" },
    { "id": "draft", "label": "Draft", "agent": "writer", "state": "running" }
  ]
}
```

Supported node states:

- `queued`
- `running`
- `succeeded`
- `failed`
- `interrupted`
- `skipped`
- `awaiting-human`

Canvas also accepts existing workflow run snapshots with `workflowSnapshot.metadata.steps` and `steps`.

## Renderer Behavior

- `.workflow.json` and `.workflow-run.json` infer preview mode `workflow`.
- Workflow JSON renders as a vertical step graph in `OutputInlinePreview`.
- Invalid workflow JSON shows a clear unavailable state and marks preview review as errored.

## Out Of Scope

- No workflow editing in Canvas.
- No live cancellation/resume controls.
- No graph layout engine dependency.
- No multi-branch DAG visualization yet.
