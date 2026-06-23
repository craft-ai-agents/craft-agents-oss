# Agent Messaging Spec

Status: draft
Owner: RunnerOS
Last updated: 2026-06-08

## Product Goal

RunnerOS should let specialist agents collaborate without making every task a giant prompt or every orchestration path a static workflow.

The intended feel:

1. User asks Concierge, Orchestrator, Deep Research, or a workflow to do something broad.
2. The active agent decides a specialist is better for one bounded subtask.
3. It calls `message_agent`.
4. RunnerOS starts a real child session for the target agent, with explicit constraints.
5. The child returns a result.
6. The parent uses that result and the UI shows the delegation trace.

The win is controlled delegation, not autonomous chatter.

## Relationship To Workflows

Workflows stay primary when the path is known:

```text
research -> analyze -> draft -> review
```

Agent messaging is useful when a step needs specialist help inside that path:

```text
workflow step: researcher
  -> message_agent("legal-reviewer", ...)
  -> message_agent("data-analyst", ...)
  -> return final evidence packet
```

RunnerOS should not choose between workflows and agent messaging. The right design is:

```text
WorkflowRunner / DeepResearchRunner / Room / Automation
  -> AgentMessageService
    -> child Session
      -> target Agent + resolved skills/sources/context/memory
```

## Non-Goals

- No free-form infinite multi-agent chat loop.
- No LangGraph runtime import.
- No external agent protocol adapter in this branch.
- No direct cross-agent memory mutation outside existing memory tools/policies.
- No parallel delegation in MVP unless a parent workflow already controls it.
- No hidden desktop control escalation.

## Native Runtime Shape

Suggested package surface:

```text
packages/shared/src/agent-messaging/
  types.ts
  validation.ts
  storage.ts

packages/server-core/src/agent-messaging/
  AgentMessageService.ts

packages/server-core/src/handlers/rpc/agent-messaging.ts

packages/session-tools-core/src/handlers/message-agent.ts

apps/electron/src/renderer/components/agent-messaging/
  AgentMessageReceipt.tsx
  AgentMessageTracePanel.tsx
```

The service should depend on `ISessionManager`, not Electron-specific code.

## Tool Contract

Expose one tool to agents:

```ts
message_agent(input: MessageAgentInput): Promise<MessageAgentResult>
```

Input:

```ts
export interface MessageAgentInput {
  agentSlug: string
  task: string
  context?: string
  expectedOutput?: string
  outputSchema?: Record<string, unknown>
  sourceSlugs?: string[]
  skillSlugs?: string[]
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  timeoutSeconds?: number
  maxTurns?: number
  priority?: 'low' | 'normal' | 'high'
}
```

Result:

```ts
export interface MessageAgentResult {
  ok: boolean
  childSessionId: string
  agentSlug: string
  output?: unknown
  summary?: string
  toolUseCount: number
  toolNames: string[]
  durationMs: number
  error?: {
    code: string
    message: string
  }
}
```

## Delegation Record

Every agent message creates a receipt:

```ts
export interface AgentMessageReceipt {
  id: string
  workspaceId: string
  parentSessionId?: string
  parentRunId?: string
  parentStepId?: string
  childSessionId: string
  callerAgentSlug?: string
  targetAgentSlug: string
  task: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out'
  policy: {
    permissionMode: 'safe' | 'ask' | 'allow-all'
    timeoutSeconds: number
    maxTurns: number
    maxDepth: number
  }
  constraints: {
    sourceSlugs: string[]
    skillSlugs: string[]
    outputSchema?: Record<string, unknown>
  }
  result?: {
    output?: unknown
    summary?: string
    toolUseCount: number
    toolNames: string[]
  }
  error?: { code: string; message: string }
  createdAt: string
  updatedAt: string
  completedAt?: string
}
```

Persistence:

```text
<workspaceRoot>/agent-messages/
  <receiptId>.json
```

If the call happens inside a workflow/deep-research run, also copy or reference the receipt from the run snapshot.

## Execution Flow

1. Validate target agent slug.
2. Load target agent definition.
3. Resolve target agent session options with `SessionManager.resolveAgentSessionOptions`.
4. Validate declared/required sources and skills.
5. Clamp permission mode, timeout, max turns, and depth.
6. Create a hidden child session.
7. Send the delegated task as the first user message.
8. Wait for completion, timeout, or cancellation.
9. Validate output schema if provided.
10. Persist receipt and return compact result to caller.

