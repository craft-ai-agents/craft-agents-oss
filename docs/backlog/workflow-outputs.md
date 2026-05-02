# Workflow Outputs

## Status

Backlog proposal.

## Problem

Workflow runs currently have step outputs, but they do not have first-class user-facing deliverables.

The effective "final output" is usually the last assistant message in the final workflow step session. That forces the user to:

1. open the workflow run,
2. inspect the step list,
3. open the last step session,
4. scroll or read the final chat message,
5. manually find any files or external actions the agent produced.

That makes workflows feel like chained chats instead of production pipelines.

## Goal

Introduce a first-class `Output` domain:

```text
Workflow Run -> produces Output(s)
Output -> has title, type, summary, files, preview, provenance, receipts, and open actions
```

Outputs should answer: "What did the system make or accomplish?"

Sessions should answer: "Who did the work and how?"

Workflow runs should answer: "What pipeline ran and what happened step by step?"

## Non-goals

- Do not make every assistant message an output.
- Do not replace sessions as the audit trail.
- Do not require a database in phase 1.
- Do not invent a full CMS.
- Do not hide provenance; every output must link back to its run, step, and session.
- Do not treat temporary tool scratch files as deliverables unless explicitly published.

## Core concepts

### Output

A durable, user-facing deliverable or external action receipt.

Examples:

- research report
- generated image or video
- exported CSV
- code review report
- Reddit post receipt
- sent email receipt
- deployed URL
- scraped dataset
- created slide deck
- automation run summary

### Output bundle

One folder containing an output manifest and related files.

```text
<workspaceRoot>/outputs/
  <createdAtSlug>-<shortRunId>-<outputSlug>/
    output.json
    report.md
    sources.json
    attachments/
      chart.png
```

### Output manifest

The canonical metadata for rendering, searching, and linking.

```ts
interface OutputManifest {
  schemaVersion: 1
  id: string
  workspaceId: string
  title: string
  slug: string
  kind: OutputKind
  status: 'draft' | 'published' | 'failed' | 'cancelled'
  summary: string
  createdAt: string
  updatedAt: string
  completedAt?: string

  origin: {
    source: 'workflow' | 'session' | 'automation' | 'manual'
    workflowRunId?: string
    workflowSlug?: string
    workflowName?: string
    stepId?: string
    sessionId?: string
    agentSlug?: string
    agentName?: string
    automationId?: string
  }

  primary?: OutputAsset
    assets: OutputAsset[]
    receipts: OutputReceipt[]
    links: OutputLink[]

  preview?: {
    mode: 'markdown' | 'text' | 'json' | 'image' | 'video' | 'audio' | 'table' | 'receipt' | 'external-link'
    assetId?: string
    inlineText?: string
  }

  tags?: string[]
}
```

### Output kinds

```ts
type OutputKind =
  | 'report'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'dataset'
  | 'code'
  | 'receipt'
  | 'external-action'
  | 'collection'
  | 'other'
```

### Asset

```ts
interface OutputAsset {
  id: string
  label: string
  role: 'primary' | 'supporting' | 'source' | 'thumbnail' | 'attachment'
  path: string
  mimeType?: string
  sizeBytes?: number
  sha256?: string
}
```

Paths are stored relative to the output bundle when possible. Absolute paths may be allowed only when the asset is outside workspace storage and must pass the same path validation used by file preview/open actions.

### Link

Links are non-receipt URLs attached to the output, such as a published page, source document, or dashboard.

```ts
interface OutputLink {
  id: string
  label: string
  url: string
  role?: 'primary' | 'source' | 'related' | 'external'
}
```

### Receipt

Receipts describe external side effects.

```ts
interface OutputReceipt {
  id: string
  provider: string
  action: string
  status: 'succeeded' | 'failed' | 'pending'
  occurredAt: string
  externalId?: string
  url?: string
  displayText?: string
  metadata?: Record<string, unknown>
}
```

Examples:

- `provider: "reddit", action: "post.create", url: "https://reddit.com/..."`
- `provider: "vercel", action: "deploy", url: "https://..."`
- `provider: "gmail", action: "email.send", externalId: "..."`

## Storage layout

Phase 1 should use workspace-local files:

