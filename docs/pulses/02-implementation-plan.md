# Pulse implementation plan

A fresh agent should be able to ship Phase 1 from this doc + [`README.md`](./README.md) + [`01-spec.md`](./01-spec.md) without re-deciding anything.

`bun` is at `~/.bun/bin/bun` (not on PATH).

---

## Phase 0 — 30-minute prototype (do this first)

**Before writing any code**, validate the premise:

1. Pick one goal you genuinely have. Write it as a Workspace Context doc with `name: "..."`, `description: "..."`, `agents: all`, `enabled: true`, body describing the goal in 2-3 sentences. Don't bother with the new schema fields yet.
2. Open the Automations editor. Create a `SchedulerTick` automation with cron `0 * * * *` (every hour) and a `prompt` action targeting the Orchestrator with this prompt:

   > It is $CRAFT_LOCAL_TIME. Look at all workspace context docs (especially anything that looks like a goal) and the most recent outputs and sessions. Decide ONE of: (a) "nothing — quiet hour", (b) "notify the user with this short message: ...", (c) "kick the workflow named X with these inputs: ...". Default to (a). Be quiet. Reply with one of the three formats — no extra prose.

3. Run for 1 week.

**What you'll learn:**

- If 95% of ticks decide "nothing" and the rare alerts are useful → invest in the supporting primitives (Phase 1).
- If it spams or stays silent forever → you'll know which primitive is missing first. Probably goals.
- If you forget to look at the spawned sessions → notifications surface is the priority.

If after a week the prototype demonstrates real value, proceed to Phase 1. If not, kill the feature.

---

## Phase 1 — Production Pulses (~5-7 days)

### Scope

