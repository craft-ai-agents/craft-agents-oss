# Auto-memory sidecar

## Status

Implemented on `codex/memory-os-hardening`; pending Electron smoke and merge.

Shipped shape:

- post-turn `MemorySidecarService`
- compact existing-memory index
- review queue for user-scope, update, forget, uncertain, or failed proposals
- `Auto / Review / Manual` memory sidecar setting
- quiet auto-save only for safe new agent-scoped memories
- secret and transient-task rejection guards
- per-agent auto-save lock plus final duplicate re-check before write

Still open:

- Electron smoke for Settings mode switching
- Electron smoke for review queue apply/reject
- decide whether quiet auto-saves need a small visible activity/audit indicator
- broaden credential fixture coverage before treating secret rejection as mature

## Problem

The current memory system is inspectable and explicit: agents can call `save_memory`, `update_memory`, and `forget_memory`, and the writes land in `USER.md` or per-agent `MEMORY.md`.

That is safe, but it depends on the active agent noticing that something should become memory. In practice, agents will sometimes miss durable facts because their main job is solving the user's request, not auditing the conversation for future recall.

We want memory to unfold naturally without bloating every agent prompt with a long memory policy or turning memory into fuzzy automatic summarization.

## Goal

Add a lightweight post-turn reviewer that decides whether the latest exchange contains a durable memory candidate.

The main agent stays focused on the task. The sidecar handles memory capture after the turn.

## Non-goals

- No hidden rewriting of large conversation summaries into memory.
- No vector DB dependency in this phase.
- No graph extraction.
- No broad "summarize everything" behavior.
- No large memory policy injected into every agent prompt.
- No automatic persistence of secrets, credentials, emotional state, or one-off task details.

## Proposed flow

```text
User message + agent response
        |
        v
Main agent completes normally
        |
        v
Memory sidecar receives:
- latest user message
- latest assistant response
- active agent slug
- existing memory index: names, scopes, types, short bodies
        |
        v
Sidecar returns structured decision:
- none
- save
- update
- forget
        |
        v
Backend applies accepted mutation through existing memory write path
```

## Sidecar input

Keep input intentionally small:

- latest user message
- latest assistant response
- active agent slug and agent name
- current `USER.md` entries as compact index
- current agent `MEMORY.md` entries as compact index
- optional signal: whether the user explicitly said "remember", "forget", "from now on", "don't do that", or corrected the agent

Do not pass the full session transcript by default.

## Sidecar output

The reviewer must return structured JSON only:

```json
{
  "decision": "none",
  "confidence": 0.0,
  "reason": "No durable fact, preference, correction, project state, or reference was introduced."
}
```

Save:

```json
{
  "decision": "save",
  "scope": "user",
  "name": "prefers terse audit summaries",
  "type": "feedback",
  "content": "User prefers terse, direct audit summaries that lead with meaningful risks and avoid filler.",
  "expires": null,
  "confidence": 0.91,
  "evidence": "User asked for a deep audit and specifically said not to nitpick, only meaningful issues."
}
```

Update:

```json
{
  "decision": "update",
  "scope": "agent",
  "name": "project memory architecture",
  "content": "Memory remains markdown-backed, but auto-capture should be handled by a post-turn sidecar rather than bloating every agent prompt.",
  "expires": null,
  "confidence": 0.88,
  "evidence": "User asked for the best way to make memory automatic without feeding too much fuzz to agents."
}
```

Forget:

```json
{
  "decision": "forget",
  "scope": "user",
  "name": "old scheduling preference",
  "confidence": 0.95,
  "evidence": "User explicitly said to forget that scheduling preference."
}
```

## Acceptance rules

Only write memory when all of these are true:

- The candidate is durable beyond the current turn.
- The candidate will likely improve future behavior.
- The candidate is factual or explicitly stated by the user.
- The candidate is not already captured by an existing memory entry.
- Confidence is at least `0.85`, unless the user explicitly said "remember this" or "forget this".

Prefer `update` over `save` when an existing memory covers the same idea.

## Rejection rules

Return `none` for:

- transient task details
- raw conversation summaries
- facts already visible in code, git, docs, or current workspace files
- guesses about the user's mood or personality
- secrets, credentials, tokens, private keys
- medical, legal, financial, or other sensitive facts unless the user explicitly asks to remember them
- negative judgments about the user
- debugging recipes that are already represented by code changes or commits

## Scope choice

Use `scope: user` for cross-agent facts:

- user identity
- durable user preferences
- communication style
- stable work context

Use `scope: agent` for facts specific to the active agent:

- how this agent should behave
- feedback on this agent's output style
- project state only this agent needs
- references this agent should use

Concierge can bias toward `user` because its role is cross-agent routing.

## Runtime placement

Trigger after a completed assistant turn, before the UI considers the run fully idle.

Recommended constraints:

- run asynchronously so it does not delay visible response streaming
- show memory tool-call chips or a small memory activity entry when a write occurs
- do not show anything when decision is `none`
- skip when the main turn failed before producing a useful response
- skip when the user is in a private/incognito session mode, if such a mode is added

## Prompt shape

The main agent only needs a short memory policy:

> You may use memory tools for durable user facts, preferences, feedback, project state, and useful references. Prefer updates over duplicates. Do not save short-term context.

The sidecar gets the full policy and strict JSON schema.

## Implementation sketch

1. Add `MemorySidecarService` in server-core.
2. Build compact memory indexes from `USER.md` and the active agent's `MEMORY.md`.
3. Add a small structured-output prompt for the reviewer.
4. Validate reviewer output with a schema.
5. Apply accepted decisions through the existing `saveMemory`, `updateMemory`, and `forgetMemory` backend paths.
6. Add audit logging for every accepted memory mutation.
7. Add tests for rejection, dedupe/update preference, explicit remember, explicit forget, and low-confidence `none`.

## Safety controls

- hard cap content length, e.g. 500 chars
- hard cap name length through existing memory validation
- reject multi-entry batches for phase 1; one decision per turn
- require exact existing memory name for updates/forgets
- never write when schema validation fails
- record `evidence` in logs, not necessarily in the memory body
- expose memory writes in the transcript or activity feed so user trust remains intact

## Open questions

- Should the sidecar use the active agent's configured model, the default mini model, or a fixed local reviewer model?
- Should accepted sidecar writes require user confirmation at first, then become automatic after trust is established?
- Should project memories default to an expiration date?
- Should the reviewer run after every turn or only when lexical triggers suggest memory-worthy content?

## Success criteria

- User does not need to manually ask agents to remember routine durable facts.
- Main agent prompt grows by only a short memory policy, not a large doctrine.
- Memory files remain concise, editable, and trustworthy.
- Duplicate memories decrease because sidecar sees the existing memory index.
- False-positive memory writes are rare and visible enough to correct quickly.
