# ADR 0001 — Craft Pages trust model

**Status:** Accepted — implemented through WS7
**Date:** 2026-08-09
**Supersedes:** the trust-model sections of `plan.md` r1–r3
**Evidence:** `spike/ws0-pages-security/FINDINGS.md` — every decision below was
measured against Chromium (Electron 39.2.7) and WebKit (Safari), macOS arm64.

## Context

Craft Pages lets an agent author a local webpage that the user can view, and
(later) that can read live data through existing connectors. The HTML is written
by an LLM that has read the user's email, tickets, and chat — so it is
**prompt-injectable and must be treated as hostile**, not merely untrusted.

## Decisions

### D1 — Pages are served by a dedicated `PagesServer`, never the RPC/WS port

`WsRpcServer` attaches its WebSocket server to the same `node:http` server it
serves HTTP from (`packages/server-core/src/transport/server.ts:293-297`), and
performs no `Origin` check on upgrade while accepting a bearer token *or* a
session cookie. Co-locating pages there would let page JS upgrade a socket
carrying the `HttpOnly` session cookie and obtain full RPC access.

Separate `node:http` listener, loopback-only bind, independently persisted port.
Does **not** extend `ServerConfig` (that governs thin-client exposure — different
feature, different threat model).

### D2 — The CSP response header is the ONLY sandbox

```
Content-Security-Policy: … ; sandbox allow-scripts
```

Header, not iframe attribute, because the CSP `sandbox` directive is header-only
by spec and therefore also applies when `/p/*` is opened directly rather than
framed.

**Do not additionally set the iframe `sandbox` attribute.** Measured: with both
applied, **WebKit executes no scripts at all** — not even the first `<head>`
script — while Chromium is unaffected. Header-only works in both and still
enforces containment. This is the single most dangerous thing in this ADR,
because it is a silent total failure that looks like a broken page, and
"defence in depth" is the instinct that produces it.

Flags granted: `allow-scripts` only. Not `allow-same-origin`, `allow-forms`,
`allow-popups`, `allow-top-navigation*`, `allow-downloads`, `allow-modals`.

### D3 — Separate policies for `/w/*` and `/p/*`

The wrapper is app-authored and trusted: no sandbox, `connect-src 'self'` (it
owns the bridge), `frame-src 'self'`.

Generated content is hostile: sandboxed, `connect-src 'none'`,
`form-action 'none'`, `base-uri 'none'`, `object-src 'none'`, `frame-src 'none'`,
`worker-src 'none'`. Never one shared policy.

### D4 — `'self'` is correct; no explicit-origin workaround

A header-delivered policy takes its self-origin from the **response URL** at
parse time, not from the document's later opaque origin. Measured: external
stylesheet applied, classic script executed. Plan r2's claim that `'self'`
"matches nothing when sandboxed" was wrong — that folklore applies to
*meta*-delivered policies and to `srcdoc`/`data:` documents.

### D5 — The wrapper authenticates on `event.source`, never `event.origin`

Measured in both engines: `event.origin` from the sandboxed frame is the literal
string `"null"`. An origin comparison can never match, and accepting `"null"`
would accept a message from *any* sandboxed frame. The guard is:

```js
if (e.source !== frame.contentWindow) return   // drop
```

A forged same-window message was correctly rejected by this check in both
engines.

### D6 — Live-data pages are always framed; static pages may be top-level

Measured, both engines:

| Context | Self-navigation to an off-origin URL | Blocked by |
|---|---|---|
| Framed in the wrapper | **blocked** | the **wrapper's `frame-src 'self'`** |
| Top-level document | **succeeded**, reached the network | nothing |
| Top-level + Electron `webRequest` deny | **blocked** | network layer |

No sandbox flag restricts a document navigating its own frame, and CSP's
`navigate-to` was removed from the spec and never shipped. The embedding
document's `frame-src` is what stops it — browser-native, no Electron required.

Therefore:

- A page **holding grants** is only ever rendered **inside the wrapper**, never
  as a top-level document, *including in-app*. "Open in browser" and
  "open in browser pane" are disabled for it.
- A **grantless** page may be opened top-level anywhere; it holds nothing worth
  exfiltrating.
- `/p/*` additionally rejects `Sec-Fetch-Dest: document` for grant-holding pages,
  so a direct URL cannot sidestep the wrapper. (Measured: the header is present
  and reads `document` on top-level loads.)
- The Electron `webRequest` egress deny on a dedicated pages partition remains as
  a second layer.

### D6a — The Electron egress deny-list has a limited attachment point

Verified while wiring WS3, and it narrows D6 rather than contradicting it.

An `<iframe>` in the renderer runs in the **main window's session**. Electron
has no per-iframe partition, and `webviewTag` is `false`
(`window-manager.ts:261`), so the `persist:craft-pages` partition **cannot**
cover the in-app iframe surface that WS5 plans. Attaching a default-deny filter
to `defaultSession` instead is not an option — it would cancel every request the
whole app makes.

