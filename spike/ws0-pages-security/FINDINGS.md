# WS0 — Craft Pages security spike: measured findings

Everything below was **run**, not reasoned about. Environments: Electron 39.2.7
(Chromium) and Safari 26 (WebKit), macOS arm64, node 26.5.0, spike server on
`127.0.0.1:8899`.

**Five** findings change the plan. The most operationally dangerous one — an
iframe `sandbox` attribute combined with a CSP `sandbox` header silently kills
all scripts in WebKit — was only visible because a second engine was tested.

---

## 0. Do NOT combine the iframe `sandbox` attribute with the CSP `sandbox` header

Plan r3 said the header is the control and "the iframe attribute stays as
belt-and-braces". **That combination breaks the page in WebKit.**

| Variant | Chromium | WebKit (Safari) |
|---|---|---|
| iframe `sandbox` attr **+** CSP `sandbox` header | scripts run | **NO scripts run at all** |
| CSP `sandbox` header only | scripts run | scripts run |

With both applied, Safari executed *nothing* — not even the first `<head>`
script — and the wrapper timed out with no results. Removing the attribute and
relying on the header alone fixed it, and containment was still enforced
(framed self-navigation blocked, `origin` opaque, storage throws).

**Decision: the CSP response header is the ONLY sandbox. Never set the iframe
`sandbox` attribute as well.** "Defence in depth" here is a silent
total-failure mode in a shipping browser, which is worse than either control
alone.

This also explains an earlier confusing run: the first Safari framed attempt
reported `"no results from frame within 8s"` with no beacons. That was this bug,
not a reporting failure.

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

## 8. Cross-engine agreement (Chromium vs WebKit)

With the header-only sandbox, WebKit matched Chromium on **every** measured
behaviour:

| Probe | Chromium | WebKit |
|---|---|---|
| `event.origin` seen by wrapper | `"null"` | `"null"` |
| forged `postMessage` rejected | yes | yes |
| `window.origin` | `null` | `null` |
| `localStorage` | `SecurityError` | `SecurityError` |
| `document.cookie` | `SecurityError` | `SecurityError` |
| `window.open` | blocked | blocked |
| `fetch` own `data.json` | blocked | blocked |
| form submit | no navigation | no navigation |
| `type="module"` | does not run | does not run |
| `<style>` block | blocked | blocked |
| `style=""` attribute | blocked | blocked |
| CSSOM write | allowed | allowed |
| **framed self-navigation** | **blocked** | **blocked** |
| **top-level self-navigation** | **SUCCEEDED** | **SUCCEEDED** |

The two engine-behaviour claims the plan depends on — `frame-src` blocking child
self-navigation, and top-level self-navigation being unstoppable — hold in both.
The capability split in §2.5 is confirmed across engines, not just Chromium.

Observation method for WebKit: an HTTP listener on the exfil port, plus an
`img-src 'self'` beacon endpoint for script-progress. Neither needs WebDriver or
devtools, so the same instrumentation will work for Firefox and for Windows and
Linux runs.

## A methodology note (why one result was nearly recorded wrong)

The first top-level runs reported "self-navigation blocked" in both engines. That
was an artefact: the harness's own `top-nav` probe does
`window.top.location.href = …`, and when the document **is** top-level,
`window.top === window`, so the probe navigated the page away mid-run and killed
every later measurement. Corrected by skipping that probe when top-level. The
real result is the opposite — self-navigation succeeds. Recorded here because the
failure mode (a probe that destroys its own experiment) is easy to reintroduce.

## 9. Verification-tooling gotchas (cost real time; will recur in WS5)

Both of these made a WORKING page look broken.

**A screenshot of an out-of-process iframe can capture blank.** The production
wrapper appeared to render nothing: dark, empty, repeatedly. The frame had
loaded (`load` fired, `contentWindow` present, box measured 1200x1200) and the
page rendered perfectly when opened standalone. Forcing a reflow made it appear
immediately. A cross-origin iframe is composited out-of-process and the capture
can beat the paint. **Wait, or force a reflow, before screenshotting a framed
page** — otherwise "blank" is read as a bug that does not exist.

**Devtools-style instrumentation does not cross the opaque-origin boundary.**
For a sandboxed frame, the extension's network log shows the frame's document
request but NOT its subresources, and its console log shows nothing from inside
the frame. Reading "no subresource requests" as "subresources were blocked" is
wrong — they are simply invisible. Confirmed by checking the WS0 spike, whose
frame demonstrably ran (it POSTed results) while showing the same empty
subresource list.

The reliable instrument for anything inside the frame remains the one this spike
already used: have the page report to the server via an `img-src 'self'` beacon.
It works in every engine, needs no automation, and sees what devtools cannot.

**Synthetic input (click/type) did not reach the framed document** in testing.
Scripts, DOM generation, CSS and CSSOM were all verified visually instead.

## Still open

- **Firefox / Gecko not run** — not installed on the test machine. Deferred by
  decision: Gecko is not a target platform for the desktop app, and the
  instrumentation above will run there unchanged when wanted.
- **Windows and Linux not run.** Path handling in the containment guard is the
  risk area (backslashes, drive-relative paths, ADS, `MAX_PATH`). Mitigate with
  OS-independent unit tests over the guard's string handling before WS2 lands.
