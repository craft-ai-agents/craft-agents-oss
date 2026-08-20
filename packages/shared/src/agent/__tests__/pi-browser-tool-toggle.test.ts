/**
 * Pi `browser_tool` toggle test.
 *
 * Verifies that when `getBrowserToolEnabled()` returns false, the Pi backend
 * filters `mcp__session__browser_tool` out of its session tool registration —
 * matching Claude's existing gate.
 *
 * The filter lives in the shared `buildSessionToolDefs` builder
 * (session-tool-defs.ts), which PiAgent uses in
 * `registerSessionToolsWithSubprocess`. To avoid spinning up a full
 * subprocess, we do a textual contract check on both source files. If the
 * filter line is removed or the tool name renamed, the test fails so the
 * regression is caught.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('pi-agent browser_tool toggle (contract)', () => {
  const piAgentSource = readFileSync(join(__dirname, '..', 'pi-agent.ts'), 'utf-8')
  const defsSource = readFileSync(join(__dirname, '..', 'session-tool-defs.ts'), 'utf-8')

  it('builds session tool defs via the shared builder', () => {
    expect(piAgentSource).toContain('buildSessionToolDefs')
    expect(piAgentSource).toMatch(/from ['"]\.\/session-tool-defs(\.ts)?['"]/)
  })

  it('builder imports getBrowserToolEnabled from config storage', () => {
    expect(defsSource).toContain('getBrowserToolEnabled')
    expect(defsSource).toMatch(/from ['"]\.\.\/config\/storage(\.ts)?['"]/)
  })

  it('builder filters mcp__session__browser_tool when toggle is off', () => {
    // The filter must be applied after getSessionToolProxyDefs() is called.
    expect(defsSource).toContain('getSessionToolProxyDefs()')
    expect(defsSource).toContain('!getBrowserToolEnabled()')
    expect(defsSource).toContain("d.name !== 'mcp__session__browser_tool'")
  })
})