```text
<workspaceRoot>/
  outputs/
    <outputId>/
      output.json
      ...
```

Use `outputs/`, not `runs/<runId>/outputs/`, because the user mental model is chronological deliverables across workflows, automations, and sessions. The run id remains in the manifest.

Run storage can still maintain a backlink:

```ts
interface WorkflowRunSnapshot {
  outputIds?: string[]
  finalOutputId?: string
}
```

## Output IDs

Use UUIDs for durable IDs. Use slugs only for display and folder names if desired.

Recommended folder name:

```text
<yyyy-mm-dd-hhmmss>-<kind>-<short-id>/
```

The manifest `id` remains the source of truth.

## Publishing model

An output is created only through an explicit publishing path:

- workflow finalization creates a default output
- agent calls `create_output`
- connector/tool records an external receipt via `record_output_receipt`
- user manually promotes a session message/file to output

Do not auto-publish every step output.

## Workflow integration

### Workflow frontmatter additions

Add optional top-level `outputs` contract:

```yaml
outputs:
  mode: final-step       # final-step | explicit-tool | none
  kind: report           # default kind when finalizing
  title: "Research brief: {{trigger.topic}}"
  summary: "{{steps.final.output.summary}}"
  primary:
    from: step-output     # step-output | file | external-link
    step: final
    path: reportMarkdown  # optional dot path for structured output
```

Default behavior when omitted:

```yaml
outputs:
  mode: final-step
  kind: report
```

This gives existing workflows a deliverable without requiring immediate edits.

### Step-level output hints

Allow a step to declare that it may publish a deliverable:

```yaml
steps:
  - id: write-report
    agent: researcher
    input: "Write the report..."
    publishes:
      kind: report
      title: "Research report"
      primaryAsset: report.md
```

Phase 1 can skip `publishes` and only support run-level finalization. Add this later if workflows need multiple outputs per run.

### Final-step default output

When a workflow succeeds and no explicit output was published:

1. Find the last succeeded step.
2. Extract its `output`.
3. Create a manifest.
4. If output is string, write `content.md` or `content.txt`.
5. If output is JSON, write `content.json` and render JSON preview.
6. Link `run.finalOutputId`.

This fixes the current UX immediately.

### Explicit output tool

Add session tool:

```text
create_output
```

Purpose: let final agents intentionally publish a deliverable instead of burying it in chat.

Input:

```ts
interface CreateOutputInput {
  title: string
  kind: OutputKind
  summary: string
  content?: string
  contentMimeType?: 'text/markdown' | 'text/plain' | 'application/json'
  files?: Array<{ path: string; label?: string; role?: OutputAsset['role'] }>
  links?: Array<{ label: string; url: string; role?: string }>
  receipts?: OutputReceipt[]
  tags?: string[]
}
```

Behavior:

- creates an output bundle
- copies or references files after path validation
- writes `output.json`
- returns `{ outputId, path, urlRoute }`
- associates output with current workflow run/session when available

### Update output tool

Optional phase 1.5:

```text
update_output
```

Useful for long workflows where an output is drafted and enriched over multiple steps.

### Record receipt tool

Add low-level helper for connector tools:

```text
record_output_receipt
```

Most agents should not call this directly. Connector handlers should call it after successful external actions.

Examples:

- Reddit post tool records post URL and id.
- Vercel deploy tool records deployment URL.
- Gmail send tool records message id.

## Connector wiring

Connectors and external-trigger handlers should return receipt-shaped structured content when they cause external side effects.

Recommended common shape:

```ts
interface ToolExternalReceipt {
  provider: string
  action: string
  status: 'succeeded' | 'failed' | 'pending'
  externalId?: string
  url?: string
  displayText?: string
  metadata?: Record<string, unknown>
}
```

Session/tool infrastructure can inspect successful tool results for this shape and offer to attach it to the current output.

Phase 1 simpler path:

- only `create_output` accepts receipts
- final agent includes receipt data when publishing

Phase 2 richer path:

- tool handlers emit standardized receipt events
- active workflow run collects receipts per step
- final output includes receipts automatically

## RPC / backend surface

Add shared protocol namespace:

