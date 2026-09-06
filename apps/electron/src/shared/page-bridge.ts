/**
 * Page bridge protocol — the postMessage contract between a rendered Page
 * (opaque sandboxed iframe, srcDoc) and the trusted host (PageFrame).
 *
 * Trust model: the iframe runs with `sandbox="allow-scripts allow-forms"` and
 * NO `allow-same-origin`, so its origin is opaque (`event.origin === 'null'`)
 * and nothing it says can be trusted by shape alone. The host therefore
 * verifies, for every incoming message:
 *   1. `event.source` is exactly the frame's contentWindow (PageFrame's job),
 *   2. `event.origin === 'null'` (PageFrame's job),
 *   3. the message parses against this module's strict schema with bounded
 *      sizes (this module's job),
 *   4. privileged messages echo the render-lease nonce (PageFrame's job) —
 *      and the server-side PageActionBroker re-validates the lease, nonce,
 *      replay cache, and grant independently.
 *
 * Message flow (all envelopes carry `protocol: 'craft-pages/v1'`):
 *
 *   host → page
 *     init          { page: {slug, kind}, nonce, snapshot, grants }  on load / 'ready'
 *     data          { snapshot }                              live pages only
 *     action-result { result: PageActionResult }              response to 'action'
 *     grants        { grants: PageGrantSummary[] }            reply to 'grant-request' + on grant changes
 *
 *   page → host
 *     ready         {}                                        request (re-)init
 *     action        { requestId, nonce, grantId, invocation } execute a granted action
 *     action-cancel { requestId, nonce }                      abort an in-flight action
 *     open-url      { nonce, url }                            open http(s) link externally
 *     grant-request { nonce, requests: [{key, description?, action}] }
 *                                                             ask the user to approve source
 *                                                             actions (host shows a dialog)
 *
 * Descriptors come in three kinds (see PageActionDescriptor): `api`, `mcp`, and
 * `script`. A `script` descriptor runs a workspace-relative script on the HOST
 * — its invocation is a bare trigger (script/runtime/args live in the grant,
 * never in the page message) and it always counts as mutating.
 *
 * This module is deliberately pure (no React/DOM) so validation is unit-testable.
 */

import type {
  PageActionDescriptor,
  PageActionGrant,
  PageActionHttpMethod,
  PageActionInvocation,
  PageActionResult,
  PageDataSnapshot,
  PageKind,
} from '@craft-agent/shared/pages/types'
import { hasPathTraversal } from '@craft-agent/shared/pages/types'

export const PAGE_BRIDGE_PROTOCOL = 'craft-pages/v1'

// Bounded inputs: anything larger is dropped before further processing.
const MAX_MESSAGE_JSON_CHARS = 256 * 1024
const MAX_ID_CHARS = 128
const MAX_PATH_CHARS = 2048
const MAX_URL_CHARS = 2048
const MAX_TOOL_NAME_CHARS = 256
const MAX_OBJECT_DEPTH = 8
const MAX_GRANT_REQUESTS = 8
const MAX_GRANT_DESCRIPTION_CHARS = 500
const MAX_SCRIPT_ARGS = 32
const MAX_SCRIPT_ARG_CHARS = 2048

const HTTP_METHODS: readonly PageActionHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const SCRIPT_RUNTIMES = ['bun', 'node', 'python3'] as const

// ============================================================================
// Incoming (page → host)
// ============================================================================

/** One capability a page asks the user to approve. `key` is the page's own correlation id. */
export interface PageGrantRequestEntry {
  key: string
  description?: string
  action: PageActionDescriptor
}

export type PageBridgeIncoming =
  | { type: 'ready' }
  | { type: 'action'; requestId: string; nonce: string; grantId: string; invocation: PageActionInvocation }
  | { type: 'action-cancel'; requestId: string; nonce: string }
  | { type: 'open-url'; nonce: string; url: string }
  | { type: 'grant-request'; nonce: string; requests: PageGrantRequestEntry[] }

/**
 * What a page learns about an approved grant: enough to invoke it (id) and to
 * match it to a need (action descriptor + expiry) — never digests or internals.
 */
export interface PageGrantSummary {
  id: string
  action: PageActionDescriptor
  expiresAt: number
}

export function toGrantSummary(grant: PageActionGrant): PageGrantSummary {
  return { id: grant.id, action: grant.action, expiresAt: grant.expiresAt }
}

