# WS0 — Craft Pages security spike: measured findings

Everything below was **run**, not reasoned about. Environment: Electron 39.2.7
(Chromium), macOS arm64, node 26.5.0, spike server on `127.0.0.1:8899`.

Two findings **contradict** the plan as written and change it. Two more were
not anticipated at all.

---

## 1. `'self'` works in a header-delivered CSP — plan was wrong, now corrected

r2 of the plan claimed CSP `'self'` "matches nothing" for a sandboxed document
and that the policy must name the origin explicitly. **That is wrong**, and the
security reviewer was right to flag it.

| Probe | Result |
|---|---|
| external stylesheet under `style-src 'self'` | applied — `rgb(0, 128, 0)` |
| classic `<script src>` under `script-src 'self'` | executed |
| relative `<img src>` in an opaque-origin document | loaded |
| relative `href` resolution | resolves against the document URL |

A header policy's self-origin comes from the **response URL** at parse time, not
from the document's later opaque origin. The explicit-origin workaround is
unnecessary; `default-src 'self'` is correct. The folklore applies to *meta*-
delivered policies and to `srcdoc`/`data:` documents.

## 2. Self-navigation — the capability split holds, but the mechanism is different

This is the finding the whole §2.5 argument rests on, and the spike changed my
understanding of it.

| Context | Self-navigation to an off-origin URL | Mechanism |
|---|---|---|
| **Framed in the wrapper** | **BLOCKED** — `ERR_BLOCKED_BY_CSP` | the **wrapper's `frame-src 'self'`** |
| **Top-level document** | **SUCCEEDED** — reached the network | nothing applies |
| **Top-level + Electron `webRequest` deny** | **BLOCKED** — `ERR_BLOCKED_BY_CLIENT` | network layer |

The plan said Electron's `webRequest` was the *only* control. It is not: when the
page is framed, **the embedding document's `frame-src` governs where the child
frame may navigate**. That is browser-native, works in any engine, and needs no
Electron. I had not accounted for it.

The top-level case is unchanged and confirms the split. Loaded directly, the
sandboxed page navigated itself to
`http://127.0.0.1:9999/collect?d=SECRET_PAYLOAD` and the request genuinely
reached the network (`ERR_CONNECTION_REFUSED` — a connection was attempted).
A second navigation reached DNS (`ERR_NAME_NOT_RESOLVED`). **Absence of
`allow-top-navigation` does not stop a top-level document navigating itself.**

**Consequence that is stronger than the plan's:** a live-data page must always be
viewed **framed inside the wrapper** — never loaded as a top-level document, not
even in-app. "Open in the browser pane" is a top-level load and forfeits the
`frame-src` protection (in Electron `webRequest` still catches it; in a
third-party browser nothing does).

## 3. ES modules do not execute — not anticipated

`<script type="module">` silently failed to run. **No CSP violation was
reported**, which is why this would have been painful to diagnose later.

Cause: module scripts are fetched in **CORS mode**. From an opaque origin that is
a cross-origin request, and the server sends no `Access-Control-Allow-Origin`.
Verified by adding `Access-Control-Allow-Origin: *` — modules then executed.

**Recommendation: forbid ES modules; classic scripts only.** Sending `ACAO: *` on
page assets would let any website that learns the port and pageId *read* page
content cross-origin. Not worth it to enable a syntax the agent does not need.
The authoring skill must state this explicitly, because a model will otherwise
reach for `type="module"` by default and the failure is silent.

## 4. `style-src 'self'` — the open decision, now measured

| Technique | Without `'unsafe-inline'` | Violation |
|---|---|---|
| `<style>` block | **blocked** | `style-src-elem` |
| `style="..."` attribute | **blocked** | `style-src-attr` |
| `el.setAttribute('style', …)` | **blocked** | `style-src-attr` |
| `el.style.color = …` (CSSOM) | **ALLOWED** | — |

CSSOM property writes are not covered by `style-src`. So a strict policy costs
inline `<style>` blocks and `style=""` attributes but leaves JS-driven styling
fully working.

