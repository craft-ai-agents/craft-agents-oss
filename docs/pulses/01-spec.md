# Pulse — file format, action type, and runtime contract

Read [`README.md`](./README.md) first.

## TL;DR

- A **Pulse** = an automation with `eventName: 'SchedulerTick'` and `action.type: 'pulse'`.
- The `pulse` action runs an Orchestrator turn against a structured world snapshot and forces a JSON decision (do_nothing / notify_user / kick_workflow).
- Goals are **regular Workspace Context docs** with optional `status` / `priority` / `deadline` frontmatter fields. No new module.
- Tick history persists as `pulses/<pulseId>/ticks.jsonl` per workspace.

## 1. Goals piggyback on Workspace Context

Today a Workspace Context doc has frontmatter like:

```yaml
---
name: Voice & Style
description: How the user wants prose to sound
agents: [writer, critic]
enabled: true
---
```

**Add three optional fields** to the existing schema. When any of them is set, the doc IS a goal:

```yaml
---
name: Launch RunnerOS publicly
description: Ship the public release of the local-first agent OS
agents: all
enabled: true

# NEW — turn this context doc into a Goal
status: active        # active | blocked | paused | done
priority: high        # low | normal | high
deadline: 2026-05-31  # optional ISO date
---
```

Why piggyback: goals ARE durable workspace knowledge that agents read. Every other shape we'd consider (a separate noun, a new file format) is duplication. The trade is one flag (`status`) gates a doc as goal-eligible — no new parser, no new RPC, no new atom, no new edit dialog beyond the few extra fields.

### UI implication

The existing Workspace Context page gets one filter chip: **"Goals only"** that filters to docs where `status` is set. The edit dialog gets the three new fields as a collapsible "Track as goal" section. That's it.

The Pulse runtime queries `loadAllContextDocs(workspace).filter(d => d.metadata.status)` to get the goal list — no new query path.

### Validation

When `status` is set:
- Must be one of `active | blocked | paused | done`
- `priority` (if set) must be one of `low | normal | high`
- `deadline` (if set) must be a valid ISO date

When `status` is unset, the other fields are ignored at runtime.

## 2. The `pulse` automation action

Today the automation system supports two action types: `prompt` and `webhook`. Add a third:

```ts
type PulseAction = {
  type: 'pulse';
  /** Slug of the agent that drives the pulse. Defaults to 'orchestrator'. */
  driverAgentSlug?: string;
  /** Goal slugs to consider. If omitted, all goals with status: active. */
  goalSlugs?: string[];
  /** How far back to look for "recent activity" diff. Default: matches schedule cadence. */
  diffWindowMinutes?: number;
  /** Where notify_user actions land. */
  notify?: {
    bell?: boolean;        // default true
    conciergeChat?: boolean; // default true
    messagingChannel?: string; // optional bound channel slug
    minUrgencyForChannel?: 'low' | 'normal' | 'high'; // gate outbound
  };
};
```

The action validates at create time (driver agent exists, goal slugs resolve, channel slug is bound, etc.). Reuses `create_automation`'s validation path with a new branch for `type: 'pulse'`.

## 3. The decision shape (forced JSON)

Every tick MUST return one of these four shapes. Use the existing `outputSchema` plumbing to enforce JSON output via the workflow runner's pattern:

```ts
type PulseDecision =
  | { action: 'do_nothing'; reason: string }
  | { action: 'notify_user'; message: string; urgency: 'low' | 'normal' | 'high'; goalSlug?: string }
  | { action: 'kick_workflow'; workflowSlug: string; inputs?: Record<string, unknown>; why: string; goalSlug?: string }
  | { action: 'ask_user'; question: string; goalSlug?: string };
```

`do_nothing` is the default and the most common — encode this in the system prompt.

## 4. The world snapshot (what the Orchestrator parses each tick)

The runtime assembles a **bounded** snapshot before invoking the driver. Hard size cap to keep token budget sane.

### Inputs (in injection order)

1. **Active goals** — all docs from `loadAllContextDocs` where `status: active`. If `goalSlugs` is set on the action, filter to those. Render with name, description, status, priority, deadline (if set), and a 200-char body excerpt.

2. **Diff since last tick** — events that fired in the workspace since `lastTickAt`. Specifically:
   - Output manifests created (count + list of titles, max 20)
   - Sessions completed (count + list of names, max 20)
   - Automations fired (count + list of slugs)
   - Memory writes (count only)

   Each summarized as one or two lines, never the raw firehose.

