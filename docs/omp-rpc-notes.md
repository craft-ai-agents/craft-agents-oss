# OMP RPC protocol notes (`omp --mode rpc`)

Verified empirically against `omp` v17.2.9 (2026-08-06) with probe scripts. Transport: NDJSON over stdio — one JSON object per line, both directions.

## Lifecycle

1. Spawn: `omp --mode rpc` (optional flags: `--approval-mode <mode>`, `--auto-approve` yolo, `--model`, `--session <dir>`…). cwd = workspace root; OMP session files live in its own session dir (under `~/.omp`), keyed by cwd.
2. Server immediately sends `{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],"maxFrameBytes":1048576,"maxReassembledFrameBytes":67108864}` followed by `extension_ui_request` (e.g. `setWidget`) and `available_commands_update`.
3. **CRITICAL (the turn-stall blocker): the host MUST answer every `extension_ui_request`.** An unanswered request blocks extension init / the prompt pipeline: after `{"type":"prompt"}` you get `success` + `agent_start` and then nothing (no `message_start`, >170 s stall). Respond with `{"id":<request id>,"type":"extension_ui_response","approved":true,"value":true}` (id as string). Once answered, the full event stream flows.
4. Protocol v2 is optional: `{"id":N,"type":"negotiate_protocol","protocolVersion":2}` — only needed for >1 MiB frames (chunking). v1 (default) is fine for us.

## Commands (stdin)

All commands: `{id: N, type: <cmd>, ...}`. Response: `{id, type:"response", command:<cmd>, success:bool, data?:..., error?:string}`.

- `prompt` — `{message, images?, streamingBehavior?}`: async; success response returns immediately, events stream after. Also whole-session events.
- `steer`, `follow_up` — queue messages mid-turn.
- `abort` — `{type:"abort"}`; resolves after `AgentSession.abort` (also `abort_and_prompt {message}`).
- `new_session` — `{parentSession?}` → `data:{cancelled:false}`; resets the conversation.
- `get_state` → `data: RpcSessionState` (model, thinkingLevel, isStreaming, steeringMode, sessionId, sessionFile, tokensPerSecond, messageCount, todoPhases, …).
- `set_model` — **`{provider: string, modelId: string}`** (NOT `{model}` — that yields `Model not found: undefined/undefined`). See `model_update` event after success. Use `get_available_models` to list candidates for fuzzy matching.
- `set_thinking_level` — `{level}`; emits `{type:"thinking_level_changed", thinkingLevel}`.
- `set_steering_mode` / `set_follow_up_mode` / `set_interrupt_mode` — `{mode:"all"|"one-at-a-time"}` / `{"immediate"|"wait"}`.
- `get_last_assistant_text`, `get_messages`, `get_session_stats`, `compact`, `export_html`, `set_todos {phases}`, `bash {command}`, `get_available_models`, `set_host_tools`, `set_host_uri_schemes`, `get_subagents`, `switch_session {sessionPath}`, `branch {entryId}`, `handoff`, `set_session_name {name}`, `set_env`?? (unverified — not in RpcCommand union of v17.2.9), `stop`?? (unverified).

## Events (stdout, unsolicited)

- `agent_start` / `agent_end` — agent run bracket. `agent_end.messages` = full message array including final assistant message with `.usage` `{input,output,cacheRead,cacheWrite,totalTokens,cost{…,total}}`.
- `turn_start` / `turn_end` — turn bracket. `turn_end.message` = assistant message with `usage` and `stopReason`.
- `message_start` / `message_end` — per message (roles `user`, `assistant`, `toolResult`). `message_end` of the assistant carries the final `usage`.
- `message_update` — streaming: `.assistantMessageEvent` is one of:
  - `thinking_start` / `thinking_delta {delta, contentIndex}` / `thinking_end {content}`
  - `text_start` / `text_delta {delta, contentIndex}` / `text_end {content}`
  - `toolcall_start {contentIndex, partial}` / `toolcall_delta {delta}` / `toolcall_end {toolCall:{id,name,arguments}}`
  Each event also carries `.partial` — the full accumulated assistant message so far.
