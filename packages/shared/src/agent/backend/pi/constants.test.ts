import { describe, expect, it } from 'bun:test'
import { THINKING_ENABLED_TO_PI } from './constants.ts'

describe('THINKING_ENABLED_TO_PI', () => {
  it('maps enabled thinking to Pi medium', () => {
    expect(THINKING_ENABLED_TO_PI.true).toBe('medium')
  })

  it('maps disabled thinking to Pi off', () => {
    expect(THINKING_ENABLED_TO_PI.false).toBe('off')
  })
})