3. **Time context** — current local time, day of week, working-hours flag (compared to user preference if set, else 9am-6pm default).

4. **Last 5 tick decisions** — read from `ticks.jsonl`, tail 5, render each as one line: `2026-05-01T09:00 do_nothing: quiet morning, no goal movement.`

5. **USER.md + Orchestrator's own MEMORY.md** — auto-injected by the existing prompt-composition pipeline (no new code).

6. **Pulse instruction footer** — appended to the prompt:

   > You are running as a Pulse decision. Default to `do_nothing`.
   > Only choose `notify_user` if a fact has changed that the user would
   > genuinely benefit from knowing within the next hour.
   > Only choose `kick_workflow` if a goal is stalled AND a workflow exists
   > that would clearly advance it.
   > Only choose `ask_user` if a goal is blocked on a question only the
   > user can answer AND you haven't asked the same question in the last
   > 5 ticks (check the recent decisions log above).
   > Be quiet. The user trusts silence.

### Hard token budget

Snapshot total ≤ **3000 tokens**. If goals + diff exceed that:
- Truncate diff first (drop oldest events).
- Truncate goal bodies to 100 chars each.
- Truncate tick log to last 3 entries.

Log a warning if truncation kicks in — that's a signal the user has too many active goals or too much activity for the cadence.

## 5. Tick log

```
<workspaceRoot>/pulses/<pulseId>/ticks.jsonl
```

Append-only. Each line is JSON:

```ts
{
  pulseId: string;
  tickedAt: string;        // ISO
  durationMs: number;
  decision: PulseDecision;
  driverSessionId: string; // session that ran the Orchestrator turn
  diffSummary: { outputs: number; sessions: number; automations: number; memoryWrites: number };
  truncated?: boolean;
}
```

Read helpers:
- `readPulseTicks(workspace, pulseId, limit)` — tail N entries
- `appendPulseTick(workspace, pulseId, entry)` — atomic append using existing atomic-write pattern

No DB needed. JSONL keeps it git-able and human-readable. Pulses don't generate enough volume to need anything heavier.

## 6. Notification routing

When the decision is `notify_user`:

| Surface | When |
|---|---|
| **Bell icon** (always on if `notify.bell !== false`) | Every notification. Stays in the bell until acknowledged. |
| **Concierge chat as system message** (default on) | Renders inline in the Concierge chat as `🟦 Pulse: <message>` with a click-to-act button if the message references a goal or workflow. |
| **Bound messaging channel** (opt-in via `notify.messagingChannel`) | Only when `urgency >= notify.minUrgencyForChannel`. Default gate: `normal`. Prevents low-urgency stuff from buzzing the user's phone. |

Notifications need a small new RPC channel + atom + bell-icon component. ~150 LOC total. This is the biggest net-new UI piece.

When the decision is `kick_workflow`:
- Spawn the workflow via existing `runner.start()` with the supplied inputs.
- Append a tick entry with the resulting `runId` so the user can click through.
- Notify the user about the kicked-off workflow at urgency `low` (default behavior).

When the decision is `ask_user`:
- Same as `notify_user` but the bell entry has a chat-input affordance.
- The user's reply gets routed back to the Pulse runtime for the next tick to consume (via memory write to Orchestrator's MEMORY.md or a dedicated `pending_questions.jsonl`).

## 7. Frequency / cost guardrails

Hard runtime constraints to prevent runaway cost:

- Minimum cadence: every 10 minutes (cron `*/10 * * * *` is the floor).
- Maximum 4 active Pulses per workspace by default. Configurable via workspace settings, with a warning past 4.
- Per-tick token budget: 3000 input + 1000 output = 4000 tokens. Use the existing model to power the Orchestrator (no special cheap model gating in Phase 1).
- If three consecutive ticks decide `notify_user` with the same `goalSlug` and the user hasn't acknowledged, the Pulse silences itself for that goal for the next 6 ticks (anti-spam guard).

## 8. Permission

The `pulse` action runs the driver in `safe` mode by default — read-only context access, no file writes, no source side-effects. The Pulse can choose `kick_workflow` (which spawns a workflow that has its own permission mode) but the Pulse turn itself never writes anything except its tick log entry.

This is intentional: a Pulse decides; it doesn't *act* with the user's permissions. Workflows act.

## 9. Backward compat

- Existing automations: zero impact. The new action type is additive.
- Existing Workspace Context docs: zero impact. The new fields are optional; missing fields → not a goal.
- The validator must still accept docs without the goal fields. Don't tighten the existing schema.
