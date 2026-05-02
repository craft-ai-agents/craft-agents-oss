# Pulses — Spec & Plan

A scheduled "thinking heartbeat" that wakes up at a chosen cadence, looks at the workspace, and **decides whether anything is worth doing right now.** 95% of the time the answer is "nothing — go back to sleep." When it does act, it speaks up briefly or kicks off a workflow.

## Why "Pulse"

Considered: Loop, Heartbeat, Watcher, Sentinel, Tender, Sweep, Routine, Patrol, Cadence, Autopilot.

**Pulse** wins because:
- One syllable, evocative — "a pulse on the workspace," "morning pulse"
- Implies regular rhythm + the discipline of *checking* without forcing action
- Plays well as noun and verb: "the Pulse fired at 9am and decided to ping you"
- Doesn't overload terms already used by other agentic frameworks (LangGraph "loops", AutoGen "rounds")

If the user comes up with something better in week 2 of using it, rename. Names are cheap once.

## Why this isn't a separate domain

Per user constraint: **no new nav headers.** Pulses live as a tab inside the existing Automations page.

This is also architecturally honest: a Pulse IS an automation under the hood — it's just an automation whose trigger is `SchedulerTick` and whose action is "let an agent reason about whether to act." The runtime reuses the existing automation matcher + scheduler. The UI surface adds a filter chip "Pulses" + a slightly different detail page that shows tick history instead of a fire log.

## Why this isn't just "an automation that prompts the Orchestrator"

You could prototype a Pulse in 30 minutes today by setting up a hourly `SchedulerTick` automation pointed at the Orchestrator with a "decide whether to act" prompt. **Recommendation: do that prototype first** before reading further (see `02-implementation-plan.md` Phase 0).

The reason a real feature exists on top of that prototype is to handle four predictable failure modes:

1. **No anchor.** Without explicit *goals*, the Orchestrator drifts each tick. One hour it noodles on something irrelevant; next hour it ignores something obvious. Goals are the load-bearing new thing.
2. **No diff feed.** A bare automation gets the *current* world every tick. To reason about *progress* it needs the **delta since last tick** — what's new this hour vs. been there for a week. Otherwise it over-reacts or under-reacts.
3. **Every tick spawns a session.** Hourly = 24 chat sessions/day cluttering the sessions list, 23 of them deciding "nothing." Pulses leave a tiny log entry, not a session, when nothing happened.
4. **No notification surface.** A bare automation's reply lands in the spawned session, which you have to open to see. Pulses route `notify_user` actions to the bell + (optionally) a bound messaging channel.

If the prototype proves value, ship the supporting primitives. If it doesn't, you've saved two weeks.

## Scope (Phase 1)

**In:**
- Lightweight extension to Workspace Context: optional `status` / `priority` / `deadline` frontmatter fields turn a context doc into a **Goal**. No new noun, no new storage module — goals are context docs with extra fields.
- A new automation **action type: `pulse`** with structured-output decision shape (do_nothing / notify_user / kick_workflow).
- Tick log: append-only JSONL per pulse at `<workspace>/pulses/<pulseId>/ticks.jsonl`.
- "Pulses" tab on the Automations list page + per-pulse detail showing the last 50 tick decisions.
- Notification surface: bell icon + Concierge system message + optional outbound to bound messaging channel.
- One starter Pulse seeded **disabled by default** (a "morning check-in" template).

**Out / deferred:**
- Goal hierarchy / sub-goals — flat list only.
- Multi-Pulse coordination (Pulse A waits for Pulse B's decision).
- Self-modifying Pulses (the Pulse rewrites its own prompt).
- Per-tick cost dashboards.
- A separate "Goals" top-level nav. Goals live under Library → Workspace Context with a filter chip.

**Hard non-goals:**
- New top-level nav header.
- Pulses talking to each other directly.
- Real-time streaming of tick reasoning into chat.

## How these docs are organized

| Doc | What you get |
|---|---|
| [`01-spec.md`](./01-spec.md) | File format extensions, the new `pulse` action type, decision schema, context-assembly rules, notification routing. |
| [`02-implementation-plan.md`](./02-implementation-plan.md) | Phased plan starting with a 30-minute prototype, then ~5-7 days for the full feature if the prototype proves value. |

## North-star demo

> Set up a "Daily check-in" Pulse: every weekday at 9am, look at active goals + last 24h of activity. Most days it decides "nothing — quiet day." Wednesday morning it notices the "launch RunnerOS" goal hasn't moved in 5 days, the build is green, and pings you: "Heads-up: launch goal is stalled, build's been green since Monday — want me to spin up the dogfood workflow?" One click → workflow runs. The other 4 days it stays quiet.

If that demo works after Phase 1, the feature is done.
