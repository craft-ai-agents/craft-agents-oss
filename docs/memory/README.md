# Memory — Spec & Plan

A per-agent persistent memory layer so agents stop re-asking the same questions, remember user preferences, and compound in usefulness over time.

## Why this exists

Today every Concierge chat starts cold. Every agent re-asks "what's your name / what are you working on / what voice do you use?" The product feels less like an OS and more like a string of disposable conversations. Memory closes that loop.

## Why file-based, not a vector DB or graph

Considered: Pinecone, Weaviate, Chroma, Mem0, Letta/MemGPT, Zep, Cognee, MCP memory servers, ChatGPT-style implicit memory.

For a **local-first, single-user, file-aesthetic** agent OS, the right answer is markdown:

| Approach | Why we're not picking it |
|---|---|
| Vector DB only (Mem0, Pinecone, etc.) | Opaque blobs. User can't read or edit memory. Wrong for "the file IS the source of truth." |
| Graph memory (Zep, Cognee, Letta) | Right shape for CRMs / research corpora. Wrong shape for personal-OS scale. |
| Implicit LLM-managed (ChatGPT memory) | Silent drift. Hallucinated recall. No user inspection. Trust collapses. |
| Cloud SaaS memory | Wrong philosophy for local-first. |
| MCP memory servers | Just shifts the storage decision. Still markdown OR vector underneath. |

**Markdown wins here because:**
1. **Inspectable** — `cat ~/.agents/agents/concierge/MEMORY.md` shows exactly what's remembered.
2. **Editable** — user can correct memory by hand.
3. **Versionable** — git the `.agents/` directory and memory has history.
4. **Forkable** — a great agent's memory is a great template.
5. **Composes with existing infra** — same parser, same compose-prompt pipeline as `AGENT.md` / `SKILL.md` / `CONTEXT.md` / `WORKFLOW.md`.

This is the auto-memory pattern Claude Code itself uses. Battle-tested at scale.

## Scope (Phase 1)

**In:**
- Per-agent `MEMORY.md` at `~/.agents/agents/<slug>/MEMORY.md`
- One shared `~/.agents/USER.md` (cross-agent user profile)
- Four memory types: `user`, `feedback`, `project`, `reference`
- Auto-injection into the agent's system prompt (between Workspace Context and the bundle footer)
- Three session-tools: `save_memory`, `forget_memory`, `update_memory`
- Basic "Memory" tab on the agent detail page (list, add/edit, forget)
- Basic "Memory & Profile" dialog for `USER.md`

**Deferred to Phase 1.5:**
- Cross-session summary log at `~/.agents/agents/<slug>/SESSIONS.md` ([details](./05-sessions-log.md))
- Recent activity hint from `SESSIONS.md`
- Memory-specific inline tool-call chips
- Filter chips and other list polish

**Deferred to Tier 2 (when we hit ~200 entries / 25k tokens per agent):**
- `sqlite-vec` semantic recall via a `recall_memory(query)` tool
- Memory deduplication / merge-on-conflict heuristics

**Hard non-goals:**
- Graph extraction
- Cloud sync
- Cross-user shared memory
- Broad implicit summarization. The shipped auto path is intentionally narrow: safe new agent-scoped memories only, with `Review` and `Manual` modes available.

## How these docs are organized

| Doc | What you get |
|---|---|
| [`01-spec.md`](./01-spec.md) | `MEMORY.md` and `USER.md` file format — frontmatter schema, types, validation rules, examples. |
| [`02-runtime.md`](./02-runtime.md) | Read/write flow: how memory gets injected into prompts, the three session-tools, registry wiring. |
| [`03-ux.md`](./03-ux.md) | UI: Memory tab on agent detail, USER.md editor, optional Concierge "review my memory" affordance. |
| [`04-implementation-plan.md`](./04-implementation-plan.md) | Phased build plan. Phase 1 ships in ~1 week. |
| [`05-sessions-log.md`](./05-sessions-log.md) | Cross-session summary log — the sibling feature that lets agents recall "what did we work on yesterday?" |
| [`06-memory-os-spec.md`](./06-memory-os-spec.md) | North-star Memory OS spec: auto-memory sidecar, local recall index, Obsidian vault, relationship graph, consolidation, and comparisons to Agno/Hermes/OpenHuman/Karpathy-style systems. |

## North-star demo

> Open Concierge cold tomorrow morning. It says: "Welcome back. You shipped workflows phase 2 yesterday and were planning to dogfood for a week. Want to start a session reviewing what's rough so far, or jump back to the memory layer build?" — drawn entirely from MEMORY.md and SESSIONS.md, no live LLM hallucination involved.

If that demo works after Phase 1 ships, this feature is done.