/**
 * Reconcile the frame's grant list against the usable grants from the page
 * config — the source of truth, so revoked grants disappear and grants issued
 * from other surfaces appear.
 *
 * The one exception is an approval made in THIS render that the config
 * watcher has not confirmed yet (`locallyIssuedIds`): its entry from
 * `current` is kept so buttons enable without waiting on the watcher. Once
 * the config confirms an issued id, it is removed from `locallyIssuedIds`
 * (the set is MUTATED by design — the caller owns it), so a later revocation
 * of that grant propagates like any other removal.
 */
export function reconcileGrantSummaries(
  current: PageGrantSummary[],
  fromConfig: PageGrantSummary[],
  locallyIssuedIds: Set<string>,
): PageGrantSummary[] {
  const configIds = new Set(fromConfig.map(g => g.id))
  for (const id of locallyIssuedIds) {
    if (configIds.has(id)) locallyIssuedIds.delete(id)
  }
  const pendingLocal = current.filter(g => locallyIssuedIds.has(g.id))
  return [...fromConfig, ...pendingLocal]
}

/** Set equality on grant ids — decides whether a reconcile warrants a `grants` push. */
export function grantIdsEqual(a: PageGrantSummary[], b: PageGrantSummary[]): boolean {
  if (a.length !== b.length) return false
  const ids = new Set(a.map(g => g.id))
  return b.every(g => ids.has(g.id))
}

/** Structural equality for grant descriptors (order-insensitive by field). */
export function descriptorEquals(a: PageActionDescriptor, b: PageActionDescriptor): boolean {
  if (a.kind === 'api' && b.kind === 'api') {
    return a.sourceSlug === b.sourceSlug && a.method === b.method && a.pathPattern === b.pathPattern
  }
  if (a.kind === 'mcp' && b.kind === 'mcp') {
    return a.sourceSlug === b.sourceSlug && a.toolName === b.toolName
  }
  if (a.kind === 'script' && b.kind === 'script') {
    return (
      a.script === b.script &&
      (a.runtime ?? 'bun') === (b.runtime ?? 'bun') &&
      argsEqual(a.args, b.args)
    )
  }
  return false
}

/** Order-sensitive array equality for pinned script args (undefined ≡ []). */
function argsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = a ?? []
  const y = b ?? []
  return x.length === y.length && x.every((v, i) => v === y[i])
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, maxChars: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxChars
}

/** Reject pathological nesting before it reaches JSON-RPC serialization. */
function withinDepth(value: unknown, depth: number): boolean {
  if (depth < 0) return false
  if (Array.isArray(value)) return value.every(v => withinDepth(v, depth - 1))
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).every(v => withinDepth(v, depth - 1))
  }
  return true
}

function parseInvocation(value: unknown): PageActionInvocation | null {
  if (!isPlainObject(value)) return null
  if (value.kind === 'api') {
    if (!HTTP_METHODS.includes(value.method as PageActionHttpMethod)) return null
    if (!isBoundedString(value.path, MAX_PATH_CHARS)) return null
    // Defense-in-depth: drop traversal paths at the parse boundary too (the
    // server-side broker re-checks authoritatively). Keeps `..` off onload/timer paths.
    if (hasPathTraversal(value.path)) return null
    if (value.params !== undefined && (!isPlainObject(value.params) || !withinDepth(value.params, MAX_OBJECT_DEPTH))) {
      return null
    }
    return {
      kind: 'api',
      method: value.method as PageActionHttpMethod,
      path: value.path,
      ...(value.params !== undefined ? { params: value.params as Record<string, unknown> } : {}),
    }
  }
  if (value.kind === 'mcp') {
    if (!isBoundedString(value.toolName, MAX_TOOL_NAME_CHARS)) return null
    if (value.args !== undefined && (!isPlainObject(value.args) || !withinDepth(value.args, MAX_OBJECT_DEPTH))) {
      return null
    }
    return {
      kind: 'mcp',
      toolName: value.toolName,
      ...(value.args !== undefined ? { args: value.args as Record<string, unknown> } : {}),
    }
  }
  if (value.kind === 'script') {
    // Pure trigger — carries nothing the host would act on. The grant supplies
    // script/runtime/args, so there is deliberately no payload to validate.
    return { kind: 'script' }
  }
  return null
}

