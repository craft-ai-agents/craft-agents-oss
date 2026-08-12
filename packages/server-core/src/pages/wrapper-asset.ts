/**
 * The trusted wrapper, inlined as strings rather than shipped as files.
 *
 * Deliberate: `electron-builder` `files` globs silently no-op when the target
 * directory is missing — `resources/session-mcp-server/**` and
 * `resources/pi-agent-server/**` are both listed today and neither exists, and
 * with `asar: false` there is no integrity error either. A wrapper shipped that
 * way would be missing only in packaged builds, which is the worst place to
 * discover it. Strings survive bundling unconditionally.
 *
 * The wrapper is TRUSTED code on the pages origin. It is not sandboxed, and it
 * is the only thing that will ever hold connector access (WS7). Keep it small
 * and keep agent-authored content out of it.
 */

/**
 * Wrapper document.
 *
 * NOTE: the iframe carries NO `sandbox` attribute. Sandboxing comes from the
 * CSP response header on `/p/*`. Adding the attribute here as well makes WebKit
 * execute no scripts at all — measured in WS0, enforced by
 * `scripts/check-page-sandbox.ts`, recorded as ADR 0001 D2.
 */
export function renderWrapperHtml(opts: {
  pageId: string
  rev: number
  title: string
  /** Source slugs this page may read. Rendered as always-visible chrome. */
  sources?: string[]
  /**
   * The page's approved handles, resolved to grant ids. Inlined here because
   * the wrapper is server-rendered and already knows the page — the alternative
   * is an extra round trip on every load to learn what the user already
   * decided. The PAGE never sees these; only the wrapper reads the attribute.
   */
  grants?: Record<string, string>
}): string {
  const safeTitle = escapeHtml(opts.title)
  const sources = (opts.sources ?? []).map(escapeHtml)
  const grantsJson = escapeHtml(JSON.stringify(opts.grants ?? {}))
  const src = `/p/${encodeURIComponent(opts.pageId)}/r/${opts.rev}/`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<link rel="stylesheet" href="/w-assets/wrapper.css">
</head>
<body>
<div id="ca-chrome" role="status">
  <span id="ca-title"></span>
  ${sources.length > 0
    ? `<span id="ca-sources" class="live">Live data: ${sources.join(', ')}</span>`
    : '<span id="ca-sources" hidden></span>'}
</div>
<iframe id="ca-frame" title="${safeTitle}" src="${src}"></iframe>
<script src="/w-assets/wrapper.js" data-page-id="${escapeHtml(opts.pageId)}" data-rev="${opts.rev}" data-title="${safeTitle}" data-grants="${grantsJson}"></script>
</body>
</html>
`
}

export const WRAPPER_CSS = `
:root { color-scheme: light dark; }
html, body { margin: 0; height: 100%; }
body { display: flex; flex-direction: column; font: 13px system-ui, sans-serif; }
#ca-chrome {
  flex: 0 0 auto; padding: 6px 12px; border-bottom: 1px solid rgba(128,128,128,.35);
  display: flex; gap: 10px; align-items: center;
}
/* A live-data page must never be visually indistinguishable from a static
   one — the user should be able to see, without asking, that this page can
   read their connected accounts. */