So the two controls divide cleanly:

| Surface | Control |
|---|---|
| Page framed inside the wrapper (iframe in the renderer) | the wrapper's `frame-src 'self'` — browser-native, measured effective in Chromium and WebKit |
| Page in a dedicated `WebContentsView` / `BrowserWindow` | the pages partition + `webRequest` deny-list |
| Page top-level in a third-party browser | **nothing** — hence live-data pages are in-app only |

`createPagesSession()` owns its `fromPartition` call so the deny-list cannot be
attached to the wrong session by mistake.

**Open for WS5:** whether the in-app surface is an iframe (simple, relies solely
on `frame-src`) or a `WebContentsView` in the pages partition (isolated, egress
enforced, heavier, and needs its own lifecycle and layout plumbing). D6's
"live-data pages are always framed" holds either way; this decides which
mechanism enforces it.

### D7 — Classic scripts only; page data ships as JS

Measured, both engines: `<script type="module">` **does not execute** and emits
**no CSP violation**. Module scripts fetch in CORS mode, which is cross-origin
from an opaque origin. Adding `Access-Control-Allow-Origin: *` fixes it — and is
**rejected**, because it would let any site that learns the port and pageId read
page content.

`connect-src 'none'` also blocks the page fetching its own `data.json`, so page
data must be delivered as an executed script assigning a global.

The authoring skill must state both. A model reaches for `type="module"` and
`fetch('data.json')` by default, and both fail silently.

### D8 — `style-src` stays strict

Measured, both engines:

| Technique | Result |
|---|---|
| `<style>` block | blocked (`style-src-elem`) |
| `style="..."` attribute | blocked (`style-src-attr`) |
| `el.setAttribute('style', …)` | blocked (`style-src-attr`) |
| `el.style.prop = …` (CSSOM) | **allowed** |

No `'unsafe-inline'`. Styling lives in an external stylesheet; dynamic styling
uses CSSOM. The skill forbids inline `<style>` and `style=` — both fail silently
(unstyled element, no error).

### D9 — A dedicated containment guard, never `validateFilePath`

Measured, not inferred. A symlink inside a page directory pointing at a
`credentials.enc` under `$HOME`:

```
validateFilePath()      ACCEPTED -> …/.craft-agent/credentials.enc
dedicated guard         400 Rejected
```

`validateFilePath` does carry a nine-pattern sensitive-file denylist, but
`credentials.enc` matches none of them (`credentials\.json$` needs `.json`;
`secrets?\.` needs "secret."). The hole is narrower than "allows all of `$HOME`"
and lands exactly on the Craft Agents credential store.

The guard must: canonicalise root and target; require containment; reject **any**
symlinked path component; reject dotfiles, metadata files, encoded separators,
NUL and `:`; allow `GET`/`HEAD` only; serve no directory listings.

### D10 — HTTP boundary hardening

Verified against the prototype: `Host` pinned to the exact bound loopback
authority (400 otherwise); bridge `Origin` validated against the wrapper origin
(403 otherwise); no CORS headers and preflights rejected; body limits applied in
the request reader before JSON parsing.

## Consequences

- The authoring skill has hard constraints it must teach: classic scripts only,
  external stylesheet only, CSSOM for dynamic styling, data as JS, no
  `localStorage`, no `<form>` submit. Every one of these fails **silently**, which
  is why they belong in the skill rather than in review.
- WS2 must implement its own containment module; reusing `validateFilePath` is a
  security regression.
- WS5's preview must point at `/w/{pageId}`, never `/p/*` directly.
- WS7 must gate "open externally" on whether the page holds grants.

## Implementation notes added during WS7

Three refinements the build surfaced, none of which change a decision above.

**The merge order in `resolveArgs` is belt-and-braces, not the guarantee.**
`fixedArgs` is spread last so a page cannot override it — but mutation testing
showed reversing that spread fails no test, because `approve()` rejects any
grant whose parameters collide with its fixed arguments. The collision check is
the actual control; the ordering is kept in case that check is ever relaxed.

**`canOpenExternally` fails closed.** If the grant store cannot be consulted,
the answer is "no". Refusing to offer "open in browser" costs a convenience;
wrongly offering it costs D6.

**The workspace pool is narrower than a session pool.** Only sources exposing a
tool on the trusted allowlist are connected at all, so a page never causes a
subprocess spawn or an OAuth refresh for capability it could not reach. A source
that is never connected cannot be called by mistake.

## Not yet verified

- **Gecko/Firefox** — not run (not installed). Deferred: not a target platform.
  The spike's instrumentation (exfil-port listener + `img-src` beacon) needs no
  WebDriver and will run there unchanged.
- **Windows and Linux** — not run. The containment guard's path handling is the
  risk (backslashes, drive-relative paths, ADS, `MAX_PATH`). Mitigation: unit-test
  the guard's string handling OS-independently before WS2 lands, and treat
  Windows path behaviour as an explicit carried risk.
