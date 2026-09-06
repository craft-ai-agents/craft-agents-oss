/**
 * Pure helpers for page thumbnail capture — NO electron imports, so this is
 * unit-testable under bun. The Electron capture itself lives in
 * page-thumbnailer.ts and consumes these.
 *
 * The capture renders the page exactly as PageFrame does: the page HTML is the
 * srcDoc of an opaque sandboxed iframe (never `allow-same-origin`), and the
 * trusted host posts the `craft-pages/v1` init message so data-driven pages
 * paint with their snapshot. No action bridge — a poster never executes source
 * actions.
 */

import type { PageDataSnapshot, PageKind } from '@craft-agent/shared/pages/types'

/** Logical render viewport (16:10) the offscreen window uses. */
export const THUMB_LOGICAL_WIDTH = 1000
export const THUMB_LOGICAL_HEIGHT = 625
/** Stored poster width (height derived 16:10); keeps some retina crispness. */
export const THUMB_OUTPUT_WIDTH = 800
export const THUMB_OUTPUT_HEIGHT = 500
/** JPEG quality for the stored poster. */
export const THUMB_JPEG_QUALITY = 82

/** Same sandbox rule as PageFrame: static = inert, interactive/live = scripts+forms, never same-origin. */
export function sandboxForKind(kind: PageKind): string {
  return kind === 'static' ? '' : 'allow-scripts allow-forms'
}

/** Escape a string for safe embedding inside a double-quoted HTML attribute (srcdoc). */
export function escapeSrcdocAttribute(html: string): string {
  return html
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Build the trusted host document loaded into the offscreen window. It embeds
 * the page content in a sandboxed iframe and delivers the data snapshot once
 * via the same bridge PageFrame uses. Returns a full HTML string; the caller
 * loads it with `loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))`.
 */
export function buildThumbnailHostHtml(input: {
  content: string
  slug: string
  kind: PageKind
  snapshot: PageDataSnapshot | null
}): string {
  const sandbox = sandboxForKind(input.kind)
  const srcdoc = escapeSrcdocAttribute(input.content)
  // JSON embedded in a script; </script> in data is the only real hazard.
  const snapshotJson = JSON.stringify(input.snapshot).replace(/<\/script>/gi, '<\\/script>')
  const page = JSON.stringify({ slug: input.slug, kind: input.kind })

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; width: ${THUMB_LOGICAL_WIDTH}px; height: ${THUMB_LOGICAL_HEIGHT}px; overflow: hidden; background: #ffffff; }
  iframe { border: 0; width: 100%; height: 100%; display: block; background: #ffffff; }
</style>
</head>
<body>
<iframe id="frame" sandbox="${sandbox}" referrerpolicy="no-referrer" srcdoc="${srcdoc}"></iframe>
<script>
  var PAGE = ${page};
  var SNAPSHOT = ${snapshotJson};
  var frame = document.getElementById('frame');
  function deliver() {
    try {
      frame.contentWindow.postMessage(
        { protocol: 'craft-pages/v1', type: 'init', payload: { page: PAGE, nonce: 'preview', snapshot: SNAPSHOT } },
        '*'
      );
    } catch (e) { /* opaque-origin race — the ready handler retries */ }
  }
  frame.addEventListener('load', deliver);
  window.addEventListener('message', function (event) {
    var m = event.data;
    if (m && m.protocol === 'craft-pages/v1' && m.type === 'ready') deliver();
  });
</script>
</body>
</html>`
}
