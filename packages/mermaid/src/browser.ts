// ============================================================================
// Browser entry point for @craft-agent/mermaid
//
// Exposes renderMermaid and renderMermaidAscii on window.__mermaid so they
// can be called from inline <script> tags in samples.html.
//
// Bundled via `Bun.build({ target: 'browser' })` in index.ts.
// ============================================================================

import { renderMermaid } from './index.ts'
import { renderMermaidAscii } from './ascii/index.ts'
import { THEMES } from './theme.ts'

;(window as unknown as Record<string, unknown>).__mermaid = {
  renderMermaid,
  renderMermaidAscii,
  THEMES,
}
