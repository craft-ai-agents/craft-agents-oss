/**
 * The "Session context" rail used to render hardcoded values ("ARCH Builder",
 * "Owner Auto", "Auto select", a Memory meter) regardless of the actual
 * session — it reported state that was simply not true.
 *
 * These tests pin the two properties that matter:
 *   1. the rail reflects the session it is given, and
 *   2. with no session it says so, rather than showing a plausible default.
 *
 * Test infrastructure
 * --------------------
 * Only `bun:test` is imported statically at the top. Everything else (the
 * LayoutShell module + `react-dom/server`) is dynamically imported inside
 * `beforeAll` AFTER the `mock.module` calls register. This is the same
 * pattern `mention-menu.test.ts` uses to defeat `pdfjs-dist`'s Vite-style
 * `?url` worker import under bun's test loader
 * ("Missing 'default' export in module '...pdf.worker.min.mjs?url'").
 */
// Vite-only imports (?url, .css, import.meta.glob) are stubbed by the
// `scripts/test-setup.ts` preload configured in bunfig.toml. We only need
// to dynamic-import LayoutShell itself here.
//
// IMPORTANT: this file holds NO static reference to LayoutShell or
// `react-dom/server`. bun's fast transpiler does not fully erase
// `import type` or `typeof import(...)` in TSX files, which would
// otherwise force a real module load before the mocks register.
// Instead we declare a local interface + use `any` for the bindings
// and resolve them inside `beforeAll`.
import { describe, expect, it, beforeAll } from 'bun:test'

// `./types` is a pure type module — no Vite-only imports — so it is safe to
// import statically here, unlike `../LayoutShell`.
import type { ShellSessionContext } from '../types'

let renderToStaticMarkup: any
let LayoutShell: any

beforeAll(async () => {
  const renderer = await import('react-dom/server')
  renderToStaticMarkup = renderer.renderToStaticMarkup
  LayoutShell = (await import('../LayoutShell')).default
})

const SESSION: ShellSessionContext = {
  sessionName: 'Add MCP Server',
  connectionLabel: 'Local Model',
  permissionModeLabel: 'Safe',
  modelLabel: 'deepseek-r1:14b',
  thinkingLabel: 'Medium',
  sourceNames: ['Gmail', 'Obsidian'],
  workingDirectory: 'D:/craft-agents-oss',
  isProcessing: true,
}

// The workspace (and therefore the rail) only renders when the shell has chat
// children to host.
const render = (ctx?: ShellSessionContext) =>
  renderToStaticMarkup(
    <LayoutShell initialView="command" sessionContext={ctx}>
      <div>chat</div>
    </LayoutShell>,
  )

describe('LayoutShell session context rail', () => {
  it('reports the real session, not hardcoded placeholders', () => {
    const html = render(SESSION)

    expect(html).toContain('Local Model')
    expect(html).toContain('Add MCP Server')
    expect(html).toContain('Safe')
    expect(html).toContain('deepseek-r1:14b')
    expect(html).toContain('Medium')
    expect(html).toContain('Gmail')
    expect(html).toContain('Obsidian')
    expect(html).toContain('D:/craft-agents-oss')
  })

  it('marks a processing session as running', () => {
    expect(render(SESSION)).toContain('Running')
    expect(render({ ...SESSION, isProcessing: false })).toContain('Idle')
  })

  it('never renders the old fabricated values', () => {
    const html = render(SESSION)

    // These were shown for every session regardless of its real state.
    expect(html).not.toContain('ARCH Builder')
    expect(html).not.toContain('Owner Auto')
    expect(html).not.toContain('Auto select')
  })

  it('says so when nothing is known, rather than inventing a default', () => {
    const html = render(undefined)

    expect(html).toContain('No session selected')
    expect(html).not.toContain('ARCH Builder')
    expect(html).not.toContain('Auto select')
  })

  it('states honestly that a session without sources has none', () => {
    const html = render({ ...SESSION, sourceNames: [] })

    expect(html).toContain('No sources enabled')
  })

  it('omits the working directory row when the session has none', () => {
    const html = render({ ...SESSION, workingDirectory: undefined })

    expect(html).not.toContain('Working directory')
  })
})
