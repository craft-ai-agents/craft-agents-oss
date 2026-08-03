import { describe, expect, it } from 'bun:test'
import { ownerAgentComponents } from '../registry/owner-agent'

describe('owner agent playground registry', () => {
  it('exposes the command shell as a full-layout preview', () => {
    expect(ownerAgentComponents).toHaveLength(1)
    expect(ownerAgentComponents[0]?.id).toBe('owner-agent-command-shell')
    expect(ownerAgentComponents[0]?.category).toBe('Owner Agent')
    expect(ownerAgentComponents[0]?.layout).toBe('full')
  })

  it('makes every required workspace state selectable', () => {
    const stateControl = ownerAgentComponents[0]?.props?.find((prop) => prop.name === 'state')?.control
    expect(stateControl?.type).toBe('select')
    if (stateControl?.type !== 'select') throw new Error('state control must be a select')

    expect(stateControl.options.map((option) => option.value)).toEqual([
      'loading',
      'empty',
      'active',
      'streaming',
      'tool-running',
      'permission',
      'error',
      'disconnected',
    ])
  })
})
