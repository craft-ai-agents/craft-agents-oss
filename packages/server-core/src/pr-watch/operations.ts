/**
 * PR watcher operations — the one place pr_bind / pr_unbind / pr_status / pr_set_auto_merge are
 * carried out, shared by the renderer RPC handlers (`handlers/rpc/pr-watch.ts`) and the agent-tool
 * bridge (`pr-watch/tool-callbacks.ts`) so the two paths can never drift.
 *
 * Invariants:
 *  - R1: bind verifies the PR (resolve a credential + fetch it once) BEFORE persisting. No dead chips.
 *  - R2: per-entry availability is the registry's job (a bound PR resolves even when the folder isn't a repo).
 *  - R3: cross-session status never forces a fetch — it returns the live aggregate if the target
 *    session already has watchers, else the persisted bindings as a cache-only list.
 *
 * Credentials and GitHub calls stay in the registry; results are plain data (no tokens).
 */

import type { PrAutoFixResult, PrMergeMethod, PrMonitorState, PrSummary, PrWatchSessionState } from '@craft-agent/shared/protocol'
import { canFixLocally, prEntryId } from '@craft-agent/shared/pr-watch'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type {
  PrAutoMergeToolResult,
  PrBindToolResult,
  PrToolStatus,
  PrToolStatusResult,
  PrUnbindToolResult,
} from '@craft-agent/session-tools-core'
import type { ISessionManager } from '../handlers/session-manager-interface'
import { resolveRepo as defaultResolveRepo, type RepoInfo } from '../services/pr-watch/local-git'
import { parsePrReference } from '../services/pr-watch/pr-ref'
import type { PrWatchRegistry } from '../services/pr-watch/registry'
import type { RepoCoordinates } from '../services/pr-watch/remote-url'

export interface PrWatchOps {
  /** `forceFetch` (current session) resolves live state; otherwise cache-only (R3). */
  status(sessionId: string, options: { forceFetch: boolean }): Promise<PrToolStatusResult>
  /** `skipBranchPr`: leave out the folder's own branch PR (the post-tool hook after `gh pr create`). */
  bind(sessionId: string, ref: string, options?: { skipBranchPr?: boolean }): Promise<PrBindToolResult>
  unbind(sessionId: string, ref: string): Promise<PrUnbindToolResult>
  setAutoMerge(sessionId: string, ref: string, enabled: boolean, method?: PrMergeMethod): Promise<PrAutoMergeToolResult>
  /** Turn auto-fix (the card's Fix toggle) on/off for one of the session's PRs, by its entry id; on needs the branch PR. */
  setAutoFix(sessionId: string, prId: string, enabled: boolean): Promise<PrAutoFixResult>
}

/** `monitor` is the PR's auto-fix state; it is reported for the branch PR only, the one auto-fix acts on. */
function toToolStatus(id: string, origin: 'branch' | 'bound', summary: PrSummary, monitor?: PrMonitorState): PrToolStatus {
  const autoFix = !!monitor?.autoFix && canFixLocally(origin)
  return {
    id,
    origin,
    number: summary.number,
    title: summary.title,
    url: summary.url,
    state: summary.state,
    checks: summary.checks,
    reviewDecision: summary.reviewDecision,
    mergeState: summary.mergeState,
    unresolvedThreads: summary.unresolvedThreads,
    localAhead: summary.localAhead,
    localDirty: summary.localDirty,
    ...(summary.autoMerge ? { autoMerge: summary.autoMerge } : {}),
    ...(summary.autoMergeBlocked ? { autoMergeBlocked: summary.autoMergeBlocked } : {}),
    ...(autoFix ? { autoFix: true } : {}),
    via: summary.via,
  }
}

function toStatusResult(sessionId: string, state: PrWatchSessionState, cached: boolean, monitors: Record<string, PrMonitorState>): PrToolStatusResult {
  if (state.kind === 'ready') {
    return { kind: 'ready', sessionId, prs: state.prs.map(e => toToolStatus(e.id, e.origin, e.summary, monitors[e.id])), cached }
  }
  if (state.kind === 'unavailable') return { kind: 'unavailable', sessionId, reason: state.reason, prs: [] }
  return { kind: state.kind, sessionId, prs: [] }
}

