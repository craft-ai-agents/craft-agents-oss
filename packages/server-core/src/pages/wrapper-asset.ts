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
}): string {
  const safeTitle = escapeHtml(opts.title)
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
  <span id="ca-sources" hidden></span>
</div>
<iframe id="ca-frame" title="${safeTitle}" src="${src}"></iframe>
<script src="/w-assets/wrapper.js" data-page-id="${escapeHtml(opts.pageId)}" data-rev="${opts.rev}" data-title="${safeTitle}"></script>
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
#ca-sources:not([hidden]) { opacity: .75; }
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

  window.addEventListener('message', function (e) {
    // Identity check is by SOURCE. e.origin is the string "null" here.
    if (e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || typeof d !== 'object' || d.craftPage !== true) return;

    if (d.kind === 'query') {
      // WS7. Until grants exist there is nothing a page may ask for, and
      // answering anything would be a capability we have not designed yet.
      frame.contentWindow.postMessage({
        craftPage: true, kind: 'query-result', id: d.id,
        error: 'live_data_unavailable',
      }, '*');
    }
  });
})();
`

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  ))
}
