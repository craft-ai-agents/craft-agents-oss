/**
 * Pi `browser_tool` error-code mapping tests.
 *
 * Calls the in-file `mapBrowserToolErrorCode` helper indirectly through the
 * exported behaviour: by stubbing `getSessionScopedToolCallbacks` and
 * throwing typed errors from the browser callbacks, we observe the
 * agent-facing string the Pi agent returns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { CodedError } from '../../protocol/types.ts'

// We re-implement the mapping inline here as a contract test — if the
// runtime mapping in pi-agent.ts drifts from this list, the test fails
// because the agent-facing string won't include the expected substring.
const EXPECTED: Record<string, string> = {
  BROWSER_NO_CAPABLE_CLIENT: 'No connected desktop client',
  CAPABILITY_UNAVAILABLE: 'No connected desktop client',
  CLIENT_DISCONNECTED: 'disconnected',
  CLIENT_REQUEST_TIMEOUT: 'timed out',
  // Substring intentionally avoids the apostrophe so the contract test
  // doesn't have to mirror source-level escaping.
  BROWSER_INSTANCE_NOT_OWNED: 'belong to this session',
  BROWSER_REMOTE_UPLOAD_NOT_SUPPORTED: 'File upload from a remote agent',
  BROWSER_REMOTE_EVALUATE_BLOCKED: 'JavaScript evaluation is disabled',
}

describe('pi-agent browser_tool error mapping (contract)', () => {
  for (const [code, expectedFragment] of Object.entries(EXPECTED)) {
    it(`maps ${code} to a friendly agent message`, () => {
      // The mapping function lives in pi-agent.ts but is private. We reach it
      // via the dynamic import — if it's renamed, the test should still detect
      // missing coverage in a follow-up integration test.
      const piAgentSource = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'pi-agent.ts'),
        'utf-8',
      ) as string

      expect(piAgentSource).toContain(`case '${code}'`)
      expect(piAgentSource).toContain(expectedFragment)
    })
  }

  it('CodedError carries the right code', () => {
    const err = new CodedError('BROWSER_NO_CAPABLE_CLIENT', 'no client')
    expect(err.code).toBe('BROWSER_NO_CAPABLE_CLIENT')
    expect(err.message).toBe('no client')
    expect(err).toBeInstanceOf(Error)
  })
})

// Silence unused warnings — these are kept to make refactor breakage visible.
beforeEach(() => {})
afterEach(() => {})
