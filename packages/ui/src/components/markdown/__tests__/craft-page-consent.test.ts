/**
 * Consent decision logic.
 *
 * This repo tests UI as pure logic plus a thin React shell, and consent is the
 * last place to hide a rule inside a component where it cannot be tested.
 *
 * The property these exist to hold: what the user SEES and what gets SENT come
 * from the same list, so the dialog cannot approve something it did not show.
 */
import { describe, expect, it } from 'bun:test'
import {
  buildConsentModel, defaultSelection, toggleSelection, approvalPayload,
  type QueryRequest,
} from '../craft-page-consent.ts'

const req = (over: Partial<QueryRequest> = {}): QueryRequest => ({
  name: 'unread',
  sourceSlug: 'gmail',
  toolName: 'list_messages',
  fixedArgs: { maxResults: 25 },
  paramSchema: { q: { type: 'string', maxLength: 64 } },
  allowed: true,
  approved: false,
  ...over,
})

describe('what the user is shown', () => {
  it('puts an approvable, unapproved request in front of them', () => {
    const m = buildConsentModel([req()])
    expect(m.pending.map(r => r.name)).toEqual(['unread'])
    expect(m.needsDecision).toBe(true)
  })

  it('names what the query actually reaches', () => {
    const [row] = buildConsentModel([req()]).pending
    expect(row!.label).toBe('gmail · list_messages')
  })

  it('separates what the user is fixing from what the page controls', () => {
    // The distinction is the whole point of fixedArgs: the user is told which
    // values the page can vary at runtime and which it can never touch.
    const [row] = buildConsentModel([req()]).pending
    expect(row!.fixedSummary).toEqual(['maxResults: 25'])
    expect(row!.pageControlled).toEqual(['q'])
  })

  it('shows a query with no runtime parameters as controlling nothing', () => {
    const [row] = buildConsentModel([req({ paramSchema: {} })]).pending
    expect(row!.pageControlled).toEqual([])
  })

  it('lists already-approved access separately, so it stays reviewable', () => {
    const m = buildConsentModel([req({ approved: true })])
    expect(m.approved.map(r => r.name)).toEqual(['unread'])
    expect(m.pending).toEqual([])
    expect(m.needsDecision).toBe(false)
  })

  it('shows a non-approvable request rather than dropping it', () => {
    // Silently omitting it leaves the user wondering why the page is broken,
    // and leaves the agent's claim about it unexplained.
    const m = buildConsentModel([req({ name: 'send', toolName: 'send_message', allowed: false })])
    expect(m.blocked.map(r => r.name)).toEqual(['send'])
    expect(m.pending).toEqual([])
    expect(m.needsDecision).toBe(false)
  })

  it('names every source the page would reach', () => {
    const m = buildConsentModel([
      req(),
      req({ name: 'issues', sourceSlug: 'linear', toolName: 'list_issues' }),
      req({ name: 'labels', sourceSlug: 'gmail', toolName: 'list_labels' }),
    ])
    expect(m.sources).toEqual(['gmail', 'linear'])
  })

  it('handles a page that requested nothing', () => {
    for (const input of [null, undefined, []]) {
      const m = buildConsentModel(input)
      expect(m.needsDecision).toBe(false)
      expect(m.pending).toEqual([])
    }
  })
})

describe('selection', () => {
  it('starts with every pending row selected', () => {
    // The unit of consent is the query SET; per-query prompting is the consent
    // fatigue the trust model rejects. Every row is visible and Allow is an
    // explicit press.
    const m = buildConsentModel([req(), req({ name: 'labels', toolName: 'list_labels' })])
    expect([...defaultSelection(m)].sort()).toEqual(['labels', 'unread'])
  })

  it('never pre-selects something that cannot be approved', () => {
    const m = buildConsentModel([req({ allowed: false })])
    expect([...defaultSelection(m)]).toEqual([])
  })

  it('toggles a row off and back on', () => {
    const m = buildConsentModel([req()])
    let sel = defaultSelection(m)
    sel = toggleSelection(sel, 'unread')
    expect(sel.has('unread')).toBe(false)
    sel = toggleSelection(sel, 'unread')
    expect(sel.has('unread')).toBe(true)
  })

  it('does not mutate the set it was given', () => {
    const sel = new Set(['unread'])
    toggleSelection(sel, 'unread')
    expect(sel.has('unread')).toBe(true)
  })
})

describe('what actually gets sent', () => {
  it('sends the selected rows with their source, tool and arguments', () => {
    const requests = [req()]
    const m = buildConsentModel(requests)
    expect(approvalPayload(m, defaultSelection(m), requests)).toEqual([{
      name: 'unread',
      sourceSlug: 'gmail',
      toolName: 'list_messages',
      fixedArgs: { maxResults: 25 },
      paramSchema: { q: { type: 'string', maxLength: 64 } },
    }])
  })

  it('sends the name, without which the approval does nothing', () => {
    // The page calls craftQuery('unread'). A grant approved without that name
    // resolves to nothing, so the user's approval silently fails to work.
    const requests = [req()]
    const m = buildConsentModel(requests)
    expect(approvalPayload(m, defaultSelection(m), requests)[0]!.name).toBe('unread')
  })

  it('omits a row the user unchecked', () => {
    const requests = [req(), req({ name: 'labels', toolName: 'list_labels' })]
    const m = buildConsentModel(requests)
    const sel = toggleSelection(defaultSelection(m), 'labels')
    expect(approvalPayload(m, sel, requests).map(q => q.name)).toEqual(['unread'])
  })

  it('refuses to approve a blocked row even when its name is selected', () => {
    // Selection is UI state and can drift; the payload is derived from what was
    // actually shown as approvable.
    const requests = [req({ allowed: false })]
    const m = buildConsentModel(requests)
    expect(approvalPayload(m, new Set(['unread']), requests)).toEqual([])
  })

  it('refuses to approve a row that was never in the request list', () => {
    const requests = [req()]
    const m = buildConsentModel(requests)
    expect(approvalPayload(m, new Set(['unread', 'smuggled']), requests).map(q => q.name))
      .toEqual(['unread'])
  })

  it('refuses to re-approve something already approved', () => {
    // A second grant under the same name is rejected by the store anyway; not
    // sending it keeps the UI from reporting a failure the user did not cause.
    const requests = [req({ approved: true })]
    const m = buildConsentModel(requests)
    expect(approvalPayload(m, new Set(['unread']), requests)).toEqual([])
  })

  it('sends nothing when the user unchecks everything', () => {
    const requests = [req()]
    const m = buildConsentModel(requests)
    expect(approvalPayload(m, new Set(), requests)).toEqual([])
  })

  it('defaults absent argument objects rather than sending undefined', () => {
    const requests = [req({ fixedArgs: undefined as never, paramSchema: undefined as never })]
    const m = buildConsentModel(requests)
    const [payload] = approvalPayload(m, defaultSelection(m), requests)
    expect(payload!.fixedArgs).toEqual({})
    expect(payload!.paramSchema).toEqual({})
  })
})
