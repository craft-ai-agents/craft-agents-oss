# RunnerOS Memory OS - North-Star Spec

## Purpose

RunnerOS memory should make agents compound over time without becoming a hidden, untrusted black box.

The product promise:

> RunnerOS remembers what matters, proves why it remembered it, recalls it only when useful, and stores the human-readable truth locally.

This is not "chat history search." It is a local memory operating system for agents, workflows, sources, runs, and workspace knowledge.

## Current baseline

RunnerOS already has the correct trust foundation:

```text
~/.agents/USER.md
~/.agents/agents/<agent-slug>/MEMORY.md
```

Current strengths:
- local-first markdown storage
- human-readable and hand-editable
- per-user and per-agent scopes
- explicit save/update/forget tools
- tombstones for forgotten entries
- prompt rendering treats memory as untrusted quoted reference data

Current limits:
- agents must notice and explicitly save memories
- no post-run memory reviewer
- no semantic recall tool
- no relationship graph
- no durable run-to-memory audit trail
- no Obsidian-style vault for workspace knowledge
- no daily consolidation from runs into cleaner memory
- no UI that explains why a memory was used

## Design principles

1. **Markdown is truth.**
   SQLite, embeddings, and graphs are rebuildable indexes. The durable source is readable files.

2. **Memory is visible.**
   Users can see what was used, what was saved, and why.

3. **Memory is scoped.**
   User facts, agent behavior, workspace knowledge, and run events are different objects.

4. **Memory is not raw logs.**
   Logs are evidence. Memory is the durable distilled lesson or fact.

5. **Automatic capture must be conservative.**
   One suggested mutation per turn/run at first. Prefer update over duplicate save.

6. **Recall must be explainable.**
   Every injected memory should show source, score/reason, and originating run when available.

7. **Subagents do not freely mutate global memory.**
   Background and delegated agents need restricted memory write permissions unless explicitly granted.

## Architecture

```text
Human-readable truth
  USER.md
  agents/<slug>/MEMORY.md
  vault/<workspace>/raw/*.md
  vault/<workspace>/wiki/*.md
  vault/<workspace>/daily/*.md

Derived local indexes
  memory-index.sqlite
    memory_entries
    memory_events
    memory_embeddings
    memory_edges
    recall_events
    consolidation_runs

Runtime services
  MemoryStore
  MemoryIndexService
  RecallService
  MemorySidecarService
  MemoryGraphService
  ConsolidationService

Agent tools
  save_memory
  update_memory
  forget_memory
  recall_memory
  search_knowledge
  explain_memory
```

## Memory layers

### 1. Profile memory

Global user memory shared with every agent.

File:

```text
~/.agents/USER.md
```

Examples:
- communication style
- stable preferences
- role/expertise
- recurring constraints
- trusted external systems

### 2. Agent memory

Per-agent behavior and collaboration history.

File:

```text
~/.agents/agents/<agent-slug>/MEMORY.md
```

Examples:
- "Deep Research should use browser loops before final synthesis"
- "Reviewer should lead with findings, not summary"
- "Marketing agent should avoid generic SaaS copy"

### 3. Workspace knowledge vault

Karpathy/Obsidian-style knowledge for projects and domains.

Default location:

```text
~/RunnerOS/vault/<workspace-slug>/
```

Shape:

```text
raw/
  source captures, transcripts, imported docs, web pages
wiki/
  curated notes, decisions, project maps, linked concepts
daily/
  daily consolidation notes
schema/
  AGENTS.md or MEMORY_RULES.md for vault conventions
```

Rules:
- raw files are append-only evidence
- wiki files are maintained summaries
- wiki files use normal markdown, `[[links]]`, and tags
- source references point back to runs, files, URLs, or source ids
- user can open the folder in Obsidian without plugins

### 4. Run memory

Structured facts from agent execution.

Examples:
- what tools were used
- what failed
- what decision was made
- what approval was granted
- what output was produced
- what memory was recalled

