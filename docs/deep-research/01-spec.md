# Deep Research Mode Spec

Status: draft
Owner: RunnerOS
Last updated: 2026-05-23

## Product Goal

Deep Research mode gives RunnerOS a high-trust investigation path for broad, source-heavy, multi-step questions.

It should feel like this:

1. User asks a serious question.
2. RunnerOS drafts a concrete research plan.
3. Depending on policy, the user approves/edits the plan or RunnerOS runs it automatically.
4. RunnerOS executes each step through normal agents and sources.
5. RunnerOS produces a final report artifact with citations, receipts, and a trace.

The win is not "more planning." The win is controlled execution with visible intent, source readiness checks, recoverable steps, and inspectable evidence.

## ARGO Wisdom To Keep

ARGO's useful product pattern:

- separate planner, researcher, coder/processor, and reporter roles
- stream a plan before execution
- allow human feedback on the plan
- keep a persisted thought/tool trace
- route retrieval through knowledge bases and MCP tools
- produce a final report, not just chat text

What RunnerOS should avoid:

- do not port LangGraph as a second orchestration runtime
- do not make this one giant system prompt
- do not hide the plan inside an agent transcript
- do not call research "done" without citations and tool receipts

## Native RunnerOS Shape

Deep Research is a workflow-backed run mode with a specialized plan gate.

Suggested package surface:

```text
packages/shared/src/deep-research/
  types.ts
  plan-schema.ts
  validation.ts

packages/server-core/src/deep-research/
  DeepResearchRunner.ts
  planner.ts
  step-dispatch.ts
  report-builder.ts

packages/server-core/src/handlers/rpc/deep-research.ts

apps/electron/src/renderer/pages/DeepResearchRunPage.tsx
apps/electron/src/renderer/components/deep-research/
  PlanReviewPanel.tsx
  ResearchStepTimeline.tsx
  CitationInspector.tsx
```

This can initially reuse `WorkflowRunner` internals instead of creating a fully separate runner. If the existing workflow schema cannot cleanly express the plan-review pause, add the smallest extension to run state rather than forking the whole runtime.

## Execution Policies

Deep Research supports two plan policies:

```ts
export type DeepResearchPlanPolicy = 'approve' | 'auto'
```

### Approve Mode

Default for UI-created research runs.

Flow:

1. Planner session creates a structured plan.
2. Runner validates the plan.
3. Run enters `awaiting_plan_approval`.
4. User can approve, edit in natural language, or cancel.
5. Approved plan is snapshotted and execution starts.

Edits should resume the planner with a clear instruction:

```text
Revise the plan using this user feedback. Return the full replacement plan.
```

### Auto Mode

Default only for explicit "run it" calls, automations, or trusted workflows.

Flow:

1. Planner session creates a structured plan.
2. Runner validates the plan.
3. Runner records `approval: { policy: 'auto', approvedBy: 'system' }`.
4. Execution starts immediately.

Auto mode does not skip source/tool checks. It only skips human plan approval.

## Run State

Add a Deep Research run type or extend workflow run metadata:

```ts
export interface DeepResearchRun {
  id: string
  workspaceId: string
  sourceSessionId?: string
  state:
    | 'planning'
    | 'awaiting_plan_approval'
    | 'running'
    | 'synthesizing'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
  planPolicy: DeepResearchPlanPolicy
  topic: string
  plan?: DeepResearchPlan
  approval?: DeepResearchApproval
  steps: DeepResearchRunStep[]
  reportOutputId?: string
  createdAt: string
  updatedAt: string
}

export interface DeepResearchApproval {
  policy: DeepResearchPlanPolicy
  approvedBy: 'user' | 'system'
  approvedAt: string
  revisionCount: number
}
```

Storage should follow existing run storage conventions:

```text
<workspaceRoot>/deep-research-runs/<runId>/
  run.json
  plan.json
  steps/<stepId>.json
  report.md
  citations.json
```

If this lands as a workflow extension first, use the existing `runs/<runId>/` layout and add `kind: 'deep-research'` metadata.

## Plan Schema

The planner must output structured JSON. The runner must reject vague or unsafe plans.

```ts
export interface DeepResearchPlan {
  schemaVersion: 1
  title: string
  objective: string
  assumptions: string[]
  requiredSources: string[]
  requiredSkills?: string[]
  maxSteps: number
  steps: DeepResearchPlanStep[]
  reportSpec: DeepResearchReportSpec
  riskNotes: string[]
}

export interface DeepResearchPlanStep {
  id: string
  title: string
  type: 'research' | 'processing'
  goal: string
  method: string
  sourceSlugs: string[]
  expectedEvidence: string[]
  outputSchema?: Record<string, unknown>
  completion: {
    requireToolUse: boolean
    minOutputChars: number
  }
}

export interface DeepResearchReportSpec {
  format: 'brief' | 'report' | 'table' | 'decision_memo'
  audience?: string
  mustInclude: string[]
  citationStyle: 'inline' | 'footnotes' | 'source_table'
}
```

Validation rules:

- `title`, `objective`, and `steps` are required.
- step ids must be slug-shaped and unique.
- default max step count is 8; hard cap is 15 for MVP.
- every required source must exist and be usable before execution.
- OAuth sources with `connectionStatus: "needs_auth"` must block.
- every research step must require tool use.
- each step must be self-contained enough to run as its own session.
- auto mode still fails if validation fails.

