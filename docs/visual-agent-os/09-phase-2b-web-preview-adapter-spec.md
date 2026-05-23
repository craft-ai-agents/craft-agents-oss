# Phase 2B Web Preview Adapter Spec

Status: ready for build
Owner: RunnerOS
Last updated: 2026-05-22

## Goal

Let Canvas display safe local web previews without leaving chat.

Phase 2B is complete when a session-linked Output can point to a local web URL or generated HTML preview and Canvas renders it inline with basic browser controls, while preserving the Phase 2A output viewer behavior and chat input usability.

## Product Rationale

Phase 2A made Canvas useful for durable files: images, video, text, markdown, JSON, receipts, and links.

The next highest-leverage gap is local web inspection:

- agent builds a local app and opens `http://localhost:3000`
- workflow generates an HTML dashboard
- chart/tool exports a local preview page
- Excalidraw/Canva/TradingView-style tools provide a link or generated web artifact

The user should not have to leave the chat surface to inspect that result.

## Scope

Build Phase 2B before editable tldraw/Excalidraw.

In:

1. Add a Canvas web preview adapter for allowlisted local HTTP URLs.
2. Support Output manifests whose `preview.mode` is `external-link` or future `web`, and whose primary/first link points to local web content.
3. Render safe local URLs inside Canvas using an iframe.
4. Add compact controls: reload, open external, copy URL, loading/error state.
5. Preserve Phase 2A selector behavior for multiple outputs.
6. Keep remote URLs as link cards only.
7. Add tests for URL allowlisting and web-preview selection.
8. Manually smoke test with a local dev server.

Out for first Phase 2B slice:

1. Full browser replacement.
2. Arbitrary remote website embedding.
3. Electron `<webview>` usage.
4. `WebContentsView` integration.
5. Editable canvas.
6. Authenticated browser-session sharing.
7. General `file://` embedding.
8. Tool-specific Canva/TradingView native adapters.

## Research Decisions

Use iframe first.

Rationale:

- Electron's Web Embeds docs list iframe, webview, and WebContentsView as the main options.
- Electron docs recommend avoiding `<webview>` and considering iframe, WebContentsView, or no embedded content.
- WebContentsView gives more control but requires main-process layout coordination and is heavier than needed for local preview.
- MDN iframe sandbox guidance supports capability-based restrictions.

Sources:

- Electron Web Embeds: `https://www.electronjs.org/docs/latest/tutorial/web-embeds`
- Electron webview warning: `https://www.electronjs.org/docs/latest/api/webview-tag/`
- Electron Security: `https://www.electronjs.org/docs/latest/tutorial/security`
- Electron protocol API: `https://www.electronjs.org/docs/latest/api/protocol`
- MDN iframe sandbox: `https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe`

## Architecture

Phase 2B should extend the existing Phase 2A Output preview path.

Existing components to reuse:

- `apps/electron/src/renderer/components/outputs/OutputInlinePreview.tsx`
- `apps/electron/src/renderer/components/visual-surfaces/VisualSurfacePanel.tsx`
- `apps/electron/src/renderer/hooks/useOutputs.ts`
- `packages/shared/src/outputs/types.ts`
- `packages/shared/src/outputs/preview.ts`
- `packages/shared/src/outputs/storage.ts`
- `packages/server-core/src/handlers/rpc/outputs.ts`

Preferred shape:

```ts
OutputInlinePreview
  -> resolvePreviewTarget(manifest)
  -> if local web URL: OutputWebPreview
  -> else existing image/video/audio/text/json/receipt/link renderers
```

Do not create a parallel visual artifact system.

## Data Model

Phase 2B should avoid a breaking manifest schema change.

Use existing manifest fields:

```ts
{
  kind: 'external-action' | 'document' | 'report' | 'other',
  preview: {
    mode: 'external-link',
    inlineText?: string
  },
  links: [
    {
      id: 'link-1',
      label: 'Local preview',
      url: 'http://localhost:3000',
      role: 'primary'
    }
  ]
}
```

Optional non-breaking enhancement:

```ts
type OutputPreviewMode =
  | existing modes
  | 'web'
```

Only add `web` if it materially simplifies renderer logic. Otherwise treat local URLs under `external-link` as embeddable web previews.

## URL Policy

Canvas may iframe only local HTTP(S) dev URLs:

Allowed:

- `http://localhost:<port>`
- `http://127.0.0.1:<port>`
- `http://[::1]:<port>`

Optional allowed after explicit decision:

- `https://localhost:<port>`
- `https://127.0.0.1:<port>`
- `https://[::1]:<port>`

Blocked:

- remote hosts
- `file://`
- `data:`
- `javascript:`
- `blob:`
- custom protocols
- localhost URLs with username/password
- URLs without explicit host

Port:

- Allow any valid port for first slice.
- Do not assume specific dev ports.
- Invalid ports are blocked by URL parsing.

Path/query/hash:

- Preserve path, query, and hash.
- Do not mutate the URL except for normalization.

Redirect handling:

- First slice may rely on iframe browser behavior.
- If a local URL redirects remote, the iframe may load it unless blocked by browser/CSP.
- Add a visible "remote content may not embed" error if iframe fails.
- Stronger redirect interception requires WebContentsView or a server-side probe and is out of scope for iframe-first.

## Security Requirements

Never enable Node/Electron APIs in previewed content.

Iframe attributes:

```tsx
<iframe
  src={url}
  sandbox="allow-scripts allow-forms allow-same-origin"
  referrerPolicy="no-referrer"
/>
```

Do not include initially:

- `allow-popups`
- `allow-top-navigation`
- `allow-top-navigation-by-user-activation`
- `allow-downloads`
- broad `allow` permissions