/** Validate an untrusted grant descriptor (what a page may ASK for). */
function parseDescriptor(value: unknown): PageActionDescriptor | null {
  if (!isPlainObject(value)) return null
  if (value.kind === 'api') {
    if (!isBoundedString(value.sourceSlug, MAX_ID_CHARS)) return null
    if (!HTTP_METHODS.includes(value.method as PageActionHttpMethod)) return null
    if (!isBoundedString(value.pathPattern, MAX_PATH_CHARS)) return null
    return {
      kind: 'api',
      sourceSlug: value.sourceSlug,
      method: value.method as PageActionHttpMethod,
      pathPattern: value.pathPattern,
    }
  }
  if (value.kind === 'mcp') {
    if (!isBoundedString(value.sourceSlug, MAX_ID_CHARS)) return null
    if (!isBoundedString(value.toolName, MAX_TOOL_NAME_CHARS)) return null
    return { kind: 'mcp', sourceSlug: value.sourceSlug, toolName: value.toolName }
  }
  if (value.kind === 'script') {
    const script = parseScriptPath(value.script)
    if (!script) return null
    const runtime = parseScriptRuntime(value.runtime)
    if (runtime === null) return null
    const args = parseScriptArgs(value.args)
    if (args === null) return null
    return {
      kind: 'script',
      script,
      ...(runtime !== undefined ? { runtime } : {}),
      ...(args !== undefined ? { args } : {}),
    }
  }
  return null
}

/**
 * Validate a page-supplied script path: bounded, relative, no ".." escape.
 * The server re-validates with symlink resolution — this just rejects the
 * obvious escapes before the descriptor is ever persisted as a grant.
 */
function parseScriptPath(value: unknown): string | null {
  if (!isBoundedString(value, MAX_PATH_CHARS)) return null
  if (value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)) return null
  if (value.split(/[\\/]/).includes('..')) return null
  return value
}

/** undefined when absent (valid), the runtime when valid, null when invalid. */
function parseScriptRuntime(value: unknown): (typeof SCRIPT_RUNTIMES)[number] | undefined | null {
  if (value === undefined) return undefined
  return SCRIPT_RUNTIMES.includes(value as (typeof SCRIPT_RUNTIMES)[number])
    ? (value as (typeof SCRIPT_RUNTIMES)[number])
    : null
}

/** undefined when absent (valid), the args when valid, null when invalid. */
function parseScriptArgs(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_SCRIPT_ARGS) return null
  for (const arg of value) {
    if (typeof arg !== 'string' || arg.length > MAX_SCRIPT_ARG_CHARS) return null
  }
  return value as string[]
}

function parseGrantRequestEntries(value: unknown): PageGrantRequestEntry[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_GRANT_REQUESTS) return null
  const entries: PageGrantRequestEntry[] = []
  const seenKeys = new Set<string>()
  for (const item of value) {
    if (!isPlainObject(item)) return null
    if (!isBoundedString(item.key, MAX_ID_CHARS)) return null
    if (seenKeys.has(item.key)) return null
    seenKeys.add(item.key)
    if (item.description !== undefined && !isBoundedString(item.description, MAX_GRANT_DESCRIPTION_CHARS)) {
      return null
    }
    const action = parseDescriptor(item.action)
    if (!action) return null
    entries.push({
      key: item.key,
      ...(item.description !== undefined ? { description: item.description } : {}),
      action,
    })
  }
  return entries
}

/**
 * Parse an untrusted `MessageEvent.data` into a typed bridge message.
 * Returns null for anything that is not a well-formed, size-bounded message —
 * the caller must drop such events silently (pages can post arbitrary junk).
 */
