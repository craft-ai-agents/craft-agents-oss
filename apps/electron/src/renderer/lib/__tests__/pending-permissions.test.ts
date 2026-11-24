import { describe, expect, it } from 'bun:test'
import type { PermissionRequest } from '../../../shared/types'
import { withoutPermissionRequest } from '../pending-permissions'
import { processEvent } from '../../event-processor'

const prompt = (requestId: string) => ({ requestId, toolName: 'Bash', description: requestId }) as PermissionRequest

describe('withoutPermissionRequest', () => {
  it('drops the answered prompt by id, wherever it is in the queue', () => {
    const pending = new Map([['s1', [prompt('a'), prompt('b'), prompt('c')]]])
    const next = withoutPermissionRequest(pending, 's1', 'b')
    expect(next.get('s1')!.map(r => r.requestId)).toEqual(['a', 'c'])
    expect(pending.get('s1')).toHaveLength(3)
  })

  it('removes the session entry with its last prompt', () => {
    const next = withoutPermissionRequest(new Map([['s1', [prompt('a')]]]), 's1', 'a')
    expect(next.has('s1')).toBe(false)
  })

  it('returns the same map when the prompt is already gone (local answer and event in either order)', () => {
    const pending = new Map([['s1', [prompt('a')]]])
    expect(withoutPermissionRequest(pending, 's1', 'zzz')).toBe(pending)
    expect(withoutPermissionRequest(pending, 's2', 'a')).toBe(pending)
  })
})

describe('permission_resolved event', () => {
  it('becomes an effect that names the answered prompt', () => {
    const state = { session: { id: 's1' }, streaming: null } as never
    const result = processEvent(state, { type: 'permission_resolved', sessionId: 's1', requestId: 'a', allowed: true })
    expect(result.effects).toEqual([{ type: 'permission_resolved', requestId: 'a' }])
  })
})
