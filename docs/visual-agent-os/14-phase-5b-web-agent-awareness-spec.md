# Phase 5B: Web Surface Agent Awareness

## Goal

Make local web previews useful to agents without adding provider-specific tool integrations yet.

This phase starts with read-only awareness: an agent can ask what visual surfaces exist for the current session, whether Canvas has cards, and which Outputs are local web previews that can be opened in the Canvas sidecar.

## Scope

1. Add a read-only session tool: `visual_surface_state`.
2. Report current session Canvas board state from Output-backed storage.
3. Report same-session visual Outputs, including local web preview candidates.
4. Preserve the existing local web iframe policy:
   - loopback HTTP(S) only
   - no credentials in URL
   - no remote web embedding
5. Do not add Canva, Excalidraw, TradingView, or provider-specific code in this phase.

## User Outcome

- The agent can tell whether a Canvas board exists.
- The agent can see which Outputs are pinnable or previewable.
- The agent can identify local web previews and their URL/host.
- The agent can decide whether to open Canvas, add a note, or pin an Output using the existing `visual_surface` tool.

## Non-Goals

- No arbitrary browser control.
- No console/network log capture yet.
- No DOM scraping from iframe previews.
- No remote URL iframe support.
- No drawing or image annotation.

## Tool Contract

`visual_surface_state` takes no arguments.

It returns:

- `canvas`
  - `exists`
  - `outputId`
  - `title`
  - `cardCount`
  - `noteCount`
  - `outputCardCount`
  - `updatedAt`
- `outputs`
  - output id/title/kind/status/summary
  - preview mode
  - whether it is pinnable
  - whether it is a local web preview
  - local web URL/host when applicable
- `webPreviews`
  - filtered list of local web preview Outputs
- `capabilities`
  - `canOpenCanvas`
  - `canPinOutputs`
  - `canInspectWebConsole` false for now

## Console Logs Later

Console awareness should not be faked. Iframe previews do not safely expose console logs to the parent app. A later phase can add this through one of:

1. Existing browser-pane tooling for controllable browser sessions.
2. A dev-only local preview shim that injects `postMessage` logging.
3. A dedicated BrowserSurface adapter backed by Electron BrowserView/WebContentsView.

## Verification

- Unit test `visual_surface_state` handler with missing and present callback.
- Unit test OutputService state builder:
  - empty session
  - board exists
  - local web Output is detected
  - remote web Output is not marked embeddable
- Typecheck touched packages.