```ts
RPC_CHANNELS.outputs = {
  LIST: 'outputs:list',
  GET: 'outputs:get',
  CREATE: 'outputs:create',
  UPDATE: 'outputs:update',
  DELETE: 'outputs:delete',
  OPEN_FILE: 'outputs:openFile',
  SHOW_IN_FOLDER: 'outputs:showInFolder',
  UPDATED: 'outputs:updated',
}
```

Handlers:

```ts
listOutputs(workspaceId, filter?): OutputSummary[]
getOutput(workspaceId, outputId): OutputManifest | null
createOutput(workspaceId, input): OutputManifest
updateOutput(workspaceId, outputId, patch): OutputManifest
deleteOutput(workspaceId, outputId): boolean
```

Events:

- `outputs.updated` for create/update/delete
- `workflow-runs.updated` when `finalOutputId` or `outputIds` changes

## Shared package layout

Add:

```text
packages/shared/src/outputs/
  types.ts
  storage.ts
  validation.ts
  preview.ts
  index.ts
```

Storage responsibilities:

- create output directory
- validate output id
- atomically write manifest
- list newest-first
- safely resolve asset paths
- delete output bundle

Preview responsibilities:

- infer preview mode from primary asset mime/type
- derive summary fallback from content
- create short list row text

## Server-core wiring

Add:

```text
packages/server-core/src/handlers/rpc/outputs.ts
packages/server-core/src/outputs/OutputService.ts
```

`OutputService` should know how to:

- resolve workspace root from workspace id
- create output bundles
- copy declared files into bundle or reference them safely
- create default output from a completed workflow run
- attach output id back to run snapshot
- emit output update events

`WorkflowRunner` integration:

- on successful run completion, call `OutputService.createDefaultWorkflowOutput(run)` unless an output already exists
- emit workflow and output update events
- include output ids in returned run snapshots

Session tool integration:

- expose `create_output` in session-tools-core
- wire SessionManager callback to `OutputService.createFromSessionTool(...)`
- pass workflow run context into hidden step sessions, so the tool can attach to the correct run

## Renderer / UI

### Main navigation

Add `Outputs` to main nav.

Suggested order:

```text
Sessions
Agents
Workflows
Outputs
Sources
Automations
Settings
```

If vertical space is tight, place Outputs near Workflows because workflow runs will be the main producer.

### Outputs navigator

Middle panel:

- chronological output rows
- filter by kind
- filter by producer: workflow, session, automation
- search title/summary
- status pills
- small source label: workflow name / agent name / provider

Row shape:

```text
Research brief: AI agents
Report · Weekly Content Pipeline · 4m ago
```

### Output detail page

Main pane sections:

- header: title, kind, status, created time
- primary preview
- summary
- assets list
- receipts / external links
- provenance
- actions

Actions:

- open primary file
- show in folder
- open run
- open producing session
- copy link/path
- delete output

### Workflow run page

Add a top-level Output section above or beside step details:

- while running: "Output will appear here when the workflow publishes one."
- succeeded with output: output card with preview and Open Output button
- failed with partial output: show draft/failed output if one exists
- no output: fallback "No output published" plus link to final session

Important: the workflow run page should no longer require opening the final session for the normal happy path.

### Session view

Add a small output chip/activity item when a session publishes an output:

```text
Created output: Research brief
Open Output
```

Optional manual affordance:

- "Promote to Output" on assistant message
- "Save as Output" for files in session files sidebar

## Navigation routes

Extend route state:

```ts
type NavigatorType = ... | 'outputs'

interface OutputsNavigationState {
  navigator: 'outputs'
  outputId?: string
  filter?: {
    kind?: OutputKind
    producer?: 'workflow' | 'session' | 'automation' | 'manual'
  }
}
```

Routes:

```ts
routes.view.outputs()
routes.view.output(outputId)
```

Route strings:

```text
outputs
outputs/<outputId>
```

## Preview behavior

Use existing preview infrastructure where possible.

| Asset type | Detail behavior |
|---|---|
| Markdown | render formatted markdown |
| Text | monospace/pre text viewer |
| JSON | tree or formatted code viewer |
| Image | image preview |
| Video/audio | media player |
| CSV | table preview |
| External URL | receipt card + open button |
| Unknown file | file metadata + open/show actions |

