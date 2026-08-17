/**
 * The ```craft-page fence payload.
 *
 * Kept separate from the React component so the two things most likely to break
 * are directly testable: rejecting malformed specs the model may emit, and
 * deriving a frame key that CHANGES when a page is edited.
 */

export interface CraftPageSpec {
  pageId: string
  /** Revision. Not optional — see craftPageFrameKey. */
  rev: number
  title?: string
}

export type ParseResult =
  | { ok: true; spec: CraftPageSpec }
  | { ok: false; reason: string }

const fail = (reason: string): ParseResult => ({ ok: false, reason })

export function parseCraftPageSpec(code: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(code.trim())
  } catch {
    return fail('craft-page block is not valid JSON')
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('craft-page block must be a JSON object')
  }

  const o = raw as Record<string, unknown>

  if (typeof o.pageId !== 'string' || o.pageId.length === 0) {
    return fail('craft-page block is missing a "pageId" string')
  }

  // rev is REQUIRED and must be a positive integer. Defaulting it would
  // silently reintroduce the stale-preview bug: the frame key would stop
  // changing between revisions, so an edited page would keep rendering the
  // cached one and the edit would look like it did nothing.
  if (
    typeof o.rev !== 'number' ||
    !Number.isInteger(o.rev) ||
    o.rev < 1
  ) {
    return fail('craft-page block is missing a positive integer "rev"')
  }

  return {
    ok: true,
    spec: {
      pageId: o.pageId,
      rev: o.rev,
      ...(typeof o.title === 'string' ? { title: o.title } : {}),
    },
  }
}

/**
 * React key / iframe identity for a page revision.
 *
 * Must incorporate rev so an edited page genuinely remounts. Keying on pageId
 * alone means React reuses the element, the browser reuses the cached document,
 * and the user sees the previous revision.
 */
export function craftPageFrameKey(spec: Pick<CraftPageSpec, 'pageId' | 'rev'>): string {
  return `${spec.pageId}:${spec.rev}`
}
