/**
 * Server-side `media:list` handler.
 *
 * Replaces the renderer's previous fan-out (one `getSessionFiles` per 24
 * sessions, walking each returned tree on the renderer to classify-and-
 * flatten) with a single cursor-paginated RPC that does the work server-side.
 *
 * The handler:
 *   1. Resolves the caller's workspace from ctx.workspaceId (same pattern as
 *      the session handlers; no explicit workspaceId arg → cross-workspace
 *      scraping isn't possible).
 *   2. Reads the workspace's session list via sessionManager.getSessions(),
 *      filtered to non-hidden + non-archived, sorted by lastMessageAt desc.
 *   3. Applies the opaque cursor (skips sessions that come before it).
 *   4. Walks each remaining session's directory tree with the shared
 *      `scanSessionDirectory(..., kindFilter)` helper from ./sessions — it
 *      short-circuits non-matching extensions BEFORE stat'ing, so a
 *      kind='image' filter on a docs-heavy workspace is cheap.
 *   5. Classifies each file via the server's `classifyMedia`, tags it with
 *      sessionId + sessionTitle + lastMessageAt, emits into the page up to
 *      `limit` items. Aborts the moment the page fills.
 *   6. Returns `{ items, hasMore, nextCursor }`. `nextCursor` is the
 *      `(lastMessageAt, sessionId)` of the most recent fully-scanned session
 *      when more sessions remain; null otherwise. LastMessageAt is encoded
 *      alongside sessionId so a same-timestamp inserted session lands in a
 *      stable spot.
 *
 * Threads ctx.signal into the recursive walker. A mid-scan cancel propagates
 * as an Error(name='AbortError'); the RPC layer translates that to a
 * HANDLER_ERROR reply — the renderer's local promise has already been
 * rejected by its AbortSignal listener.
 */

import type { RpcServer } from '@archstudio/server-core/transport'
import {
  RPC_CHANNELS,
  type MediaItem,
  type MediaListPage,
  type MediaListRequest,
  type SessionFile,
} from '@archstudio/shared/protocol'
import type { HandlerDeps } from '../handler-deps'
import { classifyMedia, makeAbortError, scanSessionDirectory } from './sessions'

/** Default page size; sized to amortize round-trips without bloating a single
 *  payload (≈12k chars for a 200-item page of medium-large metadata — well
 *  under the WS JSON envelope's comfortable range). */
const DEFAULT_LIMIT = 200
/** Hard ceiling; a runaway client can't pull the workspace in one call. */
const MAX_LIMIT = 500
/** Per-call sessions-visited cap. Sized to MAX_LIMIT / 2 so a worst-case
 *  1-item-per-session walk (e.g. `kind: 'video'` on a docs-heavy workspace)
 *  is bounded to ~half the items cap, and a 10k-session workspace under
 *  such a filter exhausts in ~100 round-trips instead of 20 of 500×N work. */
const SESSIONS_PER_VISIT_CAP = Math.floor(MAX_LIMIT / 2)

export const HANDLED_CHANNELS = [RPC_CHANNELS.media.LIST] as const

/**
 * Server-side cursor encoding. Format: base64url-encoded JSON
 *   `{"t": <lastMessageAtMs>, "s": <sessionId>}`.
 *
 * Opaque to clients. There's no guarantee this format stays the same; they
 * MUST pass it through untouched. Base64url is used (not a naïve
 * `"<ts>:<id>"` string) so session ids containing colons (or other
 * punctuation) can't collide with the separator.
 */
function encodeCursor(lastMessageAt: number, sessionId: string): string {
  return Buffer.from(JSON.stringify({ t: lastMessageAt, s: sessionId }), 'utf-8').toString('base64url')
}

