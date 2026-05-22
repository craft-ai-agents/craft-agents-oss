# Phase 3: Agent Surface Events

## Goal

Let a running agent update the current session Canvas through validated, session-scoped operations backed by Outputs storage.

## User Outcome

- The agent can open or initialize the Canvas without leaving chat.
- The agent can add note cards to the Canvas.
- The agent can pin existing same-session Outputs to the Canvas.
- Canvas updates are durable and replayable through an append-only event log.

## Scope

Build a narrow event protocol, not arbitrary visual code execution.

Supported event actions:

1. `open_board`
   - Ensures the session Canvas board output exists.
   - Returns a receipt the chat/tool caller can render.

2. `add_note`
   - Adds a note card to the current session board.
   - Validates title/body limits using the existing visual-board contract.

3. `pin_output`
   - Adds an output card for an existing Output in the same session.
   - Rejects cross-session, missing, or Canvas-board outputs.
   - Does not duplicate an already pinned output.

## Non-Goals

- No freeform React/component injection.
- No drawing-on-image tools.
- No external app-specific integrations.
- No cross-workspace or cross-session visual writes.
- No new visual storage system outside Outputs.

## Data Model

Add shared `visual-surface-events` types:

- `VisualSurfaceEventInput`
  - Discriminated by `action`.
  - Contains only action payload. It must not accept workspace/session IDs from the model.

- `VisualSurfaceEventRecord`
  - `id`
  - `workspaceId`
  - `sessionId`
  - `action`
  - `payload`
  - `source`
  - `createdAt`

- `ApplyVisualSurfaceEventResult`
  - `ok`
  - `eventId`
  - `outputId`
  - `board`
  - `receipt`
  - optional `error`

Persist event history as newline-delimited JSON in the existing visual-board output directory:

- asset id: `visual-events`
- path: `visual-events.jsonl`
- mime: `application/x-ndjson`

## Server Behavior

`OutputService.applyVisualSurfaceEvent(workspaceId, sessionId, input, source)`:

1. Validate `input` with shared schema.
2. Resolve or create the current session visual board.
3. Apply the event to the board snapshot.
4. Validate resulting board snapshot and output-card references.
5. Save `board.json`.
6. Append event record to `visual-events.jsonl`.
7. Update manifest assets and emit `outputs:updated`.
8. Return a chat-friendly receipt.

`OutputService.listVisualSurfaceEvents(workspaceId, sessionId)`:

1. Resolve current session board output.
2. Read `visual-events.jsonl` if present.
3. Return valid event records only.

## Agent Tool

Add registry session tool: `visual_surface`

The tool calls an injected current-session callback. The agent never passes workspace/session IDs.

Tool input:

```json
{ "action": "open_board" }
```

```json
{ "action": "add_note", "title": "Draft angle", "body": "Use the stronger CTA." }
```

```json
{ "action": "pin_output", "outputId": "..." }
```

Tool output:

- Human receipt in text content.
- Structured content with `ok`, `eventId`, `outputId`, `receipt`, and board summary data.

## Renderer Bridge

Add RPCs for local Electron:

- `outputs:applyVisualSurfaceEvent`
- `outputs:listVisualSurfaceEvents`

The session tool path uses server-side callbacks. The RPC path exists for UI/debug/replay and future renderer-driven visual actions.

For live UI refresh, reuse `outputs:updated`: when the board output changes, the open Canvas reloads its board snapshot.

## Verification

Automated:

- Shared validation rejects malformed events.
- `OutputService` creates board on `open_board`.
- `add_note` writes `board.json` and appends event history.
- `pin_output` only accepts same-session non-board outputs and avoids duplicates.
- Session tool validates input, calls the injected callback, and returns receipts.
- IPC channel parity stays green.
- Typecheck touched packages.

Manual/UI:

- Open Electron Canvas.
- Trigger an agent-style visual event.
- Confirm the Canvas updates without leaving chat.

## Stop Conditions

Stop before completion only if:

- Existing Output storage cannot safely host event history.
- Session tool callback injection lacks session/workspace identity.
- Verification is blocked by missing local runtime.
