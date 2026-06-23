# Agent Messaging Implementation Plan

Status: draft
Owner: RunnerOS
Last updated: 2026-06-08

## Phase 0: Decisions

Lock these before code:

- `message_agent` is a session-tool, not a separate runtime.
- Child calls spawn real sessions.
- Workflows stay the reliable orchestration layer.
- External agent protocol adapters are out of scope for this branch.
- Permission inheritance is strict.
- Child sessions are hidden from the main session list by default.

## Phase 1: Shared Types And Storage

Files:

```text
packages/shared/src/agent-messaging/types.ts
packages/shared/src/agent-messaging/storage.ts
packages/shared/src/agent-messaging/validation.ts
packages/shared/src/agent-messaging/index.ts
```

Build:

- `MessageAgentInput`
- `MessageAgentResult`
- `AgentMessageReceipt`
- validation helpers
- atomic receipt read/write/list

Tests:

- validates slug/task/timeout/max turns
- rejects loose permission escalation
- writes/reads receipt
- preserves malformed receipt errors clearly

## Phase 2: Server Service

File:

```text
packages/server-core/src/agent-messaging/AgentMessageService.ts
```

Responsibilities:

- validate input
- resolve target agent through `ISessionManager.resolveAgentSessionOptions`
- create hidden child session
- send delegated task
- wait for final assistant output
- validate structured output when provided
- collect tool-use summary
- persist receipt
- return compact result

Dependencies:

```ts
interface AgentMessageServiceDeps {
  sessionManager: ISessionManager
  getWorkspaceRootPath(workspaceId: string): string
  getParentPermissionMode(sessionId: string): PermissionMode
  getSessionToolUseSummary(sessionId: string): { count: number; names: string[] }
  getLastAssistantOutput(sessionId: string): unknown
}
```

Tests:

- happy path creates child session and returns output
- missing agent fails before session create
- unavailable source fails before session create
- child cannot exceed parent permission
- timeout cancels child session
- schema failure returns `invalid-structured-output`
- max depth blocks recursive call

## Phase 3: Session Tool

File:

```text
packages/session-tools-core/src/handlers/message-agent.ts
```

Add to session tool registry.

Tool description must be explicit:

- use only for bounded specialist delegation
- include exact task
- include expected output
- do not use for casual discussion
- do not call recursively unless the task truly needs another specialist

Tests:

- returns unavailable when context has no `messageAgent`
- validates bad input
- passes normalized input to service
- returns concise success/error envelope

## Phase 4: Run Integration

Workflow:

- Add delegation receipts to `WorkflowRunStep`.
- Step inspector renders child calls.
- Parent run persists receipt ids after each delegation.

Deep Research:

- Step timeline shows specialist subcalls.
- Selected research tools/sources can be passed to child agents.
- Failed child call marks the step failed only when the parent step requires it.

Files likely touched:

```text
packages/shared/src/workflows/run-types.ts
packages/server-core/src/workflows/runner.ts
packages/server-core/src/deep-research/DeepResearchRunner.ts
```

Tests:

- workflow step records child receipt id
- deep-research step records child receipt id
- failed child receipt appears in run snapshot

## Phase 5: UI Receipts

Files:

```text
apps/electron/src/renderer/components/agent-messaging/AgentMessageReceipt.tsx
apps/electron/src/renderer/components/agent-messaging/AgentMessageTracePanel.tsx
```

Render:

- caller -> target
- task title
- status
- duration
- tools used
- open child session link
- error reason

Avoid a new nav item for MVP. Surface receipts where work already happens:

- chat transcript
- workflow run inspector
- deep research timeline

## Verification Matrix

Unit:

```bash
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun test packages/shared/src/agent-messaging
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun test packages/server-core/src/agent-messaging
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun test packages/session-tools-core/src/handlers/message-agent.test.ts
```

Integration:

```bash
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun test packages/server-core/src/workflows/runner.test.ts
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun test packages/server-core/src/deep-research
PATH=/Users/michaelb.williams/.bun/bin:$PATH bun run typecheck:all
```

Manual smoke:

1. Create two simple local agents: `researcher`, `reviewer`.
2. Ask `researcher` to call `message_agent("reviewer", ...)`.
3. Confirm child session is hidden but openable from receipt.
4. Confirm bad target agent fails before execution.
5. Confirm child cannot escalate from `safe` parent to `allow-all`.
6. Confirm workflow run shows child receipt under the step.

## Recommended Build Order

1. Shared types/storage.
2. Server service with mocked `ISessionManager`.
3. Session tool handler.
4. Hidden child session metadata.
5. Workflow/deep-research receipt plumbing.
6. UI receipt.

## Risks

- Recursive loops: solve with depth and timeout before enabling broadly.
- Permission bypass: child max must be derived from parent.
- Context bloat: pass bounded task/context, not full transcript.
- Tool confusion: target agent source readiness must be explicit.
- UI opacity: every child call needs a receipt and session link.
- Overuse: tool prompt should discourage using specialists for trivial subtasks.

## First Shippable Slice

The smallest useful version:

- `message_agent` tool
- hidden child session
- strict validation
- receipt JSON
- text result back to parent
- no external protocol adapter
- no fancy UI beyond a receipt/link

This is enough to make Deep Research and workflows meaningfully stronger while keeping the runtime understandable.
