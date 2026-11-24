/**
 * PR watcher tool callbacks — backend implementation of the agent-facing PR tools (pr_status,
 * pr_bind, pr_unbind, pr_set_auto_merge). SessionManager wires one instance per session, bound to the
 * invoking session, into the session-scoped tool callback registry.
 *
 * All orchestration (verify-before-persist, aggregate, auto-merge, cross-session cache) lives in the
 * shared ops (`./operations`), the SAME code the prWatch RPC handlers use — the two paths cannot
 * drift. bind / unbind / set-auto-merge always act on the invoking session; status can read another
 * session's persisted PRs without a live fetch.
 */

import type { PrWatchToolCallbacks } from '@craft-agent/session-tools-core'
import type { ISessionManager } from '../handlers/session-manager-interface'
import type { PrWatchRegistry } from '../services/pr-watch/registry'
import type { AutoFixMonitor } from './auto-fix'
import { createPrWatchOps } from './operations'

export interface PrWatchToolCallbacksDeps {
  /** The invoking session; bind / unbind / auto-merge act on it, status defaults to it. */
  sessionId: string
  sessionManager: ISessionManager
  /** The live registry (recreated on handler re-registration), resolved at call time. */
  getRegistry: () => PrWatchRegistry | null
  /** The live auto-fix monitor, re-synced when an unbind drops a PR's auto-fix. */
  getAutoFixMonitor?: () => AutoFixMonitor | null
}

export function buildPrWatchToolCallbacks(deps: PrWatchToolCallbacksDeps): PrWatchToolCallbacks {
  function ops() {
    const registry = deps.getRegistry()
    if (!registry) throw new Error('PR watcher is not running on this server.')
    return createPrWatchOps(registry, deps.sessionManager, {
      onMonitorsChanged: sessionId => void deps.getAutoFixMonitor?.()?.sync(sessionId),
    })
  }

  return {
    async status(input) {
      const target = input.sessionId ?? deps.sessionId
      // Only the invoking session fetches live; another session is cache-only (R3).
      return ops().status(target, { forceFetch: target === deps.sessionId })
    },
    async bind(input) {
      return ops().bind(deps.sessionId, input.ref, { skipBranchPr: input.skipBranchPr })
    },
    async unbind(input) {
      return ops().unbind(deps.sessionId, input.ref)
    },
    async setAutoMerge(input) {
      return ops().setAutoMerge(deps.sessionId, input.ref, input.enabled, input.method)
    },
  }
}
