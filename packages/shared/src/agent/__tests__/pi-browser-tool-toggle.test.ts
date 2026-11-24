/**
 * Pi `browser_tool` toggle test.
 *
 * Verifies that when `getBrowserToolEnabled()` returns false, the Pi backend
 * does not register `mcp__session__browser_tool` — matching Claude's gate.
 *
 * Both backends filter through `getSessionToolDefs` (session-tools-core), whose
 * `includeBrowser` option is covered by tool-defs-filtering.test.ts. Pi reaches it
 * through `getSessionToolProxyDefs` (backend/pi/session-tool-defs.ts) during
 * subprocess setup. To avoid spinning up a full subprocess, we do a textual
 * contract check that the gate is still wired; if the setting is no longer passed
 * or Pi stops using the shared helper, the test fails so the regression is caught.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('pi-agent browser_tool toggle (contract)', () => {
  const piAgentSource = readFileSync(join(__dirname, '..', 'pi-agent.ts'), 'utf-8')
  const proxyDefsSource = readFileSync(join(__dirname, '..', 'backend', 'pi', 'session-tool-defs.ts'), 'utf-8')

  it('registers session tools through the shared proxy-defs helper', () => {
    expect(piAgentSource).toContain('getSessionToolProxyDefs(')
  })

  it('passes the built-in browser setting to the shared tool filter', () => {
    expect(proxyDefsSource).toMatch(/import \{ getBrowserToolEnabled \} from ['"]\.\.\/\.\.\/\.\.\/config\/storage(\.ts)?['"]/)
    expect(proxyDefsSource).toContain('includeBrowser: getBrowserToolEnabled()')
  })
})