**Recommendation: keep `style-src 'self'` strict.** All styling goes in an
external stylesheet; dynamic styling uses CSSOM. The skill must forbid inline
`<style>` and `style=` attributes — a model produces both by habit, and they fail
*silently* (element renders unstyled, no thrown error).

## 5. Opaque-origin behaviour — confirmed, one item stronger than predicted

| Probe | Predicted | Measured |
|---|---|---|
| `window.origin` | `"null"` | `"null"` ✓ |
| `localStorage` | throws | `SecurityError` ✓ |
| `document.cookie` | empty string | **throws `SecurityError`** — stronger |
| `event.origin` seen by wrapper | `"null"` | `"null"` ✓ |
| forged `postMessage` (wrong `source`) | rejected | rejected ✓ |

The `event.source === frame.contentWindow` guard is confirmed necessary and
sufficient: `event.origin` really is the literal string `"null"`, so an origin
comparison can never work, and accepting `"null"` would accept any sandboxed
frame.

## 6. Containment — all pass

| Probe | Result |
|---|---|
| `window.open` | blocked |
| `window.top.location = …` (framed) | `SecurityError` |
| `<form action="https://…">` submit | no navigation |
| `fetch()` external | blocked, `connect-src` |
| `fetch()` of the page's **own** `data.json` | blocked, `connect-src` |
| CSS `url()` asset | allowed, no violation |
| WOFF2 font | allowed, no violation |

`connect-src 'none'` blocks the page's own JSON, so **page data must ship as
executed JS** assigning a global. Verified working via `app-data.js`.

## 7. Server boundary — all pass

Containment guard, Host pinning, method and Origin checks:

| Probe | Result |
|---|---|
| encoded `../` traversal | 400 |
| encoded backslash | 400 |
| ADS `index.html::$DATA` | 400 |
| dotfile | 400 |
| directory listing | 404 |
| `POST` / `DELETE` on `/p/*` | 405 |
| `Host: evil.com` | 400 |
| bridge with no / wrong `Origin` | 403 |
| legitimate page + nested asset | 200 |

### `validateFilePath` is confirmed unsuitable — measured, not inferred

A symlink placed inside the page directory pointing at a `credentials.enc` under
`$HOME`:

```
validateFilePath()      ACCEPTED -> /Users/anukin/ws0-decoy/.craft-agent/credentials.enc
our containment guard   HTTP 400  Rejected by containment guard
```

Refinement worth recording: `validateFilePath` **does** carry a nine-pattern
sensitive-file denylist (`.ssh/`, `.gnupg/`, `.aws/credentials`, `.env`,
`credentials.json`, `secrets?.`, `.pem`, `.key`). **`credentials.enc` matches
none of them** — `credentials\.json$` requires `.json`, and `secrets?\.` requires
"secret." So the hole is narrower than "allows all of `$HOME`", but it is real
and it lands exactly on the Craft Agents credential store.

---

## Decisions this closes

1. **CSP uses `'self'`.** No explicit-origin workaround. (Plan r2 corrected.)
2. **`style-src` stays strict.** External stylesheet + CSSOM only; skill forbids
   inline `<style>` and `style=` attributes.
3. **Classic scripts only.** No ES modules, no `ACAO` header.
4. **Page data ships as JS**, not fetched JSON.
5. **Live-data pages are always framed**, never top-level — including in-app.
6. **Dedicated containment guard**, never `validateFilePath`.
7. **`frame-src 'self'` on the wrapper is a primary control**, not incidental —
   it is what blocks framed self-navigation, and it works in every browser.

## Still open

- **Firefox and Safari have not been run.** Every result above is Chromium
  (Electron 39.2.7). The `frame-src`-blocks-child-navigation behaviour and the
  module/CORS behaviour are both spec-derived and should hold, but "should" is
  what this spike exists to eliminate. Run before WS2 lands.
- **Windows and Linux not run.** Path handling in the containment guard is the
  risk area.