Child prompt shape:

```text
You are executing a delegated RunnerOS agent message.

Delegating agent: <caller>
Target agent: <target>
Task: <task>
Context: <context>
Allowed sources/tools: <resolved list>
Expected output: <expectedOutput>

Return only the requested result. Do not ask the user follow-up questions unless the task is impossible without them.
```

If `outputSchema` is set, append the same structured output instruction style used by workflows.

## Validation Rules

- `agentSlug` must exist.
- `task` is required and capped.
- `timeoutSeconds` defaults to 300; MVP max 1800.
- `maxTurns` defaults to 1; MVP only supports one delegated turn.
- `maxDepth` defaults to 2 globally.
- Child sessions cannot exceed parent permission mode.
- Child sessions cannot use sources unavailable to the target agent/workspace.
- If `sourceSlugs` are passed, each must be usable before execution.
- If `skillSlugs` are passed, each must resolve before execution.
- If `outputSchema` is passed, final output must parse and validate.
- Delegation must fail closed when readiness checks fail.

## Permission Policy

Permission inheritance:

| Parent mode | Child max |
|---|---|
| `safe` | `safe` |
| `ask` | `ask` |
| `allow-all` | `allow-all` |

The caller may request a stricter child mode, never a looser one.

High-risk tools remain governed by existing permission rules. Agent messaging must not create a bypass around command approval, credentials, OAuth, or source auth.

## Loop Control

Agent messaging only works if loops are mechanically bounded.

Rules:

- Each receipt stores `depth`.
- Each child session receives the current delegation depth.
- A child cannot call `message_agent` once max depth is reached.
- A parent call waits for one child result at a time in MVP.
- Timeouts cancel the child session and return a failed result.
- The caller sees a concise error, not a hanging subtask.

Default:

```ts
maxDepth = 2
timeoutSeconds = 300
maxTurns = 1
```

## UI

Minimum UI:

- Inline transcript receipt: `Researcher asked Data Analyst`
- Status: running / succeeded / failed / timed out
- Expandable summary: task, result summary, tools used
- Link: open child session

Run page integration:

- Workflow step inspector shows child delegations under the step.
- Deep Research timeline shows specialist subcalls under each research step.
- Failed delegation explains readiness/timeout/schema failure clearly.

No new full-page UI is required for MVP.

## Memory Behavior

Target agent gets its normal user + agent memory injection.

Parent context passed to the child should be explicit and bounded. Do not dump the full parent transcript by default.

Child memory writes follow existing memory policy:

- explicit `save_memory` / `update_memory` / `forget_memory`
- sidecar review or safe auto-apply rules
- run/receipt provenance attached when available

Parent receives child output, not child hidden chain-of-thought or private prompt internals.

## Sources And Tools

`message_agent` should respect normal Runner source resolution:

- agent-declared sources
- caller-requested source subset
- workspace activation/auth state
- runtime source usability

For Deep Research, selected tools/sources should pass through to target specialist agents. Computer Use should not be default for research delegation; it can be selected like any other source if the user intentionally enables it.

## Example Uses

Deep Research:

```text
Researcher -> message_agent("market-analyst", "Compare these five sources and return contradictions as JSON.")
```

Workflow:

```text
Weekly report step -> message_agent("data-analyst", "Summarize this metrics table. Return risks, wins, and anomalies.")
```

Orchestrator:

```text
Orchestrator -> message_agent("api-agent", "Review this planned endpoint contract before implementation.")
```

Reviewer:

```text
Coder -> message_agent("code-reviewer", "Review these files for behavioral bugs only.")
```

## Success Criteria

- Delegation uses real sessions.
- Receipts are inspectable.
- Workflow/deep-research traces show child calls.
- Missing capabilities fail before execution.
- Parent permission mode cannot be bypassed.
- Output schema failures are visible and recoverable.
- No unbounded agent loops.

## Product Decisions

- `message_agent` is available to every normal tool-capable agent through the native session tool registry.
- It is not a separate global skill. The central system prompt and tool description teach agents when to use it.
- Child sessions are hidden by default like workflow step sessions.
- Parent-to-child attachments are out of MVP; pass compact context and file paths instead.
- Child outputs can become first-class output bundles in a later artifact integration pass.
