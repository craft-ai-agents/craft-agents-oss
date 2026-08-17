/**
 * Consent decision logic for Craft Pages live data.
 *
 * Pure on purpose. This repo tests UI as logic plus a thin React shell (see
 * `craft-page-spec.ts` / `CraftPageBlock.tsx`), and consent is the last place to
 * hide a rule inside a component where it cannot be tested.
 *
 * The rule that matters most: what the user SEES and what gets SENT are derived
 * from the same list, so the dialog can never approve something it did not show
 * — including a request that arrived non-approvable.
 */

/** One entry as `pages:listQueryRequests` returns it. */
export interface QueryRequest {
  name: string
  sourceSlug: string
  toolName: string
  fixedArgs: Record<string, unknown>
  paramSchema: Record<string, unknown>
  /** Whether the tool is on the trusted read-only allowlist. */
  allowed: boolean
  approved: boolean
}

export interface ConsentRow {
  name: string
  sourceSlug: string
  toolName: string
  /** "gmail · list_messages" — what this actually reaches. */
  label: string
  /** Constants the user is fixing, e.g. ["maxResults: 25"]. */
  fixedSummary: string[]
  /** Names of arguments the PAGE controls at runtime. */
  pageControlled: string[]
  approved: boolean
  /** False when the tool is not approvable; such a row is never selectable. */
  selectable: boolean
}

export interface ConsentModel {
  /** Rows awaiting a decision. */
  pending: ConsentRow[]
  /** Rows the user already approved, shown so access is reviewable. */
  approved: ConsentRow[]
  /** Rows that cannot be approved at all, shown so the refusal is not silent. */
  blocked: ConsentRow[]
  /** Whether there is anything for the user to decide right now. */
  needsDecision: boolean
  /** Every source this page would reach if everything pending were approved. */
  sources: string[]
}

function summarizeFixed(fixedArgs: Record<string, unknown>): string[] {
  return Object.entries(fixedArgs ?? {})
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .sort()
}

function toRow(r: QueryRequest): ConsentRow {
  return {
    name: r.name,
    sourceSlug: r.sourceSlug,
    toolName: r.toolName,
    label: `${r.sourceSlug} · ${r.toolName}`,
    fixedSummary: summarizeFixed(r.fixedArgs),
    pageControlled: Object.keys(r.paramSchema ?? {}).sort(),
    approved: r.approved === true,
    selectable: r.allowed === true && r.approved !== true,
  }
}

export function buildConsentModel(requests: QueryRequest[] | null | undefined): ConsentModel {
  const rows = (requests ?? []).map(toRow)
  const pending = rows.filter(r => r.selectable)
  const approved = rows.filter(r => r.approved)
  // Not approved AND not approvable. A request the app will never honour is
  // shown rather than dropped: silently omitting it leaves the user wondering
  // why the page is broken, and leaves the agent's claim unexplained.
  const blocked = rows.filter(r => !r.approved && !r.selectable)

  return {
    pending,
    approved,
    blocked,
    needsDecision: pending.length > 0,
    sources: [...new Set(pending.map(r => r.sourceSlug))].sort(),
  }
}

/**
 * Default selection: everything pending.
 *
 * The unit of consent is the query SET, not the query — the trust model calls
 * per-query prompting consent fatigue (plan.md). The user sees every row and
 * has to press Allow, and can uncheck any of them first.
 */
export function defaultSelection(model: ConsentModel): Set<string> {
  return new Set(model.pending.map(r => r.name))
}

export function toggleSelection(selected: Set<string>, name: string): Set<string> {
  const next = new Set(selected)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return next
}

/**
 * The payload to send to `approvePageGrants`.
 *
 * Derived from the SAME pending list the user was shown, so a row that was
 * never displayed — or was displayed as blocked — cannot be approved even if
 * its name is in the selection. Selection is UI state; this is the gate.
 */
export function approvalPayload(
  model: ConsentModel,
  selected: Set<string>,
  requests: QueryRequest[],
): Array<{
  name: string
  sourceSlug: string
  toolName: string
  fixedArgs: Record<string, unknown>
  paramSchema: Record<string, unknown>
}> {
  const approvable = new Set(model.pending.map(r => r.name))
  return requests
    .filter(r => approvable.has(r.name) && selected.has(r.name))
    .map(r => ({
      name: r.name,
      sourceSlug: r.sourceSlug,
      toolName: r.toolName,
      fixedArgs: r.fixedArgs ?? {},
      paramSchema: r.paramSchema ?? {},
    }))
}
