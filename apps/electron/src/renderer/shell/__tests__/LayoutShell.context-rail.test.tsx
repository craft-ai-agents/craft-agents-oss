/**
 * The "Session context" rail used to render hardcoded values ("ARCH Builder",
 * "Owner Auto", "Auto select", a Memory meter) regardless of the actual
 * session — it reported state that was simply not true.
 *
 * These tests pin the two properties that matter:
 *   1. the rail reflects the session it is given, and
 *   2. with no session it says so, rather than showing a plausible default.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'bun:test'
import LayoutShell, { type ShellSessionContext } from '../LayoutShell'

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
