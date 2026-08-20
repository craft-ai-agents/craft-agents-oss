import { describe, it, expect } from 'bun:test'
import { createContextKeyService, evaluateWhen } from '../context-keys/index.ts'

describe('evaluateWhen', () => {
  it('treats undefined and empty expressions as always true', () => {
    expect(evaluateWhen(undefined, {})).toBe(true)
    expect(evaluateWhen('', {})).toBe(true)
    expect(evaluateWhen('   ', {})).toBe(true)
  })

  it('evaluates string equality (spec: activeSurface==\'knowledge\')', () => {
    expect(evaluateWhen("activeSurface=='knowledge'", { activeSurface: 'knowledge' })).toBe(true)
    expect(evaluateWhen("activeSurface=='knowledge'", { activeSurface: 'session' })).toBe(false)
    expect(evaluateWhen('activeSurface=="knowledge"', { activeSurface: 'knowledge' })).toBe(true)
  })

  it('evaluates boolean equality (spec: agent.available==true)', () => {
    expect(evaluateWhen('agent.available==true', { 'agent.available': true })).toBe(true)
    expect(evaluateWhen('agent.available==true', { 'agent.available': false })).toBe(false)
    expect(evaluateWhen('agent.available==true', {})).toBe(false)
    expect(evaluateWhen('agent.available!=true', { 'agent.available': false })).toBe(true)
  })

  it('evaluates numeric comparisons on flat dotted keys (spec: selectedBlocks.count>0)', () => {
    expect(evaluateWhen('selectedBlocks.count>0', { 'selectedBlocks.count': 3 })).toBe(true)
    expect(evaluateWhen('selectedBlocks.count>0', { 'selectedBlocks.count': 0 })).toBe(false)
    expect(evaluateWhen('selectedBlocks.count>=3', { 'selectedBlocks.count': 3 })).toBe(true)
    expect(evaluateWhen('selectedBlocks.count<3', { 'selectedBlocks.count': 2 })).toBe(true)
    expect(evaluateWhen('selectedBlocks.count<=2', { 'selectedBlocks.count': 2 })).toBe(true)
  })

  it('derives .count over array-valued keys (S-04 §3.5 counter suffix)', () => {
    expect(evaluateWhen('selectedBlocks.count>0', { selectedBlocks: [{}, {}] })).toBe(true)
    expect(evaluateWhen('selectedBlocks.count>0', { selectedBlocks: [] })).toBe(false)
    // explicit flat key wins over the array derivation
    expect(evaluateWhen('selectedBlocks.count==5', { selectedBlocks: [{}, {}], 'selectedBlocks.count': 5 })).toBe(true)
  })

  it('walks nested objects for dotted paths', () => {
    const keys = { rail: { activity: { collapsed: true } } }
    expect(evaluateWhen('rail.activity.collapsed', keys)).toBe(true)
    expect(evaluateWhen('rail.activity.collapsed==true', keys)).toBe(true)
    expect(evaluateWhen('rail.activity.collapsed', { rail: { activity: {} } })).toBe(false)
  })

  it('evaluates && chains (spec command when, verbatim)', () => {
    const when = "activeSurface=='knowledge' && selectedBlocks.count>0 && agent.available==true"
    const keys = { activeSurface: 'knowledge', 'selectedBlocks.count': 3, 'agent.available': true }
    expect(evaluateWhen(when, keys)).toBe(true)
    expect(evaluateWhen(when, { ...keys, 'agent.available': false })).toBe(false)
    expect(evaluateWhen(when, { activeSurface: 'knowledge' })).toBe(false)
  })

  it('evaluates || chains (spec inspector when: knowledge or session)', () => {
    const when = "activeSurface=='knowledge' || activeSurface=='session'"
    expect(evaluateWhen(when, { activeSurface: 'knowledge' })).toBe(true)
    expect(evaluateWhen(when, { activeSurface: 'session' })).toBe(true)
    expect(evaluateWhen(when, { activeSurface: 'browser' })).toBe(false)
  })

  it('evaluates negation', () => {
    expect(evaluateWhen('!rail.activity.collapsed', { 'rail.activity.collapsed': false })).toBe(true)
    expect(evaluateWhen('!rail.activity.collapsed', { 'rail.activity.collapsed': true })).toBe(false)
    expect(evaluateWhen('!rail.activity.collapsed', {})).toBe(true)
  })

  it('binds && tighter than ||', () => {
    const when = "a=='x' || a=='y' && b.count>1"
    expect(evaluateWhen(when, { a: 'x' })).toBe(true)
    expect(evaluateWhen(when, { a: 'y', 'b.count': 0 })).toBe(false)
    expect(evaluateWhen(when, { a: 'y', 'b.count': 2 })).toBe(true)
  })

  it('honours parentheses', () => {
    const when = "(a=='x' || a=='y') && b.count>1"
    expect(evaluateWhen(when, { a: 'x', 'b.count': 2 })).toBe(true)
    expect(evaluateWhen(when, { a: 'x' })).toBe(false)
  })

  it('treats a bare unknown key as false', () => {
    expect(evaluateWhen('unknownKey', {})).toBe(false)
  })

  it('never throws on malformed expressions: they are false', () => {
    expect(evaluateWhen('activeSurface==', { activeSurface: 'knowledge' })).toBe(false)
    expect(evaluateWhen("(activeSurface=='knowledge'", { activeSurface: 'knowledge' })).toBe(false)
    expect(evaluateWhen('&&', {})).toBe(false)
    expect(evaluateWhen("activeSurface='unterminated", {})).toBe(false)
  })
})

describe('ContextKeyService', () => {
  it('sets, gets, and notifies subscribers with the changed key', () => {
    const service = createContextKeyService()
    const seen: string[] = []
    const sub = service.subscribe((key) => seen.push(key))

    service.set('activeSurface', 'knowledge')

    expect(service.get('activeSurface')).toBe('knowledge')
    expect(seen).toEqual(['activeSurface'])

    sub.dispose()
    service.set('activeSurface', 'session')
    expect(seen).toEqual(['activeSurface'])
  })

  it('merges provider pulls into the snapshot; providers win over stored values', () => {
    const service = createContextKeyService()
    service.set('selectedBlocks.count', 1)
    const reg = service.registerProvider({
      keys: ['selectedBlocks.count'],
      pull: () => ({ 'selectedBlocks.count': 4 }),
    })

    expect(service.get('selectedBlocks.count')).toBe(4)
    expect(service.snapshot()).toEqual({ 'selectedBlocks.count': 4 })

    reg.dispose()
    expect(service.get('selectedBlocks.count')).toBe(1)
  })

  it('evaluates when-expressions against its own snapshot by default', () => {
    const service = createContextKeyService()
    service.set('activeSurface', 'knowledge')
    service.set('agent.available', true)

    expect(service.evaluateWhen("activeSurface=='knowledge' && agent.available==true")).toBe(true)
    expect(service.evaluateWhen("activeSurface=='browser'")).toBe(false)
    expect(service.evaluateWhen(undefined)).toBe(true)
  })
})