Run memory is not injected directly. It is evidence for sidecar review, trace inspection, and daily consolidation.

### 5. Relationship graph

A derived graph over memories, agents, projects, sources, runs, and vault notes.

Example:

```text
"prefers short answers"
  -> user: michael
  -> agents: concierge, reviewer, deep-researcher
  -> project: RunnerOS
  -> evidence: run_abc123
  -> related: "no long lists", "lead with finding"
```

This is a generated relationship map, not the canonical storage.

## Data model

### Markdown memory entry

Extend the current entry frontmatter carefully:

```yaml
---
name: prefers short answers
type: feedback
created: 2026-05-23
updated: 2026-05-23
expires:
confidence: 0.94
source_run_id: run_abc123
source: sidecar
tags: [communication, style]
links: [RunnerOS, Deep Researcher]
---
```

Body:

```markdown
User prefers short, direct answers. Avoid long lists unless explicitly asked.

How to apply: lead with the answer, include only the few details needed to act.
```

Compatibility rule:
- Existing fields remain valid.
- New fields are optional.
- Loader must ignore unknown fields safely.

### SQLite derived tables

Minimum useful schema:

```text
memory_entries
  id
  scope
  agent_slug
  name
  type
  body
  file_path
  content_hash
  created_at
  updated_at
  expires_at
  confidence

memory_events
  id
  entry_id
  action            save | update | forget | recall | consolidate
  source            user | agent_tool | sidecar | import | consolidation
  run_id
  evidence
  created_at

memory_embeddings
  entry_id
  model
  vector
  content_hash

memory_edges
  id
  from_kind         memory | agent | workspace | source | run | note
  from_id
  to_kind
  to_id
  relation          mentions | supports | contradicts | updates | used_by | derived_from
  confidence
  evidence

recall_events
  id
  run_id
  query
  entry_ids
  reasons
  created_at
```

## Runtime flow

### Before a run

```text
agent/session starts
  -> load USER.md + agent MEMORY.md
  -> if small: inject current memory sections
  -> if large: inject recent/high-priority entries + expose recall_memory
  -> record which memories were injected
```

### During a run

The agent can call:

```text
recall_memory(query)
search_knowledge(query)
save_memory(...)
update_memory(...)
forget_memory(...)
```

Rules:
- `recall_memory` is read-only.
- write tools obey permission mode.
- subagents can read scoped memory but cannot write global memory by default.
- workflow steps can declare required or forbidden memory scopes.

### After a run

```text
run completes
  -> MemorySidecarService receives compact evidence
  -> proposes none/save/update/forget
  -> validates schema and safety rules
  -> applies mutation or queues for review
  -> writes memory event
  -> refreshes local index
```

Sidecar input stays small:
- latest user message
- final assistant answer
- tool/output summary
- selected run trace facts
- existing memory index
- active agent/workspace

Sidecar output:

```json
{
  "decision": "update",
  "scope": "agent",
  "agentSlug": "deep-researcher",
  "name": "browser-loop requirement",
  "type": "feedback",
  "content": "Deep Research should perform browser/tool follow-up loops before synthesis instead of doing one-shot lookup.",
  "confidence": 0.91,
  "evidence": "User said the browser work loop and follow-up search are most important."
}
```

## UI spec

### Top-level Memory page

Once memory becomes graph/index/vault-backed, it deserves a top-level page.

Sections:

1. **Overview**
   - memory health
   - total entries
   - token budget
   - stale/expired entries
   - recent writes
   - index status

2. **Profile**
   - global `USER.md`
   - entries shared with every agent
   - edit/delete/expire

3. **Agents**
   - agent selector
   - per-agent `MEMORY.md`
   - agent-specific behavior notes

4. **Workspace Knowledge**
   - vault picker
   - raw captures
   - curated wiki notes
   - source sync status

5. **Graph**
   - memories, agents, runs, sources, projects, notes
   - click node -> underlying markdown
   - edge reasons and evidence

