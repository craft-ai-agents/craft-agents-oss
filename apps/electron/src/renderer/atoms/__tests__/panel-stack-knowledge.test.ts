import { describe, it, expect } from 'bun:test'
import { createStore } from 'jotai'
import { getPanelTypeFromRoute, panelStackAtom, pushPanelAtom } from '../panel-stack'
import { routes } from '../../../shared/routes'

describe('getPanelTypeFromRoute: knowledge classification', () => {
  it('classifies knowledge/{kind}/{id} routes as knowledge', () => {
    expect(getPanelTypeFromRoute(routes.view.siyuan({ kind: 'document', id: '20240101-abcdef' }))).toBe(
      'knowledge',
    )
  })

  it('classifies the bare knowledge home route as knowledge', () => {
    expect(getPanelTypeFromRoute(routes.view.knowledge())).toBe('knowledge')
  })

  it('classifies the database tab route (rides knowledge) as knowledge', () => {
    expect(getPanelTypeFromRoute(routes.view.siyuan({ kind: 'database', id: 'db-1' }))).toBe('knowledge')
  })

  it('classifies the compat full-interface surface route as knowledge', () => {
    expect(getPanelTypeFromRoute(routes.view.siyuan({ kind: 'notebook', id: '__full__' }))).toBe('knowledge')
  })

  it('does not classify other navigators as knowledge', () => {
    expect(getPanelTypeFromRoute('settings')).toBe('settings')
    expect(getPanelTypeFromRoute('sources/source/github')).toBe('source')
  })
})

describe('panel stack: knowledge entries', () => {
  it('pushes a knowledge route into the main lane with panelType knowledge', () => {
    const store = createStore()
    store.set(pushPanelAtom, { route: routes.view.siyuan({ kind: 'document', id: 'doc-1' }) })

    const stack = store.get(panelStackAtom)
    expect(stack).toHaveLength(1)
    expect(stack[0].panelType).toBe('knowledge')
    expect(stack[0].laneId).toBe('main')
  })
})
