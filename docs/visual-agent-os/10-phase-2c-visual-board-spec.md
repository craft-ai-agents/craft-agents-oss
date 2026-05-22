# Phase 2C Visual Board MVP Spec

Status: ready for build
Owner: RunnerOS
Last updated: 2026-05-22

## Goal

Give every chat session a persistent visual board inside Canvas without turning RunnerOS into a drawing app.

Phase 2C is complete when the Canvas panel can open a session-linked board, add/edit/remove note cards, pin existing session outputs as cards, save the board through normal Output manifests, and reopen the same board after reload.

## Product Shape

This is a structured board, not an image annotation tool.

In:

1. One default board per session.
2. Board stored as a normal Output bundle tagged `visual-board`.
3. Board data stored in a JSON asset, not localStorage.
4. Add note cards from the Canvas UI.
5. Edit note card title/body inline.
6. Delete board cards.
7. Pin existing session outputs as cards.
8. Open pinned output cards in the existing output viewer.
9. Debounced autosave with visible save state.
10. Reload rediscovers the board from output manifests.

Out:

1. Freehand drawing.
2. Drawing on images.
3. tldraw dependency.
4. Multiplayer or CRDT sync.
5. Agent visual operation protocol.
6. Arbitrary React/component rendering.
7. Drag/drop layout precision.
8. Remote board collaboration.

## UX

Canvas keeps one title: `Canvas`.

If a session has a board output, Canvas opens the board first. Other outputs remain available in the selector.

Board view:

- Top row: Add note, save state, optional output pin menu.
- Main surface: responsive card grid.
- Note card: title, body, delete action.
- Output card: output title/kind/summary, open/select action.
- Empty state: one quiet prompt to add a note or pin an output.

This should feel like a compact working surface beside chat. It should not expose a full whiteboard toolbar.

## Data Model

Use existing `OutputManifest` storage.

Board output:

```json
{
  "kind": "other",
  "origin": { "source": "session", "sessionId": "..." },
  "tags": ["visual-board", "session-board"],
  "preview": { "mode": "json", "assetId": "board" },
  "assets": [
    {
      "id": "board",
      "label": "Board",
      "role": "primary",
      "path": "board.json",
      "mimeType": "application/json"
    }
  ]
}
```

Board JSON:

```ts
interface VisualBoardSnapshot {
  schemaVersion: 1
  workspaceId: string
  sessionId: string
  title: string
  cards: VisualBoardCard[]
  createdAt: string
  updatedAt: string
}

type VisualBoardCard =
  | {
      id: string
      type: 'note'
      title: string
      body: string
      createdAt: string
      updatedAt: string
    }
  | {
      id: string
      type: 'output'
      outputId: string
      title: string
      kind: string
      summary?: string
      createdAt: string
      updatedAt: string
    }
```

Validation:

- `workspaceId` and `sessionId` must match the request.
- Max cards: 100.
- Max title length: 120.
- Max note body length: 4000.
- Output cards must reference an existing output in the same workspace/session when created from UI.

## API

Add scoped output RPCs rather than broad arbitrary file writes:

- `outputs:getVisualBoard(workspaceId, sessionId)`
- `outputs:saveVisualBoard(workspaceId, sessionId, snapshot)`

`getVisualBoard`:

1. List outputs.
2. Find newest manifest where `tags` includes `visual-board` and `origin.sessionId` matches.
3. Read `board.json`.
4. Return `{ output, board }`.
5. If no board exists, create one and return it.

`saveVisualBoard`:

1. Validate request and snapshot.
2. Find or create the session board output.
3. Write `board.json` atomically inside the output bundle.
4. Update manifest asset metadata, `updatedAt`, preview inline text, and summary.
5. Broadcast `outputs:updated`.

## Renderer Integration

Add:

- `useVisualBoard(workspaceId, sessionId)`
- `VisualBoardSurface`

Update `VisualSurfacePanel`:

- Treat board output as the default selected surface when present.
- Show `VisualBoardSurface` for manifests tagged `visual-board`.
- Keep existing output preview behavior for non-board outputs.
- Selector continues to switch between board and artifacts.

## Acceptance Criteria

1. Open Canvas in a session with no outputs: a board is created and displayed.
2. Add a note card.
3. Edit note title/body.
4. Save state reports clean after debounce.
5. Close/reopen Canvas: note is still present.
6. Reload app: board output is rediscovered and rendered.
7. If the session has other outputs, pin one to the board.
8. Pinned output card can select/open that output in Canvas.
9. Existing image/video/text/json/link/web previews still work.
10. Chat composer remains pinned and usable in roll-up and sidecar.

## Verification

Required:

- Targeted board storage tests.
- Targeted board renderer/state tests where practical.
- Existing visual surface tests.
- Existing output preview tests.
- Touched-file ESLint.
- `bun run typecheck:electron`
- `bun run typecheck:shared`
- `bun run electron:build:renderer`
- Manual Electron smoke with add/edit/reopen and pin-output flows.

## Stop Conditions

Stop and ask before continuing if:

1. Safe board persistence requires generic renderer file write access.
2. Output manifests cannot be updated without breaking validation.
3. The board competes with or breaks existing output selection.
4. Manual smoke shows Canvas again harms the chat composer.