If preview fails, show a non-blocking error and keep asset actions available.

## Permissions and safety

- All asset paths must be contained in the output bundle or pass existing workspace allowed-dir validation.
- Delete should move to trash if possible or require confirmation.
- Never execute output files.
- External links open through existing shell URL validation.
- Receipts must not store secrets or raw auth tokens.
- Manifest JSON should be treated as untrusted when rendered.

## Lifecycle states

```text
draft -> published
draft -> failed
draft -> cancelled
published -> deleted
```

Phase 1 can use only:

- `published` for completed outputs
- `failed` for output records representing failed external actions

Use `draft` later for multi-step output assembly.

## Failure states

### Workflow succeeds but output creation fails

- Run remains `succeeded`.
- Run gets `outputError`.
- UI shows "Workflow succeeded, but output publishing failed."
- User can still inspect final session.

Do not fail the whole workflow after useful work completed.

### Output asset missing

- Manifest still renders.
- Asset row shows missing/error state.
- Other assets and receipts remain usable.

### External action succeeds but output write fails

- Tool result still appears in session.
- Log output write failure.
- If possible, retry creating receipt output from structured tool result.

### Duplicate title

- Allow duplicate titles.
- IDs are unique.
- Folder names can suffix short IDs.

## Migration / compatibility

Existing runs do not have outputs.

Add lazy backfill:

- when opening an old succeeded run with no `finalOutputId`, offer "Create output from final step"
- optional one-time command later: `Backfill Outputs from Workflow Runs`

Do not eagerly mutate all old runs on startup.

## Phased implementation

### Phase 1: output index and default workflow final output

- shared output types/storage
- server output RPC
- output list/detail UI
- main nav `Outputs`
- workflow runner creates default output on success
- run snapshot stores `finalOutputId` / `outputIds`
- workflow run page shows output card

This phase fixes the current user pain.

### Phase 2: explicit `create_output` session tool

- session-tools-core handler and schema
- SessionManager callback wiring
- final agents can publish richer outputs with files/links/receipts
- transcript activity chip

### Phase 3: connector receipts

- standard receipt shape for side-effecting tools
- connector handlers return/emit receipts
- outputs can collect receipts automatically
- external-action output detail cards

### Phase 4: manual promotion and richer previews

- promote assistant message to output
- save session file as output
- CSV/table preview
- thumbnail generation
- filters/search polish

## Tests

Shared:

- validates output id and manifest schema
- writes/reads/lists output manifests newest-first
- rejects path traversal in asset paths
- handles missing asset files

Server-core:

- creates default output when workflow succeeds
- does not fail run if output creation fails
- attaches output id to run snapshot
- emits outputs updated event
- creates output from session tool with workflow provenance

Session-tools-core:

- validates `create_output` arguments
- returns structured `{ outputId, route }`
- rejects empty title/summary and unsupported kind

Renderer:

- route parser handles `outputs` and `outputs/<id>`
- Outputs nav renders chronological list
- Output detail renders markdown/json/link receipt variants
- WorkflowRunPage shows output card and links to output

## Open questions

- Should outputs live directly under `<workspaceRoot>/outputs` or under hidden `.craft/outputs`?
- Should final-step default output be enabled for every workflow or opt-in via `outputs.mode`?
- Should workflows be able to produce multiple first-class outputs in phase 1?
- Should output creation be allowed from normal non-workflow sessions immediately?
- Should connector receipts become outputs automatically or only attach when a workflow is active?
- Should outputs support user labels/statuses like sessions?

## Recommended decisions

- Use `<workspaceRoot>/outputs` for visibility and user trust.
- Enable default final-step output for every succeeded workflow.
- Support one final output per run in phase 1, multiple outputs in phase 2.
- Add `create_output` after the default-output path is working.
- Keep output labels/statuses out of phase 1; chronological + kind filters are enough.

## Success criteria

- A completed workflow has an obvious output without opening the final step session.
- Outputs are browseable chronologically from main navigation.
- The user can open files, links, receipts, and provenance from one detail page.
- Workflow sessions remain available for debugging but are no longer the primary result surface.
- External action workflows can prove what happened through receipts, not only chat text.
