import { describe, it, expect } from 'bun:test'
import {
  buildThumbnailHostHtml,
  escapeSrcdocAttribute,
  sandboxForKind,
  THUMB_LOGICAL_WIDTH,
} from '../page-thumbnail-host'

describe('page-thumbnail-host', () => {
  it('applies the same sandbox rule as PageFrame', () => {
    expect(sandboxForKind('static')).toBe('')
    expect(sandboxForKind('interactive')).toBe('allow-scripts allow-forms')
    expect(sandboxForKind('live')).toBe('allow-scripts allow-forms')
    // Never same-origin (the whole opaque-origin guarantee).
    expect(sandboxForKind('interactive')).not.toContain('allow-same-origin')
  })

  it('escapes content for safe srcdoc embedding', () => {
    const escaped = escapeSrcdocAttribute('<img src="x" onerror=\'a&b\'>')
    expect(escaped).not.toContain('"')
    expect(escaped).not.toContain('<img')
    expect(escaped).toContain('&quot;')
    expect(escaped).toContain('&lt;img')
    expect(escaped).toContain('&amp;')
  })

  it('embeds the page content as an escaped srcdoc iframe with the kind sandbox', () => {
    const html = buildThumbnailHostHtml({
      content: '<h1>Hello "world"</h1>',
      slug: 'demo',
      kind: 'interactive',
      snapshot: null,
    })
    expect(html).toContain(`width: ${THUMB_LOGICAL_WIDTH}px`)
    expect(html).toContain('sandbox="allow-scripts allow-forms"')
    // Raw content must not appear unescaped in the host doc.
    expect(html).not.toContain('<h1>Hello')
    expect(html).toContain('&lt;h1&gt;Hello &quot;world&quot;')
  })

  it('delivers the data snapshot via the craft-pages/v1 init message', () => {
    const snapshot = { version: 1 as const, generatedAt: 5, kv: { total: 42 }, series: {} }
    const html = buildThumbnailHostHtml({ content: '<p>x</p>', slug: 's', kind: 'live', snapshot })
    expect(html).toContain('craft-pages/v1')
    expect(html).toContain("type: 'init'")
    expect(html).toContain('"total":42')
  })

  it('neutralizes a </script> sequence inside snapshot data', () => {
    const snapshot = { version: 1 as const, generatedAt: 1, kv: { x: '</script><script>alert(1)' }, series: {} }
    const html = buildThumbnailHostHtml({ content: '<p>x</p>', slug: 's', kind: 'live', snapshot })
    expect(html).not.toContain('</script><script>alert(1)')
    expect(html).toContain('<\\/script>')
  })

  it('static pages still embed content (no scripts, snapshot irrelevant)', () => {
    const html = buildThumbnailHostHtml({ content: '<p>static</p>', slug: 's', kind: 'static', snapshot: null })
    expect(html).toContain('sandbox=""')
    expect(html).toContain('&lt;p&gt;static&lt;/p&gt;')
  })
})
