/**
 * surface-tab-model.test.ts — tab-strip derivation for knowledge panels
 * (P3-16): knowledge/database/diff tabs name themselves from the node title
 * or the ref kind, never the generic "Panel" fallback.
 */
import { describe, it, expect } from 'bun:test'
import { routes, type ViewRoute } from '../../../shared/routes'
import type { PanelStackEntry } from '../../atoms/panel-stack'
import {
  buildSurfaceTabViews,
  knowledgeRefKey,
  type SurfaceTabLabels,
} from '../surface-tab-model'

const LABELS: SurfaceTabLabels = {
  untitled: 'Untitled',
  browser: 'Browser',
  panel: 'Panel',
  source: 'Source',
  settings: 'Settings',
  skills: 'Skills',
  knowledge: 'Knowledge',
  knowledgeDiff: 'Review changes',
}

function entry(route: ViewRoute, id = `p-${route}`): PanelStackEntry {
  return { id, route, proportion: 1, panelType: 'knowledge', laneId: 'main' }
}

function build(entries: PanelStackEntry[], resolveKnowledgeTitle?: Parameters<typeof buildSurfaceTabViews>[0]['resolveKnowledgeTitle']) {
  return buildSurfaceTabViews({
    entries,
    focusedPanelId: null,
    resolveSessionTitle: () => null,
    resolveKnowledgeTitle,
    labels: LABELS,
  })
}

describe('buildSurfaceTabViews: knowledge panels', () => {
  it('names a document tab from the resolved node title', () => {
    const route = routes.view.siyuan({ kind: 'document', id: 'doc-1' })
    const [tab] = build(
      [entry(route)],
      (ref) => (knowledgeRefKey(ref) === 'document:doc-1' ? 'Project notes' : null),
    )
    expect(tab.kind).toBe('knowledge')
    expect(tab.title).toBe('Project notes')
  })

  it('falls back to the ref kind (not "Panel") when the title is unresolved', () => {
    const route = routes.view.siyuan({ kind: 'document', id: 'doc-1' })
    const [tab] = build([entry(route)], () => null)
    expect(tab.kind).toBe('knowledge')
    expect(tab.title).toBe('Knowledge · document')
    expect(tab.title).not.toBe(LABELS.panel)
  })

  it('falls back the same way without a resolver at all', () => {
    const route = routes.view.siyuan({ kind: 'notebook', id: 'nb-1' })
    const [tab] = build([entry(route)])
    expect(tab.kind).toBe('knowledge')
    expect(tab.title).toBe('Knowledge · notebook')
  })

  it('maps the database tab route onto the database kind', () => {
    const route = routes.view.siyuan({ kind: 'database', id: 'db-9' })
    const [tab] = build([entry(route)], () => null)
    expect(tab.kind).toBe('database')
    expect(tab.title).toBe('Knowledge · database')
  })

  it('names write-back review tabs from the review label, not "Panel"', () => {
    const route = routes.view.proposal('prop-7')
    const [tab] = build([entry(route)])
    expect(tab.kind).toBe('diff')
    expect(tab.title).toBe('Review changes')
  })

  it('names the knowledge navigator root from the knowledge label', () => {
    const [tab] = build([entry(routes.view.knowledge())])
    expect(tab.kind).toBe('knowledge')
    expect(tab.title).toBe('Knowledge')
  })
})