6. **Activity**
   - saved/updated/forgot/recalled
   - source run
   - undo
   - open evidence

7. **Review Queue**
   - sidecar suggestions
   - approve/edit/reject
   - trust mode: ask first / auto-save high confidence / manual only

8. **Recall Inspector**
   - choose a run
   - see what memory was injected or recalled
   - see why each item matched
   - flag bad recall

### In-run sidecar display

In the existing run/artifact sidecar, add a Memory tab:

```text
Memory used
  3 injected
  2 recalled by tool

Memory written
  1 suggested
  1 accepted

Why this mattered
  "prefers short answers" applied to final report formatting
```

## Permission modes

Memory needs its own policy layer:

```text
manual
  no automatic writes; user only

review
  sidecar proposes; user approves

auto-safe
  high-confidence non-sensitive writes apply automatically

auto-full
  trusted workspaces only; still logs every mutation
```

Default:

```text
review
```

Hard blocks:
- secrets, tokens, credentials
- inferred emotions or personality judgments
- medical/legal/financial sensitive facts unless user explicitly says remember
- raw private content copied wholesale
- facts already visible in code/git/docs
- low-confidence guesses

## Comparison: Agno

Agno's advantage is unified persistence: sessions, memory, knowledge, traces, schedules, and approvals sit behind one storage layer.

RunnerOS should copy the product shape, not the exact architecture:
- keep local markdown as truth
- use one local index service for memory/knowledge/trace lookup
- expose memory as part of run history and approvals

Agno is stronger at framework-level consistency. Runner can be stronger at local inspectability and user control.

## Comparison: Hermes

Hermes is strongest at runtime discipline.

Steal:
- subagent memory restrictions
- write approval boundaries
- hooks that can inspect/block memory actions
- run/job-level tool and memory policy
- prompt-injection scanning on assembled context

Do not make Hermes-style delegated agents free to mutate shared memory. Parent/session/workflow policy must decide.

## Comparison: OpenHuman

OpenHuman is strongest at personal-OS memory product direction.

Steal conceptually:
- local memory tree
- Obsidian-compatible vault
- subconscious/background consolidation
- voice memo to memory
- periodic reflection
- connector data folded into user-owned notes

Do not copy GPL code. Rebuild the pattern on Runner primitives.

## Comparison: Karpathy-style LLM wiki

Steal:
- raw evidence layer
- curated wiki layer
- schema/rules layer
- normal markdown and links
- Obsidian compatibility
- knowledge that compounds instead of repeated RAG over raw documents

Runner difference:
- connect the wiki to agents, runs, tools, approvals, and workflows.

## Comparison: MemoryOS / OpenMemory / Memori

Steal ideas:
- episodic / semantic / procedural / preference memory types
- temporal validity
- decay/reinforcement
- explainable recall
- memory from tool traces and outcomes, not chat alone
- migration/import paths later

Avoid at first:
- opaque cognitive graph as the only source of truth
- cloud service dependency
- broad automatic ingestion without review

## Phased implementation

### Phase 1 - Audit trail and sidecar

Status: implemented on `codex/memory-os-hardening`; pending Electron smoke and merge.

Goal: memory starts compounding safely.

Build:
- `memory_events` audit log: implemented.
- sidecar reviewer service: implemented.
- review queue UI/backend: implemented, with atomic backend apply.
- source run/evidence metadata on memory entries: implemented.
- direct user-memory write protection for spawned agents: implemented.
- sidecar modes: `Auto`, `Review`, `Manual`: implemented.
- auto-save guardrails for secrets and transient task facts: implemented.
- per-agent auto-save lock and final duplicate re-check: implemented.
- activity feed / subtle user-visible auto-save affordance: still open.