## Source Readiness

Use existing source truth:

- `loadAllSources(workspaceRootPath)`
- `isSourceUsable(source)`
- agent-declared source resolution in `SessionManager`

Do not duplicate source state.

Before execution:

1. Resolve `plan.requiredSources`.
2. Resolve each step's `sourceSlugs`.
3. Fail loudly with a grouped readiness error:

```ts
{
  code: 'deep-research-sources-unavailable',
  missing: ['...'],
  needsAuth: ['meta-ads'],
  disabled: ['...'],
  unusable: ['...']
}
```

The UI should show one repair action per source: authenticate, activate, enable, or remove from plan.

## Step Execution

Each step spawns a real RunnerOS session.

Session inputs must include:

- original topic
- approved plan summary
- current step
- prior step outputs needed for context
- exact source/tool constraints
- required output format

Research step prompt shape:

```text
You are executing one Deep Research step.

Topic: ...
Approved plan: ...
Current step: ...
Allowed sources/tools: ...
Expected evidence: ...

Return evidence with source receipts. Do not synthesize the final report.
```

Processing step prompt shape:

```text
You are processing collected evidence for one Deep Research step.

Inputs: ...
Task: ...

Return structured findings. Preserve source ids when deriving conclusions.
```

The runner should persist after every transition. A crash must leave enough state to resume or mark the active step failed with `orphaned-session`.

## Report Synthesis

The reporter session receives:

- topic
- approved plan
- step outputs
- citation receipts
- report spec

The final answer must be saved through the output system as a report artifact.

Report requirements:

- answer the original objective directly
- show what evidence supports each major claim
- list source citations or receipts
- call out uncertainty and gaps
- include "what was not verified"
- avoid raw transcript dumps

The chat response after completion should be short and link to the artifact/run.

## Citations And Evidence

Every tool-backed research result should produce a source receipt:

```ts
export interface DeepResearchCitation {
  id: string
  stepId: string
  sourceSlug?: string
  toolName?: string
  title?: string
  uri?: string
  filePath?: string
  excerpt?: string
  retrievedAt: string
  confidence: 'high' | 'medium' | 'low'
}
```

MVP can extract citations from explicit step output JSON. Later, the trace inspector can derive receipts from tool events.

## Trace Inspector

Deep Research needs a first useful trace view.

Minimum fields:

- plan version
- step state
- session id
- agent slug
- sources requested
- sources actually attached
- tools used
- output id
- duration
- token/cost metadata when available
- failure reason

This should reuse workflow run UI patterns and link into hidden step sessions.

## UI

Entry points:

- command palette: "New Deep Research"
- chat action: "Run as Deep Research"
- workflow/template library: "Deep Research"

Start dialog:

- topic
- plan policy: `Review plan first` on/off
- depth: quick/default/deep
- source set: automatic/manual
- report format

Plan review panel:

- editable plan cards
- required source readiness badges
- Approve and Run
- Revise Plan
- Cancel

Run page:

- plan header
- step timeline
- active step transcript link
- citations tab
- final report artifact

## Permission And Safety

Permission model:

- planning is read-only
- source validation is read-only
- research steps inherit selected permission mode
- report writing only mutates RunnerOS-owned output state
- file writes, external mutations, paid provider actions, campaign changes, or browser automation follow existing permission rules

Auto mode must not imply `allow-all`.

## MVP Implementation Plan

### Phase 0: Template prototype

Create a built-in `deep-research` workflow template that proves the shape with existing workflow runner features.

Limitations accepted:

- manual plan review may be represented as a normal pause/failure until `awaiting_plan_approval` exists
- citations can be JSON in step outputs

### Phase 1: Native plan gate

Add `awaiting_plan_approval` run state and RPCs:

```ts
startDeepResearch(input)
approveDeepResearchPlan(runId)
reviseDeepResearchPlan(runId, feedback)
cancelDeepResearchRun(runId)
```

### Phase 2: Run UI

Add `DeepResearchRunPage`, plan cards, source readiness, and step timeline.

### Phase 3: Report artifact

Persist final report through outputs. Add citation table and artifact sidecar link.

### Phase 4: Trace inspector

Show execution receipts and tool/source trace for each step.

## Test Plan

Unit tests:

- plan schema validation
- approve vs auto policy transitions
- source readiness grouping
- resume after orphaned active step
- report artifact persistence

Integration tests:

- auto mode plans and starts without approval
- approve mode pauses before execution
- missing source blocks before any step session starts
- `needs_auth` OAuth source blocks with a clear error
- failed step records error and preserves prior outputs

Manual smoke:

1. Run a small public-web research task in approve mode.
2. Revise the plan once, then approve.
3. Confirm step sessions are hidden from main list but openable from run page.
4. Run the same task in auto mode.
5. Confirm final report artifact has citations and a saved plan.

## Non-Goals

- no LangGraph dependency
- no autonomous tool mutation by default
- no durable multi-day distributed execution in MVP
- no general graph editor
- no knowledge-base rebuild in the first Deep Research slice

## Open Decisions

- Should Deep Research be stored under existing workflow runs with `kind: 'deep-research'`, or under a separate `deep-research-runs/` folder?
- Should planner/researcher/reporter be bundled built-in agents, hidden system agents, or regular global agents activated by default?
- Should the first UI live under Workflows, Runs, or a new Research navigation item?
- What is the default max step count for `deep` depth on consumer hardware?