Notes:

- `allow-scripts` is needed for normal local apps.
- `allow-forms` is needed for useful dev apps.
- `allow-same-origin` is often needed for app assets, localStorage, and framework dev servers.
- The risk is acceptable only because Phase 2B is local-host allowlisted. Do not reuse this sandbox for arbitrary remote pages.

Renderer safety:

- Treat the preview URL as untrusted display data.
- Never pass preview URLs to shell/open without the existing safe external-open path.
- Keep URL parsing in shared utility functions with tests.

Main-process safety:

- No main-process loading is required for first local URL iframe slice.
- Do not add `webviewTag: true`.
- Do not relax BrowserWindow security options.

## UX Requirements

Canvas should feel like a preview surface, not a browser.

Header:

- Keep top title as `Canvas`.
- No additional close/minimize buttons.
- Keep the eye button as the single open/close control.

Inside preview:

- Show a slim preview toolbar above the iframe.
- Controls:
  - Reload
  - Open external
  - Copy URL
- Optional label:
  - `Local preview`
  - host/port, e.g. `localhost:3000`

States:

- Loading: subtle spinner or "Loading preview..."
- Loaded: iframe fills available preview area.
- Blocked remote URL: show link card with "Open external".
- Failed load: show retry/open external.
- No local output: keep Phase 2A placeholder.

Layout:

- Roll-up mode must keep composer pinned.
- iframe must fill the preview card area without pushing the composer.
- Sidecar mode must use available width.
- On small app widths, iframe should still be usable with horizontal overflow avoided.

## Preview Selection Rules

When selected output has links:

1. If `manifest.preview.mode === 'web'` and URL is local: iframe it.
2. Else if `manifest.preview.mode === 'external-link'` and primary link URL is local: iframe it.
3. Else if any primary link URL is local: iframe it.
4. Else show existing external-link card.

When selected output has an HTML asset:

- If `manifest.preview.mode === 'web'`, the primary/selected HTML asset is served through `runner-output://` and iframe rendered.
- HTML assets without explicit web preview mode keep the existing file/text fallback.

## Phase 2B.2 Generated HTML Assets

Status: implemented on 2026-05-23.

Generated HTML files inside Output bundles are served through a safe Electron protocol instead of raw `file://` paths.

Implemented design:

1. Renderer resolves explicit web-mode HTML assets to:
   - `runner-output://asset/<workspaceId>/<outputId>/<relative-asset-path>`
2. Main process validates:
   - workspace exists and is local
   - requested path is a safe relative Output asset path
   - resolved path stays inside the Output bundle
   - requested path is an actual file
3. Protocol responses use restrictive headers:
   - `Content-Security-Policy`
   - `X-Content-Type-Options: nosniff`
   - `Cache-Control: no-store`
4. Relative HTML subresources work when they stay inside the same Output bundle.

Do not iframe raw `file://` paths.

## Test Plan

Unit tests:

- `isLocalWebPreviewUrl('http://localhost:3000') === true`
- `isLocalWebPreviewUrl('http://127.0.0.1:5173/path?q=1') === true`
- `isLocalWebPreviewUrl('http://[::1]:8080') === true`
- remote HTTP blocked
- `file://` blocked
- `javascript:` blocked
- credentials blocked
- invalid URLs blocked
- external-link output with local URL resolves to web preview
- external-link output with remote URL resolves to link card

Renderer tests if local harness allows:

- `OutputInlinePreview` renders iframe for local URL.
- `OutputInlinePreview` renders link card for remote URL.
- reload button changes iframe key/src.
- open external calls `window.electronAPI.openUrl(url)`.

Manual Electron smoke:

1. Start local test server on a free port.
2. Create a session-linked Output with a primary link to that local URL.
3. Open Canvas.
4. Confirm iframe renders the local page.
5. Click reload.
6. Close/reopen Canvas and confirm selected preview persists.
7. Reload app and confirm output is rediscovered from manifest.
8. Try a remote URL output and confirm it does not iframe.
9. Verify roll-up keeps composer pinned.
10. Verify sidecar on wide screen.

Suggested smoke server:

```bash
python3 -m http.server 4187 --directory /tmp/runneros-web-preview-smoke
```

## Acceptance Criteria

1. Canvas can render a session-linked local URL Output inline.
2. Remote URLs are not embedded.
3. Existing image/video/audio/text/json/receipt/link previews still work.
4. Multiple outputs can still be selected.
5. Close/reopen preserves selected output.
6. App reload rediscovers local web preview output from manifest.
7. Composer remains pinned in roll-up.
8. Sidecar still works on wide screens.
9. No BrowserWindow security settings are weakened.
10. No `<webview>` is introduced.

## Stop Conditions

Stop and ask if:

1. iframe cannot render the required local preview because of app CSP and fixing it would require weakening global CSP.
2. product requires arbitrary remote website embedding.
3. preview requires sharing authenticated cookies/session with a normal browser.
4. generated HTML assets require custom protocol changes that conflict with Electron session partitioning.
5. security review finds the sandbox needs broader permissions than listed here.

## Future Phases

Phase 2C:

- Generated HTML Output asset previews via custom protocol.
- PDF preview.
- Image zoom/pan.
- Better artifact metadata/actions.

Phase 3:

- Editable canvas using tldraw or Excalidraw-style integration.
- Agent visual operation protocol.
- Persisted editable visual surface snapshots.

Phase 4:

- Tool-specific adapters:
  - Excalidraw native editable adapter.
  - TradingView chart screenshot/live adapter.
  - Canva link/thumbnail/export adapter.
  - Browser automation preview adapter.