export interface PrWatchOpsDeps {
  /** Workspace root for a session's workspaceId; defaults to getWorkspaceByNameOrId. Injectable for tests. */
  resolveWorkspaceRootPath?: (workspaceId: string) => string | null
  /** A session's monitor state changed (auto-fix toggled, a PR unbound): re-sync the auto-fix monitor. */
  onMonitorsChanged?: (sessionId: string) => void
  /** Local git lookup; injectable for tests. */
  resolveRepo?: (dir: string) => Promise<RepoInfo | null>
}

function sameRepo(a: RepoCoordinates | null, b: RepoCoordinates): boolean {
  return !!a && `${a.host}/${a.owner}/${a.repo}`.toLowerCase() === `${b.host}/${b.owner}/${b.repo}`.toLowerCase()
}

/** A carousel entry id as the registry builds it (`prEntryId`): `host/owner/repo#number`. */
const PR_ENTRY_ID = /^[^/\s]+\/[^/\s]+\/[^#\s]+#\d+$/

export function createPrWatchOps(registry: PrWatchRegistry, sessionManager: ISessionManager, deps: PrWatchOpsDeps = {}): PrWatchOps {
  const workspaceRoot = deps.resolveWorkspaceRootPath ?? ((workspaceId: string) => getWorkspaceByNameOrId(workspaceId)?.rootPath ?? null)
  const resolveRepo = deps.resolveRepo ?? defaultResolveRepo

  /** The session folder's git checkout, or null. */
  async function sessionRepo(sessionId: string, workingDirectory?: string): Promise<RepoInfo | null> {
    const dir = sessionManager.getSessionWorkingDirectory(sessionId) ?? workingDirectory
    if (!dir) return null
    return resolveRepo(dir).catch(() => null)
  }

  /** Repo coordinates of the session's own checkout, for resolving bare-number refs. */
  async function sessionRepoCoords(sessionId: string, workingDirectory?: string) {
    return (await sessionRepo(sessionId, workingDirectory))?.repo ?? null
  }

  return {
    async status(sessionId, { forceFetch }) {
      const session = sessionManager.getSessionSnapshot(sessionId)
      if (!session) return { kind: 'none', sessionId, prs: [], reason: 'session-not-found' }
      const rootPath = workspaceRoot(session.workspaceId)
      if (!rootPath) return { kind: 'unavailable', sessionId, prs: [], reason: 'workspace-not-found' }
      const boundPrs = sessionManager.getSessionBoundPrs(sessionId)

      if (!forceFetch) {
        // R3: another session — prefer its live aggregate, never force a network fetch.
        const cached = registry.cachedSessionState(sessionId)
        if (cached) return toStatusResult(sessionId, cached, true, sessionManager.getSessionPrMonitors(sessionId))
        return {
          kind: boundPrs.length ? 'ready' : 'none',
          sessionId,
          cached: true,
          prs: boundPrs.map(bp => ({
            id: prEntryId(bp),
            origin: 'bound' as const,
            number: bp.number,
            title: '(not fetched)',
            url: `https://${bp.host}/${bp.owner}/${bp.repo}/pull/${bp.number}`,
            state: 'unknown',
            checks: 'none',
            reviewDecision: 'none',
            mergeState: 'unknown',
            unresolvedThreads: 0,
            localAhead: 0,
            localDirty: false,
            via: '(cached)',
          })),
        }
      }

      const dir = sessionManager.getSessionWorkingDirectory(sessionId) ?? session.workingDirectory
      if (!dir) return { kind: 'unavailable', sessionId, prs: [], reason: 'not-git' }
      const state = await registry.fetchOnce({ dir, workspaceRootPath: rootPath, boundPrs })
      return toStatusResult(sessionId, state, false, sessionManager.getSessionPrMonitors(sessionId))
    },

    async bind(sessionId, ref, options) {
      const session = sessionManager.getSessionSnapshot(sessionId)
      if (!session) return { ok: false, error: 'Session not found.' }
      const rootPath = workspaceRoot(session.workspaceId)
      if (!rootPath) return { ok: false, error: 'Workspace not found.' }

      const fallback = await sessionRepoCoords(sessionId, session.workingDirectory)
      const parsed = parsePrReference(ref, fallback)
      if (!parsed) {
        return { ok: false, error: `Couldn't read "${ref}" as a PR. Use a full PR URL, owner/repo#123, or a number for this repo.` }
      }

      // R1: verify before persisting.
      let summary: PrSummary
      try {
        summary = await registry.verifyPr({ coords: parsed, number: parsed.number, workspaceRootPath: rootPath })
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to verify the PR.' }
      }

      // The folder's own branch PR is in the carousel already: the post-tool hook doesn't pin it
      if (options?.skipBranchPr) {
        const checkout = await sessionRepo(sessionId, session.workingDirectory)
        const onBranch = !!checkout && (checkout.remoteBranch ?? checkout.branch) === summary.headRef
        if (onBranch && (sameRepo(checkout.repo, parsed) || sameRepo(checkout.upstreamRepo, parsed))) {
          return { ok: true, skipped: 'branch-pr', pr: toToolStatus(prEntryId(parsed), 'branch', summary), boundCount: sessionManager.getSessionBoundPrs(sessionId).length }
        }
      }

      const boundPrs = sessionManager.bindPrToSession(sessionId, {
        host: parsed.host, owner: parsed.owner, repo: parsed.repo, number: parsed.number, addedAt: Date.now(),
      })
      registry.setSessionBoundPrs(sessionId, boundPrs)
      return { ok: true, pr: toToolStatus(prEntryId(parsed), 'bound', summary), boundCount: boundPrs.length }
    },

    async unbind(sessionId, ref) {
      const session = sessionManager.getSessionSnapshot(sessionId)
      if (!session) return { ok: false, error: 'Session not found.' }
      const fallback = await sessionRepoCoords(sessionId, session.workingDirectory)
      const parsed = parsePrReference(ref, fallback)
      if (!parsed) return { ok: false, error: `Couldn't read "${ref}" as a PR.` }

      const before = sessionManager.getSessionBoundPrs(sessionId).length
      const boundPrs = sessionManager.unbindPrFromSession(sessionId, parsed)
      registry.setSessionBoundPrs(sessionId, boundPrs)
      // The PR's auto-fix went with it
      registry.setSessionMonitors(sessionId, sessionManager.getSessionPrMonitors(sessionId))
      deps.onMonitorsChanged?.(sessionId)
      return { ok: true, removed: boundPrs.length < before, boundCount: boundPrs.length }
    },

    async setAutoMerge(sessionId, ref, enabled, method) {
      const session = sessionManager.getSessionSnapshot(sessionId)
      if (!session) return { ok: false, error: 'Session not found.' }
      const rootPath = workspaceRoot(session.workspaceId)
      if (!rootPath) return { ok: false, error: 'Workspace not found.' }
      const fallback = await sessionRepoCoords(sessionId, session.workingDirectory)
      const parsed = parsePrReference(ref, fallback)
      if (!parsed) return { ok: false, error: `Couldn't read "${ref}" as a PR.` }

      try {
        const state = await registry.setAutoMerge({ coords: parsed, number: parsed.number, workspaceRootPath: rootPath, enabled, method })
        // Reflect the change on the chip without waiting for the next poll.
        await registry.nudge(sessionId)
        return { ok: true, enabled: state.enabled, method: state.method }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to change auto-merge.' }
      }
    },

    async setAutoFix(sessionId, prId, enabled) {
      const session = sessionManager.getSessionSnapshot(sessionId)
      if (!session) return { ok: false, error: 'Session not found.' }
      if (!session.codingMode) return { ok: false, error: 'Auto-fix needs a Coding mode session.' }
      if (!PR_ENTRY_ID.test(prId)) return { ok: false, error: `Not a PR id: "${prId}".` }
      const id = prId.toLowerCase()
      // Turning it on needs the branch's own PR (its fixes run on this checkout); turning it off always works
      if (enabled) {
        const state = registry.cachedSessionState(sessionId)
        const entry = state?.kind === 'ready' ? state.prs.find(e => e.id === id) : undefined
        if (!entry) return { ok: false, error: `${id} isn't one of this session's PRs right now.` }
        if (!canFixLocally(entry.origin)) {
          return { ok: false, error: "Auto-fix works on the branch's own PR only: its fixes run on this folder's checkout, and a pinned PR's branch isn't checked out here." }
        }
      }
      const monitors = sessionManager.setSessionPrAutoFix(sessionId, id, enabled)
      registry.setSessionMonitors(sessionId, monitors)
      deps.onMonitorsChanged?.(sessionId)
      return { ok: true, enabled }
    },
  }
}
