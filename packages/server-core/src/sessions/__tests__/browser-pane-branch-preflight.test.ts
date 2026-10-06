import { describe, expect, it } from 'bun:test'
import { SessionManager } from '../SessionManager.ts'
import { RemoteBrowserPaneManager } from '../RemoteBrowserPaneManager.ts'

// Regression test for:
//   "Could not create branch: Browser pane manager unavailable despite passing
//    the gate — this is a bug."
//
// On a remote/RPC deployment, the sdk-fork branch preflight calls
// getOrCreateAgent() — which wires browser-pane tools via
// getBrowserPaneManagerForSession() — BEFORE the session is registered in
// this.sessions. The remote resolver used to read workspace.id off the
// (missing) session and return null, tripping the "passed the gate" invariant.
//
// The resolver now accepts a workspaceId fallback so it can build the remote
// bridge even when the session is not yet registered.
describe('getBrowserPaneManagerForSession — branch preflight', () => {
  it('builds a remote bridge from the workspaceId fallback when the session is not registered', () => {
    const sm = new SessionManager()
    sm.setRpcServer({} as never) // remote path: rpcServer present, no local BPM

    const bpm = sm.getBrowserPaneManagerForSession('unregistered-session', {
      workspaceId: 'ws_test',
    })

    expect(bpm).not.toBeNull()
    expect(bpm).toBeInstanceOf(RemoteBrowserPaneManager)
  })

  it('returns null only when there is neither a local BPM, a session, nor a workspaceId fallback', () => {
    const sm = new SessionManager()
    sm.setRpcServer({} as never)

    expect(sm.getBrowserPaneManagerForSession('unregistered-session')).toBeNull()
  })
})