function decodeCursor(cursor: string): { lastMessageAt: number; sessionId: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as { t?: unknown; s?: unknown }
    if (typeof decoded.t !== 'number' || typeof decoded.s !== 'string' || !decoded.s) return null
    return { lastMessageAt: decoded.t, sessionId: decoded.s }
  } catch {
    return null
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

export function registerMediaHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(RPC_CHANNELS.media.LIST, async (ctx, request: MediaListRequest = {}): Promise<MediaListPage> => {
    // Fast-exit on already-aborted requests — saves a workspace fetch.
    if (ctx.signal.aborted) {
      return { items: [], hasMore: false, nextCursor: null }
    }

    const limit = clampLimit(request.limit ?? DEFAULT_LIMIT)
    const kind = request.kind
    const after = request.cursor ? decodeCursor(request.cursor) : null

    try {
      await deps.sessionManager.waitForInit()
    } catch (error) {
      // Best-effort; log and continue with whatever sessions we already have.
      log.error('media:list continuing after initialization failure:', error)
    }

    const windowWorkspaceId =
      ctx.webContentsId != null
        ? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId)
        : undefined
    const workspaceId = ctx.workspaceId ?? windowWorkspaceId
    const allSessions = deps.sessionManager.getSessions(workspaceId ?? undefined) ?? []

    // Same comparator the renderer used previously: lastMessageAt desc,
    // createdAt desc fallback, drop hidden + archived. Stable tie-breaker
    // by id asc so the cursor predicate below is deterministic when many
    // sessions share the same ts.
    const sessions = allSessions
      .filter((s) => !s.hidden && !s.isArchived)
      .sort((a, b) => {
        const aTs = a.lastMessageAt ?? a.createdAt ?? 0
        const bTs = b.lastMessageAt ?? b.createdAt ?? 0
        if (aTs !== bTs) return bTs - aTs
        return a.id.localeCompare(b.id)
      })

    // Skip sessions at-or-before the cursor's position. Fast path: cursor's
    // session is still present — skip strictly past it. Fallback: cursor's
    // session was deleted concurrently; walk the (ts, id) tuple so we still
    // skip past already-seen items instead of restarting from page 0
    // (which would render content twice).
    let startIdx = 0
    if (after) {
      const cursorIdx = sessions.findIndex((s) => s.id === after.sessionId)
      if (cursorIdx >= 0) {
        startIdx = cursorIdx + 1
      } else {
        startIdx = sessions.findIndex((s) => {
          const sTs = s.lastMessageAt ?? s.createdAt ?? 0
          if (sTs < after.lastMessageAt) return true
          if (sTs > after.lastMessageAt) return false
          // Equal ts: sort tie-breaks by id asc, so "after" the cursor's id
          // means a strictly greater id.
          return s.id > after.sessionId
        })
        if (startIdx < 0) startIdx = sessions.length
      }
    }

    const items: MediaItem[] = []
    let lastVisited: { lastMessageAt: number; sessionId: string } | null = null
    let moreSessions = false

    try {
      for (let i = startIdx; i < sessions.length; i++) {
        // Fast-exit on abort between sessions — saves the next session's
        // directory walk (the scanner checks again internally, but no
        // point entering it if we already know we're cancelled).
        if (ctx.signal.aborted) throw makeAbortError()
        // Per-call sessions-visited cap — separate from the items cap.
        // Bounds work even when a kind filter (e.g. 'video') matches
        // nothing in the visited sessions, so we don't walk the whole
        // 10k-session workspace before returning an empty page.
        if (i - startIdx >= SESSIONS_PER_VISIT_CAP) {
          moreSessions = true
          break
        }
        if (items.length >= limit) {
          moreSessions = true
          break
        }

        const session = sessions[i]
        const sessionPath = deps.sessionManager.getSessionPath(session.id)
        if (!sessionPath) {
          // No on-disk folder for this session — still mark it visited so
          // the cursor advances past it.
          lastVisited = {
            lastMessageAt: session.lastMessageAt ?? session.createdAt ?? 0,
            sessionId: session.id,
          }
          continue
        }

        const sessionMeta = {
          sessionId: session.id,
          sessionTitle: session.name || session.preview || session.id,
          lastMessageAt: session.lastMessageAt ?? session.createdAt ?? 0,
        }

        const collected = await collectMediaFromSession(sessionPath, kind, limit - items.length, ctx.signal, sessionMeta)
        if (collected.length > 0) {
          items.push(...collected)
        }
        // Always mark visited — even a zero-match session must move the cursor
        // forward or a workspace with many empty dirs would loop forever.
        lastVisited = {
          lastMessageAt: session.lastMessageAt ?? session.createdAt ?? 0,
          sessionId: session.id,
        }
      }
    } catch (error) {
      // Abort propagates as HANDLER_ERROR per the protocol contract. Other
      // errors are unexpected — surface them but preserve the cursor so a
      // retry resumes correctly.
      if ((error as { name?: string } | null)?.name === 'AbortError') throw error
      log.error('media:list failed mid-iteration:', error)
      throw error
    }

    return {
      items,
      hasMore: moreSessions,
      nextCursor:
        moreSessions && lastVisited
          ? encodeCursor(lastVisited.lastMessageAt, lastVisited.sessionId)
          : null,
    }
  })
}

/**
 * Recursively walk a session directory and emit classified `MediaItem`
 * entries up to `capacity`. Specialization of the renderer's previous
 * `walk()` + `classify()` flow — uses the server-side `classifyMedia` so
 * the EXT map and rule order stay in lockstep with the kind filter.
 */
async function collectMediaFromSession(
  sessionPath: string,
  kind: MediaItem['kind'] | undefined,
  capacity: number,
  signal: AbortSignal,
  meta: { sessionId: string; sessionTitle: string; lastMessageAt: number },
): Promise<MediaItem[]> {
  if (capacity <= 0) return []
  if (signal.aborted) throw makeAbortError()

  const tree = await scanSessionDirectory(sessionPath, signal, kind)
  if (signal.aborted) throw makeAbortError()

  const out: MediaItem[] = []
  for (const node of tree) {
    if (out.length >= capacity) break
    flattenInto(node, out, meta, kind)
  }
  return out
}

function flattenInto(
  node: SessionFile,
  out: MediaItem[],
  meta: { sessionId: string; sessionTitle: string; lastMessageAt: number },
  kind: MediaItem['kind'] | undefined,
): void {
  if (node.type === 'file') {
    // When the server filtered by a single kind the file already matches that
    // kind; we still call classifyMedia in the unfiltered case to get the
    // tag, which keeps a single emit path.
    const itemKind = kind ?? classifyMedia(node.name)
    if (!itemKind) return
    out.push({
      name: node.name,
      path: node.path,
      size: node.size,
      mtime: node.mtime,
      kind: itemKind,
      sessionId: meta.sessionId,
      sessionTitle: meta.sessionTitle,
      lastMessageAt: meta.lastMessageAt,
    })
    return
  }
  if (node.type === 'directory' && node.children) {
    for (const child of node.children) flattenInto(child, out, meta, kind)
  }
}
