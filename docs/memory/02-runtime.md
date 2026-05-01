# Memory runtime — how it actually works

How `MEMORY.md` and `USER.md` get read, injected, and written. Read [`01-spec.md`](./01-spec.md) first.

## TL;DR

- **Read path:** auto-injected into the agent's effective system prompt at session creation, between Workspace Context and the bundle footer. Same plumbing as workspace-context injection.
- **Write path:** explicit session-tools (`save_memory`, `update_memory`, `forget_memory`) the agent calls when something is worth remembering. Writes appear in the transcript — no implicit/silent stuffing.
- **Storage:** plain markdown files. Atomic write (`.tmp` + rename). Tombstones for user-deleted entries.

## Where the code lives

| Concern | Package | File (proposed) |
|---|---|---|
| Memory file format (parser, serializer, types, validation) | `@craft-agent/shared` | `src/memory/{types,storage}.ts` |
| Read-side injection helper | `apps/electron` | extend `composeAgentSystemPrompt` in `src/renderer/lib/compose-agent-prompt.ts` |
| Read-side server (workflow runner uses this) | `@craft-agent/server-core` | `src/agent/memory-loader.ts` (small wrapper around shared) |
| Session-tools (`save_memory`, etc.) | `@craft-agent/session-tools-core` | `src/handlers/{save,update,forget}-memory.ts` |
| Tool registry capabilities + bindings | `@craft-agent/shared` | `src/agent/session-scoped-tool-callback-registry.ts` + `session-self-management-bindings.ts` |
| Backend implementation of the callbacks | `@craft-agent/server-core` | `src/sessions/SessionManager.ts` (next to `createAgentFn` / `createAutomationFn`) |
| RPC for the renderer Memory tab | `@craft-agent/server-core` | `src/handlers/rpc/memory.ts` |
| Renderer state | `apps/electron` | `src/renderer/atoms/memory.ts` + `hooks/useAgentMemory.ts` |
| UI | `apps/electron` | extend `AgentInfoPage.tsx` with a Memory tab + new `UserMemoryDialog.tsx` |

Mirror precedents: workspace-context for the storage + RPC + renderer pattern; agent-creator/automation-creator for the session-tool + registry + binding pattern.

## Read path — auto-injection

When a session is spawned for an agent, the effective system prompt becomes:

```
{persona body}
---
{workspace context section}    (existing)
---
{user profile from USER.md}    (NEW — broadcast to every agent)
---
{this agent's MEMORY.md}       (NEW — per-agent)
---
{bundle footer}                (existing)
```

Implementation: extend `composeAgentSystemPrompt` to take `userMemoryEntries: MemoryEntry[]` and `agentMemoryEntries: MemoryEntry[]` parameters. Renders two sections with clear headers:

```
## What we know about you (USER.md)

- {name}: {body}
- {name}: {body}

## My memory of working with you (MEMORY.md)

- {name} ({type}, {created}): {body}
- {name} ({type}, {created}): {body}
```

Section is omitted when the corresponding list is empty. `expires` filtering happens at injection time — entries past their expiry date are silently dropped.

### Server-side equivalent

The renderer-only `composeAgentSystemPrompt` doesn't run when a workflow step spawns a session via `resolveAgentSessionOptions` in `SessionManager`. Mirror the same merge logic server-side: when resolving session options for an agent, load `USER.md` + that agent's `MEMORY.md` and append the same sections to the `customSystemPrompt`. Document this duplication with a "kept in sync" comment between the two render paths.

(Phase 3 candidate: hoist the prompt-composition logic to `@craft-agent/shared` so both renderer and server use one canonical implementation. Out of scope for this build.)

## Write path — three session-tools

Every memory mutation is an explicit tool call. The agent says "I think this is worth remembering" → calls a tool → user sees the call in the transcript.

### `save_memory`

Append a new entry. Mirror `create_agent` / `create_automation` shape.

```ts
interface SaveMemoryToolInput {
  /**
   * Where to save: 'agent' (this agent's MEMORY.md) or 'user' (the
   * cross-agent USER.md). Defaults to 'agent'.
   */
  scope?: 'agent' | 'user';
  /** Slug-shaped, unique within file. Will collide-suffix if necessary. */
  name: string;
  /** One of: 'user', 'feedback', 'project', 'reference'. */
  type: 'user' | 'feedback' | 'project' | 'reference';
  /** The entry body. Free-form markdown, 1-4 sentences typically. */
  content: string;
  /** Optional ISO date (YYYY-MM-DD) after which to drop on inject. */
  expires?: string;
}
```

Returns `{ ok, scope, name, file }` on success. On `name` collision: appends `-2`, `-3`, etc. before failing.

