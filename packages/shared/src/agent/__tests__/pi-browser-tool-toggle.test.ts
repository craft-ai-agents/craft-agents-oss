/**
 * Pi `browser_tool` toggle test.
 *
 * Verifies that when `getBrowserToolEnabled()` returns false, the Pi backend
 * filters `mcp__session__browser_tool` out of its session tool registration —
 * matching Claude's existing gate.
 *
 * The filter lives in `PiAgent.registerSessionToolsWithSubprocess` (inline,
 * not exported). To avoid spinning up a full subprocess, we do a textual
 * contract check on the source file. If the filter line is removed or the
 * tool name renamed, the test fails so the regression is caught.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('pi-agent browser_tool toggle (contract)', () => {
  const piAgentSource = readFileSync(join(__dirname, '..', 'pi-agent.ts'), 'utf-8')

  it('imports getBrowserToolEnabled from config storage', () => {
    expect(piAgentSource).toContain('getBrowserToolEnabled')
    expect(piAgentSource).toMatch(/from ['"]\.\.\/config\/storage(\.ts)?['"]/)
  })

  it('filters mcp__session__browser_tool when toggle is off', () => {
    // The filter must be applied after getSessionToolProxyDefs() is called.
    expect(piAgentSource).toContain('!getBrowserToolEnabled()')
    expect(piAgentSource).toContain("d.name !== 'mcp__session__browser_tool'")
  })
})