- `tool_execution_start {toolCallId, toolName, args, intent?}` — tool begins.
- `tool_execution_update {toolCallId, toolName, partialResult}` — streaming partial output.
- `tool_execution_end {toolCallId, toolName, result:{content:[{type:"text",text}],details}, isError}`.
- `extension_ui_request {id, method, ...}` — MUST be answered (see above). `method: "setWidget"` and `"cancel"` are ignorable but still answered. Dialog methods (`confirm`, `editor`, `select`) block until answered.
- `thinking_level_changed`, `model_update`?? (unverified name), `available_commands_update`, `auto_compaction_start/end`, `extension_error`.
- Permission prompts for destructive tools arrive as `extension_ui_request` (dialog/confirm) — the craft permission layer answers them; with `--auto-approve`/approval `yolo` they never appear. In default rpc mode, bash with simple non-destructive commands ran without prompts.

## Session identity / resume

`get_state.data.sessionId` + `sessionFile` identify the OMP session. Sessions persist across processes in OMP's session dir (per cwd); `new_session` starts fresh, `switch_session {sessionPath}` resumes, `--continue <id>` CLI flag continues a previous session at spawn.

NOTE (verified 2026-08-06, probe D): respawning `omp --mode rpc` with the **same** `--session-dir` does NOT auto-resume — it starts a fresh session (messageCount 0, new sessionId/file). `switch_session` is required to attach to an existing transcript.

## Branching (G3, verified 2026-08-06 with live probes)

**Entry id format.** Wire events (`message_start`/`message_end`/`get_messages`/`get_state`) expose **no entry ids**. Ids exist only in the session JSONL transcript (path = `get_state.data.sessionFile`). Each line is an entry `{type, id, parentId, ...}` where `id` is a short **8-hex** string (`"3af736d6"`) and `parentId` chains entries (`session`/`model_change`/`thinking_level_change`/`title`/`custom` entries interleave with `type:"message"` ones). Assistant message entries also carry `responseId` (a provider UUID — NOT the branchable id).

**`branch {entryId}` semantics (source-verified in agent-session.ts + probed):**
- `entryId` MUST be the id of a **user** message entry. An assistant entry id or unknown id → response `success:false`, error `"Invalid entry ID for branching"` (probed: assistant id and bogus id both fail identically).
- The fork cuts the new session at `selectedEntry.parentId` — i.e. branch history = everything before that user message. Response: `{text, images, cancelled}` where `text` is the selected user message's own text (for UI re-prompt) and `cancelled:true` only if an extension `session_before_branch` hook cancels.
- `switch_session {sessionPath}` then `branch {entryId}` from a DIFFERENT process works: the new forked transcript `<ts>_<newSessionId>.jsonl` is written into the running process's own `--session-dir`; **the parent transcript file is not modified** (verified byte-identical after fork + follow-up turn).
- Tail fork (branch after the LAST assistant message — no user entry follows it): copy the parent transcript file into the child's session-dir and `switch_session` to the copy. Full history retained, follow-up turns append to the copy, parent file untouched. The copied session keeps the same OMP `sessionId`.
- Verified end-to-end: 2-turn parent (fruits BANANA+MANGO); mid-history cut before turn 2 → branch recalls only BANANA; tail-copy → branch recalls both.

**Craft wiring (G3).** Per final assistant message, OmpAgent reads the transcript at `message_end` (OMP appends entries synchronously at `message_end` — see session-manager.ts "message_end persists the finished message"), takes the last assistant entry id, and emits `omp_turn_anchor {turnId, entryId}`; SessionManager persists `craftMessageId → entryId` into `<session>/meta/omp-turn-anchors.json`. At branch time the child OmpAgent resolves the cut: the first `user` entry AFTER the anchor becomes the `branch` arg; if none, the tail-copy strategy is used. Legacy sessions / messages without an anchor fail branch creation loudly (no silent wrong-context fork).

## Print mode (one-shot)

`omp -p "<text>"` runs one prompt non-interactively and prints the answer on stdout (verified: ~6 s for trivial prompts on rox gateway). Used for `runMiniCompletion`/`queryLlm`.

## Verified event order for a tool-using turn

```
ready → extension_ui_request(setWidget) → available_commands_update
response(prompt, success) → agent_start → turn_start
→ message_start(user) → message_end(user)
→ message_start(assistant) → message_update(thinking_*) → message_update(toolcall_*) → message_end
→ tool_execution_start → tool_execution_update(*) → tool_execution_end
→ message_start(toolResult) → message_end(toolResult)
→ turn_end → turn_start → message_start(assistant) → text deltas → message_end (usage) → turn_end
→ agent_end
```