export function parsePageBridgeMessage(data: unknown): PageBridgeIncoming | null {
  if (!isPlainObject(data) || data.protocol !== PAGE_BRIDGE_PROTOCOL) return null

  try {
    if (JSON.stringify(data).length > MAX_MESSAGE_JSON_CHARS) return null
  } catch {
    return null // cyclic or unserializable — never valid
  }

  switch (data.type) {
    case 'ready':
      return { type: 'ready' }
    case 'action': {
      if (!isBoundedString(data.requestId, MAX_ID_CHARS)) return null
      if (!isBoundedString(data.nonce, MAX_ID_CHARS)) return null
      if (!isBoundedString(data.grantId, MAX_ID_CHARS)) return null
      const invocation = parseInvocation(data.invocation)
      if (!invocation) return null
      return { type: 'action', requestId: data.requestId, nonce: data.nonce, grantId: data.grantId, invocation }
    }
    case 'action-cancel': {
      if (!isBoundedString(data.requestId, MAX_ID_CHARS)) return null
      if (!isBoundedString(data.nonce, MAX_ID_CHARS)) return null
      return { type: 'action-cancel', requestId: data.requestId, nonce: data.nonce }
    }
    case 'open-url': {
      if (!isBoundedString(data.nonce, MAX_ID_CHARS)) return null
      if (!isBoundedString(data.url, MAX_URL_CHARS)) return null
      return { type: 'open-url', nonce: data.nonce, url: data.url }
    }
    case 'grant-request': {
      if (!isBoundedString(data.nonce, MAX_ID_CHARS)) return null
      const requests = parseGrantRequestEntries(data.requests)
      if (!requests) return null
      return { type: 'grant-request', nonce: data.nonce, requests }
    }
    default:
      return null
  }
}

/** Only plain web links may leave the sandbox (no file:, javascript:, deep-link schemes). */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** A mutating invocation needs fresh user activation inside the frame. */
export function isMutatingInvocation(invocation: PageActionInvocation): boolean {
  // Only api GET is exempt. script is host command execution, and mcp tools
  // are opaque — no HTTP method to infer read vs write, and a granted tool
  // may well mutate ("create issue"). Everything not provably read-only
  // requires a real click, so a page can never fire it from a timer or on load.
  if (invocation.kind === 'api') return invocation.method !== 'GET'
  return true
}

// ============================================================================
// Outgoing (host → page)
// ============================================================================

export function buildPageInitMessage(
  page: { slug: string; kind: PageKind },
  nonce: string,
  snapshot: PageDataSnapshot | null,
  grants: PageGrantSummary[] = [],
): Record<string, unknown> {
  return {
    protocol: PAGE_BRIDGE_PROTOCOL,
    type: 'init',
    payload: { page, nonce, snapshot, grants },
  }
}

/** Current usable grants, sent in reply to 'grant-request' and after approvals. */
export function buildPageGrantsMessage(grants: PageGrantSummary[]): Record<string, unknown> {
  return {
    protocol: PAGE_BRIDGE_PROTOCOL,
    type: 'grants',
    payload: { grants },
  }
}

export function buildPageDataMessage(snapshot: PageDataSnapshot | null): Record<string, unknown> {
  return {
    protocol: PAGE_BRIDGE_PROTOCOL,
    type: 'data',
    payload: { snapshot },
  }
}

export function buildPageActionResultMessage(result: PageActionResult): Record<string, unknown> {
  return {
    protocol: PAGE_BRIDGE_PROTOCOL,
    type: 'action-result',
    payload: { result },
  }
}

// ============================================================================
// Rate limiting (per rendered frame)
// ============================================================================

/** Per-frame budget: bounded concurrency plus a sliding one-minute window. */
export class PageActionRateLimiter {
  /** requestId → whether that request is mutating */
  private readonly inFlight = new Map<string, boolean>()
  private startTimes: number[] = []

  constructor(
    private readonly maxInFlight = 5,
    private readonly maxMutatingInFlight = 1,
    private readonly maxPerMinute = 30,
  ) {}

  /** Returns null when the request may start, otherwise a rejection reason. */
  canStart(now: number, mutating: boolean): 'in-flight-limit' | 'rate-limit' | null {
    this.startTimes = this.startTimes.filter(t => now - t < 60_000)
    if (this.startTimes.length >= this.maxPerMinute) return 'rate-limit'
    if (this.inFlight.size >= this.maxInFlight) return 'in-flight-limit'
    if (mutating) {
      let mutatingInFlight = 0
      for (const isMutating of this.inFlight.values()) if (isMutating) mutatingInFlight++
      if (mutatingInFlight >= this.maxMutatingInFlight) return 'in-flight-limit'
    }
    return null
  }

  start(requestId: string, now: number, mutating: boolean): void {
    this.inFlight.set(requestId, mutating)
    this.startTimes.push(now)
  }

  finish(requestId: string): void {
    this.inFlight.delete(requestId)
  }

  /** In-flight request ids (unmount cleanup cancels these best-effort). */
  get inFlightIds(): string[] {
    return [...this.inFlight.keys()]
  }
}