Acceptance:
- user can see every memory mutation in the audit/event surfaces.
- sidecar rejects obvious secrets, provider tokens, env assignments, and private keys.
- explicit "remember/forget" works through memory tools.
- `Review` mode keeps suggestions approval-gated.
- `Auto` mode quietly saves only new agent-scoped memory that passes validation.
- concurrent duplicate auto-saves do not create suffixed duplicate memories.

Still open:
- Electron smoke for Settings mode changes.
- Electron smoke for review queue apply/reject.
- decide whether quiet auto-saves need a small visible activity indicator.
- harden secret detection over a broader provider-token fixture set.

### Phase 2 - Local recall index

Goal: agents recall relevant memory without prompt bloat.

Build:
- local SQLite index
- content hashing and rebuild
- `recall_memory(query)`
- injected-memory recorder
- recall inspector UI

Acceptance:
- markdown remains source of truth
- deleting index and rebuilding produces same searchable state
- run page shows which memory was used

### Phase 3 - Knowledge vault

Goal: workspace knowledge becomes durable and browsable.

Build:
- vault folder config
- raw/wiki/daily/schema folders
- source capture to markdown
- curated wiki note writer
- `search_knowledge(query)`
- Obsidian-compatible links/tags

Acceptance:
- user can open vault in Obsidian
- raw evidence and curated notes are separate
- notes link back to sources/runs

### Phase 4 - Relationship graph

Goal: memory becomes navigable.

Build:
- generated memory edges
- backlinks
- graph UI
- edge evidence
- contradiction/update relations

Acceptance:
- graph is derived, not canonical
- every edge has reason/evidence
- user can edit underlying markdown from graph node

### Phase 5 - Daily consolidation

Goal: runs become clean memory, not log sludge.

Build:
- nightly consolidation job
- daily note artifact
- project decisions extracted from runs
- stale memory suggestions
- contradiction detection

Acceptance:
- yesterday's activity becomes a readable note
- noisy run traces do not flood memory
- consolidation suggestions are reviewable

### Phase 6 - Advanced memory intelligence

Goal: high-power personal OS behavior.

Build:
- temporal validity windows
- reinforcement/decay
- procedural memory
- source connector ingestion policies
- voice memo ingestion
- import/export bundles

Acceptance:
- agents know what changed over time
- old facts can expire or be superseded
- user can move memory between machines without lock-in

## File plan

Likely additions:

```text
packages/shared/src/memory/
  events.ts
  index-schema.ts
  recall.ts
  graph.ts
  vault.ts

packages/server-core/src/memory/
  MemoryIndexService.ts
  MemorySidecarService.ts
  MemoryGraphService.ts
  ConsolidationService.ts

packages/server-core/src/handlers/rpc/
  memory-inspector.ts
  memory-review.ts

packages/session-tools-core/src/handlers/
  recall-memory.ts
  search-knowledge.ts
  explain-memory.ts

apps/electron/src/renderer/pages/
  MemoryPage.tsx

apps/electron/src/renderer/components/memory/
  MemoryOverview.tsx
  MemoryEntryList.tsx
  MemoryActivityFeed.tsx
  MemoryReviewQueue.tsx
  MemoryGraphView.tsx
  RecallInspector.tsx
  KnowledgeVaultPanel.tsx
```

## Non-goals

- no cloud memory by default
- no hidden global surveillance
- no storing credentials or secrets
- no graph database dependency in first implementation
- no bulk automatic memory rewrite
- no treating memory as higher priority than current user instructions
- no copying GPL OpenHuman implementation

## Success demo

Open RunnerOS after a week away.

Concierge says:

> You were building Deep Research on `codex/deep-researcher`. The last accepted memory says you prefer browser follow-up loops over one-shot lookup, and the active goal was making memory visible/local. Want to continue the memory sidecar spec or inspect the Deep Research run?

Click "Why?"

Runner shows:
- the memory entries used
- the run where each was learned
- the vault note summarizing the decision
- the graph linking RunnerOS, Deep Research, and memory sidecar
- a button to edit or forget any of it

That is the bar.
