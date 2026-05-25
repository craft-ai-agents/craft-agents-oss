import { describe, expect, test } from 'bun:test'
import { CONCIERGE_SLUG, ORCHESTRATOR_SLUG } from '@craft-agent/shared/agent-definitions'
import { canDirectlyMutateUserMemory, directUserMemoryPolicyError } from './SessionManager'

describe('session memory write policy', () => {
  test('allows direct user memory writes from manual sessions', () => {
    expect(canDirectlyMutateUserMemory()).toBe(true)
  })

  test('allows direct user memory writes from top-level system agents', () => {
    expect(canDirectlyMutateUserMemory({ agentSlug: CONCIERGE_SLUG })).toBe(true)
    expect(canDirectlyMutateUserMemory({ agentSlug: ORCHESTRATOR_SLUG })).toBe(true)
  })

  test('blocks ordinary spawned agents from directly mutating USER.md', () => {
    const spawned = { agentSlug: 'deep-researcher' }

    expect(canDirectlyMutateUserMemory(spawned)).toBe(false)
    expect(directUserMemoryPolicyError(spawned)).toContain('cannot directly write USER.md')
    expect(directUserMemoryPolicyError(spawned)).toContain('memory review queue')
  })
})
