# Cross-session summary log — `SESSIONS.md`

The sibling feature that makes "what did we work on yesterday?" actually answerable. Different from `MEMORY.md` (durable facts) — this is a chronological log of conversation summaries.

## Why it's separate from MEMORY.md

| | MEMORY.md | SESSIONS.md |
|---|---|---|
| Shape | Flat list of durable facts | Chronological log of conversation summaries |
| Write trigger | Explicit `save_memory` tool call mid-conversation | Auto-generated when a session compacts or ends |
| Read pattern | Auto-injected into every system prompt | Read on demand via tool or "Recent activity" surface |
| Lifecycle | Survives indefinitely until forgotten | Append-only log; old entries can be archived |
| Volume | ~50-200 entries per agent | One entry per session, can be hundreds over months |

Mixing them would force one of two bad outcomes: (a) inject session summaries into every prompt and bloat context, or (b) skip injection on durable facts and lose the recall benefit. Separate stores → both work.

## File location

```
~/.agents/agents/<slug>/SESSIONS.md
```

Per-agent. No cross-agent equivalent — each agent has its own work history.

## Format

Same YAML+markdown idiom. One entry per session, in reverse chronological order (newest first).

```markdown
---
agent: concierge
version: 1
---

---
sessionId: abc123def
date: 2026-05-01
duration: 1h 47m
turnCount: 18
summary: Discussed memory architecture — settled on file-based markdown + per-entry frontmatter, deferred sqlite-vec to Tier 2. Wrote spec docs at docs/memory/.
outcome: spec-only
topics: [memory, architecture, file-format]
nextAction: Dogfood current build for a week, then implement Phase 1.
---

---
sessionId: 9bc442e1
date: 2026-04-30
duration: 4h 12m
turnCount: 47
summary: Implemented Workflows Phase 2 — outputSchema, retries, timeout, completion contracts, launch receipts. Reviewed by rival agent; landed all P0/P1 fixes.
outcome: shipped
topics: [workflows, reliability, completion-contracts]
nextAction: Workflow-creator skill, then dogfood.
---
```

## Frontmatter — per-entry

| Field | Required | Notes |
|---|---|---|
| `sessionId` | yes | Maps back to the original session in `~/.craft-agent/workspaces/<id>/sessions/<sessionId>/`. Click-through link in UI. |
| `date` | yes | ISO date. |
| `duration` | no | Human-readable elapsed wall clock. |
| `turnCount` | no | Number of user/assistant exchanges. |
| `summary` | yes | 1-3 sentence prose summary of what happened. |
| `outcome` | no | Free-form short tag: `shipped`, `spec-only`, `blocked`, `abandoned`, `decided`, etc. |
| `topics` | no | Array of lowercase tags (matches agent capability `tags` style). |
| `nextAction` | no | One-sentence what-to-do-next, drawn from how the session ended. |

## When entries get written

Auto-generated, no explicit tool call required. Three triggers:

1. **Session ends** (user closes the session OR session reaches a natural completion). Generate a summary via the existing `generateConversationSummary` helper in `packages/shared/src/agent` (already exists per `CLAUDE.md`). Append to `SESSIONS.md`.

2. **Session compacts** (existing compaction flow). The compaction already produces a summary message; capture it as a `SESSIONS.md` entry too.

3. **Manual** — a "Save session summary" affordance in the right pane of the chat for sessions the user wants to preserve regardless of length.

## How agents use it

Three read paths:

### 1. Auto-injected "recent activity" (top of system prompt, optional)

If `SESSIONS.md` exists, inject just the **most recent 3 entries' summaries** into the system prompt. Keeps context tight while giving the agent a sense of recent work.

```
## Recent sessions

- 2026-05-01 (1h 47m): Discussed memory architecture — settled on file-based...
- 2026-04-30 (4h 12m): Implemented Workflows Phase 2...
- 2026-04-29 (2h 30m): Built workflows phase 1...
```

This is the difference between "Concierge is forgetful" and "Concierge knows where we left off."

### 2. Explicit recall via tool

A `recall_session(query?, limit?)` session-tool that returns matching entries:
- No query → return latest N entries
- With query → simple substring match against summary + topics (Tier 1; sqlite-vec at Tier 2)

Tool description teaches: "Use when the user references prior work ('what did we decide about X', 'continue from yesterday'). Don't use for facts about the user — those live in MEMORY.md."

### 3. UI surface

A "Past" tab on the agent's detail page lists every entry chronologically with click-through to the session viewer. Mirrors the existing "Past" entry under Agents in the sidebar — but scoped to one agent's work.

## When entries get archived

Soft cap at 500 entries per agent. Beyond that, oldest entries get moved to `~/.agents/agents/<slug>/SESSIONS-archive/<year>.md` and removed from the live `SESSIONS.md`. Same UI surfaces them under "Older" with a year-range filter. Archival happens lazily on write, not on a cron.

## Implementation notes

- **Generation cost**: every session that compacts or ends triggers an LLM call to generate the summary. Reuse the existing `generateConversationSummary` plumbing — it already runs for compaction.
- **Atomic write**: same `.tmp` + rename pattern.
- **Format round-trip**: same as MEMORY.md — user can edit by hand and save.
- **Privacy**: `summary` is verbatim a model's interpretation of what was said. Don't render it back to the model in places where the original session is unavailable (e.g., "Tell the user about session abc — what was it about?" — fetch the original transcript, not the summary).

## When to ship this

Phase 1 ships memory only. `SESSIONS.md` is a Phase 1.5 add-on, ~3 days of work:

1. Hook into the existing `generateConversationSummary` lifecycle.
2. Append to `SESSIONS.md`.
3. Auto-inject the most recent 3 summaries into system prompts.
4. Add the `recall_session` session-tool.
5. Add the "Past" tab to the agent detail page.

Could ship same week as memory if you have time. Independent of memory infra otherwise.

## Hard non-goals

- **No write-on-every-turn.** Summaries are session-level, not turn-level.
- **No semantic search at Phase 1.5.** Substring match is fine. sqlite-vec when both `MEMORY.md` and `SESSIONS.md` need it together.
- **No cross-agent timeline.** Each agent has its own log. The Concierge sees its own sessions, not Researcher's. (USER.md is the cross-agent layer.)
- **No automated topic clustering.** Topics are written by the summary generator; no post-hoc reorganization.