### `update_memory`

Modify an existing entry. Body or `expires` only — `name` and `type` are immutable identifiers.

```ts
interface UpdateMemoryToolInput {
  scope?: 'agent' | 'user';
  /** Existing entry name. Errors if not found. */
  name: string;
  content?: string;
  expires?: string | null;  // pass null to clear
}
```

Sets `updated` to today's date. Returns `{ ok, name }`.

### `forget_memory`

Delete an entry. Adds a tombstone so it's not auto-re-saved next session.

```ts
interface ForgetMemoryToolInput {
  scope?: 'agent' | 'user';
  name: string;
}
```

Returns `{ ok, name }`.

### Tool descriptions teach the LLM when to write

Each tool's description in `TOOL_DESCRIPTIONS` includes the "save vs don't save" guidance from [`01-spec.md`](./01-spec.md):

> `save_memory`: Persist a fact about the user, your collaboration, or the
> ongoing project. Save when:
> - You learn a stable fact about who the user is, their role, or their preferences (`type: user`)
> - User corrects your approach OR confirms an unusual approach worked (`type: feedback`)
> - Project state changes that won't be in code/git (`type: project`)
> - User points to an external system (`type: reference`)
>
> Do NOT save:
> - Anything already in code/git
> - Ephemeral conversation context
> - Negative judgments about the user
> - Project debugging recipes (the fix is in the commit)

This is the load-bearing teaching. Without it the model writes everything and the file bloats.

## Tool registration

Add three entries to `SESSION_TOOL_DEFS` in `tool-defs.ts`:

| Tool | safeMode | executionMode |
|---|---|---|
| `save_memory` | `block` | `registry` |
| `update_memory` | `block` | `registry` |
| `forget_memory` | `block` | `registry` |

`safeMode: 'block'` because they're write operations — `ask`-mode users approve once per call.

## Capability + binding wiring

Same five-step pattern as `create_agent` / `create_automation`:

1. Add three `*Fn?` callbacks to `SessionScopedToolCallbacks` registry
2. Add three `*?` capabilities to `SessionToolContext`
3. Add three `Object.defineProperty` lazy getters in `session-self-management-bindings.ts`
4. Implement the three callbacks in `SessionManager.mergeSessionScopedToolCallbacks` block (next to `createAgentFn`)
5. Implementation reads file → mutates → writes → emits a `memory.CHANGED` broadcast for the renderer

## Persistence — atomic + tombstoned

Storage helper signatures (mirror `workspace-context/storage.ts`):

```ts
// Read
loadAgentMemory(agentSlug: string): MemoryFile | null
loadUserProfile(): MemoryFile | null
listMemoryEntries(file: MemoryFile, opts?: { includeExpired?: boolean }): MemoryEntry[]

// Write — all atomic (write-tmp-rename)
saveMemoryEntry(scope: 'agent' | 'user', input: SaveMemoryInput, agentSlug?: string): MemoryEntry
updateMemoryEntry(scope: 'agent' | 'user', input: UpdateMemoryInput, agentSlug?: string): MemoryEntry
deleteMemoryEntry(scope: 'agent' | 'user', name: string, agentSlug?: string): boolean

// Tombstones
readDeletedMemoryNames(scope, agentSlug?): Set<string>
rememberDeletedMemoryName(scope, agentSlug, name): void
forgetDeletedMemoryName(scope, agentSlug, name): void  // called when user re-saves
```

Tombstone files: `~/.agents/.deleted-memories.json` for USER scope, `~/.agents/agents/<slug>/.deleted-memories.json` for agent scope.

## Concurrency

Per-file mutex wrapping read-mutate-write, same shape as `withAutomationConfigMutex`. Two simultaneous `save_memory` calls for the same agent must serialize.

## Events for the renderer

A single broadcast event: `memory.CHANGED`, payload `[scope: 'agent' | 'user', agentSlug: string | null]`. Renderer's `useAgentMemory` hook subscribes and refreshes the relevant file.

Mirror the `workspaceContext.CHANGED` channel + bridge pattern verbatim.

## Resume on restart

Memory files are pure markdown — no in-memory state. Restart "just works." No special handling needed.

## What stays out of scope

- **Semantic recall** — Tier 2 sqlite-vec, only when files exceed 200 entries.
- **Cross-user shared memory** — single-user product.
- **Memory deduplication / merge-on-conflict** — agent self-prunes when contradictions arise (per `01-spec.md` rules in the tool description).
- **Time-decay scoring** — out of scope; just use `expires`.
- **Cross-agent memory references** — `agents/researcher/MEMORY.md` cannot read `agents/writer/MEMORY.md`. Only USER.md is shared.
