import { describe, it, expect } from 'bun:test'
import { buildFlowDiagram } from '../buildFlowDiagram'
import type { AutomationListItem } from '../types'

function makeAutomation(overrides: Partial<AutomationListItem> = {}): AutomationListItem {
  return {
    id: 'auto-1',
    event: 'LabelAdd',
    matcherIndex: 0,
    name: 'Test automation',
    summary: 'test summary',
    enabled: true,
    actions: [{ type: 'prompt', prompt: 'Do thing' }],
    ...overrides,
  }
}

describe('buildFlowDiagram', () => {
  it('connects trigger directly to condition root node without subgraph wrapper', () => {
    const automation = makeAutomation({
      matcher: 'urgent',
      conditions: [
        { condition: 'state', field: 'label', value: 'urgent' },
      ],
    })

    const diagram = buildFlowDiagram(automation)
    expect(diagram).not.toBeNull()
    expect(diagram!).toMatch(/E -->\|"urgent"\| C\d+/)
    expect(diagram).not.toContain('subgraph CONDS')
  })

  it('renders explicit logical gate roots for nested conditions', () => {
    const automation = makeAutomation({
      conditions: [
        {
          condition: 'or',
          conditions: [
            { condition: 'state', field: 'mode', value: 'safe' },
            { condition: 'state', field: 'mode', value: 'ask' },
          ],
        },
      ],
    })

    const diagram = buildFlowDiagram(automation)
    expect(diagram).not.toBeNull()
    expect(diagram).toContain('(("OR"))')
    expect(diagram!).toMatch(/E --> OR\d+/)
    expect(diagram!).toMatch(/OR\d+ --> A\d+\[/)
  })

  it('escapes matcher and condition labels to avoid Mermaid-breaking characters', () => {
    const automation = makeAutomation({
      matcher: 'bad|matcher\nline',
      conditions: [
        { condition: 'state', field: 'sta]te', value: 'x|y' },
      ],
      actions: [{ type: 'prompt', prompt: 'line1\nline2 [x]' }],
    })

    const diagram = buildFlowDiagram(automation)
    expect(diagram).not.toBeNull()
    expect(diagram).toContain('|"bad matcher line"|')
    expect(diagram).not.toContain('bad|matcher')
    expect(diagram).toContain('sta te = x y')
    expect(diagram).not.toContain('sta]te')
  })
})