✅ In:
- Workspace Context schema extension: optional `status` / `priority` / `deadline` fields on the existing `ContextDocMetadata` shape.
- New automation action type `pulse` with validation in `create_automation` + the runtime executor.
- Tick log persistence (`pulses/<pulseId>/ticks.jsonl`).
- Bounded world snapshot assembly with the size guards from the spec.
- Forced `outputSchema` on the driver turn (reuse workflow runner's `appendOutputSchemaInstruction`).
- Decision dispatch: `do_nothing` (log only), `notify_user` (bell + Concierge), `kick_workflow` (spawn via existing runner), `ask_user` (bell with input).
- Notification surface: bell icon + atom + RPC channel + Concierge chat system-message component.
- Anti-spam gate: 3-consecutive-same-goal silence rule.
- Pulses tab/filter on the Automations list page; Pulse detail shows last 50 tick decisions.
- One starter Pulse seeded **disabled by default**: "Daily check-in" template (cron `0 9 * * 1-5`).

❌ Out (deferred):
- Goal hierarchy / sub-goals.
- Multi-Pulse coordination (Pulse A waits on Pulse B).
- Self-modifying Pulses.
- Per-tick cost dashboards.
- Outbound messaging-channel notifications (Phase 1.5).

### Files to add

```
packages/shared/src/pulses/
  types.ts          # PulseAction, PulseDecision, TickEntry, snapshot types
  storage.ts        # tick log read/append (atomic JSONL)
  snapshot.ts       # world-snapshot assembly with size guards
  index.ts

packages/server-core/src/pulses/
  PulseExecutor.ts  # the action runtime: assemble snapshot, run driver, dispatch decision
```

### Files to modify

```
packages/shared/src/workspace-context/types.ts          # add status/priority/deadline to ContextDocMetadata
packages/shared/src/workspace-context/storage.ts        # parse + serialize the new fields, validate when status set
packages/shared/src/automations/types.ts                # add 'pulse' to action union, define PulseAction
packages/shared/src/automations/schemas.ts              # zod schema for the new action variant
packages/shared/src/automations/utils.ts                # wire pulse action through the executor switch
packages/server-core/src/sessions/SessionManager.ts     # register PulseExecutor as the action handler
packages/session-tools-core/src/handlers/create-automation.ts  # validation branch for action.type === 'pulse'
packages/shared/src/protocol/channels.ts                # add notifications.* + pulses.* channels
packages/shared/src/protocol/events.ts                  # add notifications.UPDATED, pulses.TICK events
apps/electron/src/transport/channel-map.ts              # bridge methods for notifications + pulses
apps/electron/src/shared/types.ts                       # DTO re-exports + ElectronAPI extensions
apps/electron/src/renderer/atoms/notifications.ts       # NEW — atom for bell state
apps/electron/src/renderer/hooks/useNotifications.ts    # NEW
apps/electron/src/renderer/components/notifications/BellMenu.tsx  # NEW
apps/electron/src/renderer/pages/AutomationsListPage.tsx  # add "Pulses" filter chip
apps/electron/src/renderer/pages/AutomationDetailPage.tsx # render TickHistoryPanel when action.type === 'pulse'
apps/electron/src/renderer/components/pulses/TickHistoryPanel.tsx  # NEW — tail of ticks.jsonl rendered
apps/electron/src/renderer/pages/WorkspaceContextPage.tsx # add "Goals only" filter + extend edit dialog
```

### Build order

1. **Schema extension first.** Add the three goal fields to `ContextDocMetadata` + parser/serializer. Update existing tests so they don't break. Add 3 new tests: doc without status (still valid, not a goal), doc with status only (valid goal with default priority), doc with all three fields. **Stop and run typecheck + tests before moving on.**

2. **Pulse types + tick storage.** `packages/shared/src/pulses/{types,storage}.ts`. Atomic append for JSONL — mirror the memory module's `writeFileAtomic` pattern. Read helper that tails N entries. Tests for both.

3. **World snapshot.** `packages/shared/src/pulses/snapshot.ts`. Pure function: `(workspaceRoot, pulseConfig, lastTickAt) => SnapshotText`. Implements the size guards from the spec. Tests for: snapshot with no goals (returns minimal context); snapshot with diff truncation; snapshot exceeding budget (verify truncation).

4. **PulseExecutor.** `packages/server-core/src/pulses/PulseExecutor.ts`. Wires snapshot → driver session → outputSchema decision → dispatch. Use the workflow runner's `appendOutputSchemaInstruction` + `parseStructuredStepOutput` helpers as templates.

5. **Automation integration.** Extend the action union, add validation branch in `create_automation`, register the executor in SessionManager. Make sure the existing `prompt` and `webhook` actions still work — add a regression test.

6. **Notifications RPC + UI.** Notifications atom, hook, bell menu, system-message component for Concierge chat. Anti-spam dedupe at the bell level (don't re-show identical messages within 1 hour).

7. **Pulses UI on Automations.** Filter chip, tick history panel on detail page. Reuse the existing automation list/detail components — don't fork.

8. **Starter Pulse seed.** "Daily check-in" template with cron `0 9 * * 1-5`, disabled by default. User flips it on once they've authored at least one goal.

9. **Verify.** All 4 packages typecheck. Existing 198+ tests still pass. New tests pass.

### Tests

- Workspace-context: 3 new (goal field validation).
- Pulses storage: tick log atomic-append + tail.
- Pulses snapshot: budget guards.
- PulseExecutor: happy path (do_nothing), notify_user dispatch, kick_workflow dispatch, anti-spam silencing after 3 consecutive notifies.
- create_automation: pulse-type validation (good config + bad configs).

Roughly 12-15 new tests.

### Hard rules during implementation

- **Mirror existing patterns.** Workspace Context for storage + UI shape. Workflow runner for outputSchema enforcement. Memory module for atomic writes. Don't reinvent.
- **No new top-level nav.** Pulses live as a tab/filter on Automations.
- **Goals are NOT a new noun.** They're context docs with extended frontmatter. If you find yourself building a `Goal` storage module, stop — you've drifted.
- **Driver runs in `safe` mode.** The Pulse turn never writes the filesystem except via tick log append. Workflows are what act.
- **Default decision is `do_nothing`.** Bake this into the system prompt and verify in tests by counting decisions over a fake tick stream.
- **Hard token budget.** 3000 input + 1000 output. Truncate, don't overflow.
- **i18n** every user-facing string in the new UI. Bell menu, Pulses filter chip, tick-row labels — all through `t()`.

### Success criteria

- A user can: tag an existing context doc as a goal (set status), set up a Pulse pointing at it, watch ticks happen on schedule, see the tick log update, click an in-bell notification when one fires, kick off the suggested workflow with one click.
- Typecheck clean across `packages/shared`, `packages/server-core`, `packages/session-tools-core`, `apps/electron`.
- 198 existing tests still pass; 12-15 new tests pass.
- North-star demo from `README.md` works end-to-end with the seeded "Daily check-in" template.

---

## Phase 1.5 — Polish (~2-3 days, optional)

- Outbound messaging channel notifications (`notify.messagingChannel`).
- "Mute this goal in this Pulse for the next N hours" affordance from the bell menu.
- A `recent_decisions` filter on the Pulse detail page (decision type, time range).
- One-click "Try this Pulse template" in the Pulses tab — pre-fills cron + driver + suggested goal binding.

---

## Phase 2 — When real usage demands more (open-ended)

Things to build only if observed need:
- Multi-Pulse coordination (a "morning Pulse" produces a digest that an "afternoon Pulse" consumes)
- Goal hierarchy
- Self-evaluation: at end of week, the Pulse reviews its own tick log and proposes prompt edits to itself
- Cost dashboards per Pulse

Don't pre-build. Wait for the user to say "I wish my Pulses could X."

---

## Risks & open questions

| Risk | Mitigation |
|---|---|
| Pulses become noisy and the user mutes them all. | Anti-spam gate (3-same-goal-silence-6-ticks); silent-by-default system prompt; default-disabled starter template. |
| Snapshot exceeds token budget. | Hard truncation + warning logged so user sees they have too many goals or too much activity. |
| Driver hallucinates a workflow slug that doesn't exist. | Validate the slug at dispatch time; on miss, log and convert to `notify_user` with the original `why`. |
| User changes a goal mid-tick. | Snapshot is taken at tick start; the in-flight tick uses the snapshot. Next tick sees the updated goal. |
| Two Pulses fire on overlapping cadence and stomp each other's notifications. | Bell dedupes by `(message + goalSlug)` within a 1h window. |

## Done definition

When Phase 1 ships, a user can:

1. Mark an existing Workspace Context doc as a goal by setting `status: active`.
2. Set up a Pulse via the Automations editor (action type: pulse).
3. Watch ticks happen at the scheduled cadence; verify the log shows mostly `do_nothing` decisions.
4. Receive a useful in-bell notification when the Pulse decides to act.
5. Click through to either acknowledge, reject, or kick off a suggested workflow.
6. Disable or mute the Pulse from the same UI.

When that flow runs without breakage for a real goal over 7 days, this feature is done.