#ca-sources.live {
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 12%, transparent);
}
#ca-frame { flex: 1 1 auto; width: 100%; border: 0; }
`

/**
 * Wrapper script.
 *
 * The one rule that matters: authenticate postMessage by `event.source`, never
 * `event.origin`. A frame sandboxed without `allow-same-origin` has an opaque
 * origin, which postMessage serialises as the literal string "null" — so an
 * origin comparison never matches, and accepting "null" would accept a message
 * from ANY sandboxed frame. Measured in both Chromium and WebKit (ADR 0001 D5).
 */
export const WRAPPER_JS = `(function () {
  var script = document.currentScript;
  var frame = document.getElementById('ca-frame');
  var titleEl = document.getElementById('ca-title');
  titleEl.textContent = script.getAttribute('data-title') || 'Page';

  // Handles the user approved, resolved to grant ids by the server. Built with
  // a null prototype so 'constructor', 'toString' and friends are not handles:
  // a plain object literal would resolve every one of them to a function.
  var grants = Object.create(null);
  try {
    var declared = JSON.parse(script.getAttribute('data-grants') || '{}');
    for (var k in declared) {
      if (Object.prototype.hasOwnProperty.call(declared, k) && typeof declared[k] === 'string') {
        grants[k] = declared[k];
      }
    }
  } catch (ignored) { /* no handles; every query is refused */ }

  window.addEventListener('message', function (e) {
    // Identity check is by SOURCE. e.origin is the string "null" here.
    if (e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || typeof d !== 'object' || d.craftPage !== true) return;

    if (d.kind === 'query') {
      var id = d.id;

      // The page names its own HANDLE, never a grant id. An id it could choose
      // is an id it could guess at; a handle only resolves to something the
      // user approved FOR THIS PAGE, and to nothing at all otherwise.
      var grantId = (typeof d.name === 'string')
        ? grants[d.name]
        : undefined;
      if (typeof grantId !== 'string') {
        reply({ id: id, error: 'forbidden' });
        return;
      }

      // Forward the grant id and params and NOTHING else. Copying extra fields
      // through here would hand the page exactly the choice the grant model
      // exists to take away.
      fetch('/internal/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grantId: grantId,
          params: (d.params && typeof d.params === 'object') ? d.params : {}
        })
      }).then(function (res) {
        return res.text().then(function (text) {
          var parsed = null;
          try { parsed = JSON.parse(text); } catch (ignored) { parsed = null; }

          if (res.ok && parsed && parsed.ok === true) {
            reply({ id: id, data: parsed.data });
            return;
          }

          // Echo ONLY a code the bridge itself named. A status line, an HTML
          // error page, or a proxy's body is detail the page has no business
          // seeing — it collapses to one generic code.
          var code = (parsed && typeof parsed.error === 'string')
            ? parsed.error
            : 'request_failed';
          reply({ id: id, error: code });
        });
      }).catch(function () {
        // Never leave a query unanswered: a page awaiting a reply that never
        // arrives looks identical to one that is merely slow.
        reply({ id: id, error: 'request_failed' });
      });
    }
  });

  function reply(msg) {
    msg.craftPage = true;
    msg.kind = 'query-result';
    // '*' is the only targetOrigin an opaque origin can be addressed by. Safe
    // here because the message goes to that one frame's window, not broadcast.
    frame.contentWindow.postMessage(msg, '*');
  }
})();
`

/**
 * Page-side helper, served at `/w-assets/craft-query.js`.
 *
 * Runs INSIDE the sandbox, so it is untrusted code and holds nothing sensitive
 * — it is a convenience over postMessage, not a security boundary. It exists so
 * agents write `craftQuery('unread', …)` instead of hand-rolling correlation
 * logic in every page.
 *
 * Referenced by the page with a script tag rather than injected into the page's
 * HTML: rewriting agent-authored markup to insert a script works right up until
 * someone writes unusual HTML.
 *
 * `script-src 'self'` permits this even though the page's origin is opaque — a
 * header-delivered policy takes its self-origin from the response URL (CSP3
 * §4.1), not from the document's origin. Measured in WS0.
 */
export const PAGE_QUERY_JS = `(function () {
  var pending = Object.create(null);
  var counter = 0;

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.craftPage !== true || d.kind !== 'query-result') return;
    var resolve = pending[d.id];
    if (!resolve) return;
    delete pending[d.id];
    // Resolve, never reject. A rejected promise with no handler is an
    // unhandled rejection in a page whose only sin was having access revoked;
    // {error} makes refusal ordinary control flow instead.
    resolve(d.error ? { error: d.error } : { data: d.data });
  });

  window.craftQuery = function (name, params) {
    return new Promise(function (resolve) {
      var id = 'cq' + (++counter);
      pending[id] = resolve;
      window.parent.postMessage({
        craftPage: true,
        kind: 'query',
        id: id,
        name: name,
        params: (params && typeof params === 'object') ? params : {}
      }, '*');
    });
  };
})();
`

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  ))
}
