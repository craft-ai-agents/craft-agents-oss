# Memory file format — `MEMORY.md` and `USER.md`

Same YAML+markdown idiom as `AGENT.md`, `SKILL.md`, `CONTEXT.md`, `WORKFLOW.md`. Two files in play:

- `~/.agents/agents/<slug>/MEMORY.md` — per-agent memory
- `~/.agents/USER.md` — cross-agent user profile (broadcast to every agent)

## File shape

The frontmatter is a single tiny envelope; the body is a flat list of memory entries, each with its own mini-frontmatter delimited by `---`.

### `MEMORY.md` example

```markdown
---
agent: researcher
version: 1
---

---
name: prefers primary sources
type: feedback
created: 2026-04-22
---

User wants every claim cited; treats secondary aggregators (Wikipedia,
content-marketing summaries) as suggestive only. Reason: got burned in
March by a hallucinated stat that traced to a SEO listicle.

How to apply: when researching, always trace claims back to a primary
source and cite it. If only secondary is available, flag the uncertainty
explicitly.

---
name: TLDR-then-detail format
type: feedback
created: 2026-04-25
---

User skims. Always lead with a 2-sentence TLDR, then expand. If the
TLDR is the answer, stop there.

---
name: ongoing project — RunnerOS workflows phase 2
type: project
created: 2026-05-01
---

Workflows Phase 2 (outputSchema, retries, completion contracts) shipped
2026-05-01. User is dogfooding before starting Phase 3 (when:,
humanCheckpoint).

How to apply: when researching topics user mentions, prefer angles
that compound on what's just shipped (e.g., reliability patterns,
human-in-the-loop UX) rather than topics that suggest restarting.
```

### `USER.md` example

```markdown
---
version: 1
---

---
name: identity
type: user
created: 2026-04-15
---

Mikey, principal engineer pivoting to product. Building RunnerOS,
a local-first personal agent OS forked from craft-agents-oss.

---
name: collaboration style
type: user
created: 2026-04-15
---

Direct, terse, no corporate hedging. Reads diffs — doesn't need
trailing summaries. Strongly prefers "honest, not nice" reviews.
Calls out bias and ego on purpose to stress-test reasoning.
```

## Frontmatter — file envelope

The top-level frontmatter is intentionally minimal:

| Field | Required | Notes |
|---|---|---|
| `agent` | yes (MEMORY.md only) | The agent slug this memory belongs to. Must match the directory name. Validation reject on mismatch. |
| `version` | yes | Schema version. Always `1` for Phase 1. |

`USER.md` omits `agent`. Otherwise identical.

## Frontmatter — per-entry

Each entry inside the body has its own mini-frontmatter:

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Short title (under ~80 chars). Used as the entry ID for `update_memory` / `forget_memory`. Must be unique within the file. |
| `type` | yes | One of: `user`, `feedback`, `project`, `reference`. See taxonomy below. |
| `created` | yes | ISO date (YYYY-MM-DD) when this entry was first written. Auto-set by the tool. |
| `updated` | no | ISO date of the last modification. Auto-set by `update_memory`. |
| `expires` | no | ISO date after which the entry is filtered out at injection time. Useful for time-bound project facts. |

The body of each entry is free-form markdown — typically 1-4 sentences. Encourage the agent to include a `**Why:**` and `**How to apply:**` line for `feedback` and `project` types so future-self can judge when the entry still applies.

## The four memory types

Battle-tested taxonomy from Claude Code's auto-memory system. Each type has a clear purpose and read-time use:

| Type | What it captures | When agent writes it | How agent uses it |
|---|---|---|---|
| `user` | Identity, role, expertise, durable preferences. | When user reveals something stable about themselves. | Tailor explanations to their level/context. |
| `feedback` | Corrections + validations. | When user corrects ("don't do X") OR confirms an unusual approach worked. | Avoid past mistakes; replicate validated approaches. |
| `project` | Ongoing work state, decisions, deadlines. | When project facts come up that won't be in code/git. | Inform suggestions with current context, not stale assumptions. |
| `reference` | Pointers to external systems (Linear, Slack, Grafana). | When user says "we track X in Y." | Know where to look beyond local files. |

Avoid writing memory entries that are:
- Already in code/git (deducible by reading)
- Ephemeral conversation context (write to session, not memory)
- Negative judgments about the user (mood, frustration)
- Project debugging recipes (the fix is in the commit)

## Validation rules

A `MEMORY.md` is invalid (and the loader skips it with a warning) if:
- Top-level frontmatter is missing or malformed
- `agent` doesn't match the parent directory name
- `version` is not `1`
- An entry is missing `name`, `type`, or `created`
- An entry's `type` is not one of the four canonical values
- Two entries share the same `name`

Bad entries individually are skipped (not the whole file). The runtime logs a warning so the user can fix the file.

## File size budgets

Per agent, soft limits:

| Limit | Action |
|---|---|
| < 50 entries / ~5k tokens | Healthy. No action. |
| 50-200 entries / 5-25k tokens | Inject all on session start. UI shows a token-count badge (same pattern as Workspace Context). |
| > 200 entries / > 25k tokens | Inject the most recent 50 + add a `recall_memory` session-tool that does file-scan retrieval. Tier 2 milestone — adds `sqlite-vec` for semantic search. |

Phase 1 only handles the first two ranges. The third triggers a Tier 2 design doc when we get there.

## Slug rules

Inherited from agent slugs (`AGENT_SLUG_REGEX`). The `<slug>` in `~/.agents/agents/<slug>/MEMORY.md` always matches the agent's slug 1:1. No separate validation needed.

## Round-trip guarantee

Same as every other markdown+frontmatter file in this product: edits preserve structure, the parser → mutator → serializer round-trips identically. A user editing `MEMORY.md` by hand and saving must produce the same file the tool produces from the equivalent edits. `git diff` is meaningful.

## What goes in `USER.md` vs `MEMORY.md`?

Cross-agent → `USER.md`. Agent-specific → that agent's `MEMORY.md`.

Examples:
- "User's name is Mikey" → `USER.md`
- "Researcher should always cite primary sources" → `agents/researcher/MEMORY.md`
- "User's working hours are 9-5 ET" → `USER.md`
- "When asking Critic for feedback, user wants it harsher than nice" → `agents/critic/MEMORY.md`

Concierge specifically should bias toward writing to `USER.md` (its job is omniscient routing — facts it learns are usually cross-agent useful). Other agents should bias toward their own `MEMORY.md`.

## Tombstones

When the user manually deletes a memory entry through the UI, write a `.deleted-memories.json` tombstone alongside `MEMORY.md` so the agent doesn't immediately re-save the same entry next session. Mirror the agent-definitions `.deleted-agents.json` pattern.
