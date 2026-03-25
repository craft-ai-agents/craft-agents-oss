import { describe, expect, it, mock } from 'bun:test'
import { ClaudeAgent } from '../claude-agent.ts'
import { AbortReason } from '../backend/types.ts'

describe('ClaudeAgent handoff interrupts', () => {
  it('uses Query.interrupt() for auth handoff instead of aborting the AbortController', async () => {
    const interrupt = mock(async () => {})
    const abort = mock((_reason?: unknown) => {})
    const debug = mock((_message: string) => {})

    const agent = Object.create(ClaudeAgent.prototype) as any

    agent.currentQuery = { interrupt }
    agent.currentQueryAbortController = { abort }
    agent.pendingSteerMessage = 'queued steer'
    agent.lastAbortReason = null
    agent.debug = debug

    agent.interruptForHandoff(AbortReason.AuthRequest)
    await Promise.resolve()

    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(abort).not.toHaveBeenCalled()
    expect(agent.lastAbortReason).toBe(AbortReason.AuthRequest)
    expect(agent.pendingSteerMessage).toBeNull()
  })

  it('logs interrupt failures instead of falling back to AbortController', async () => {
    const interrupt = mock(async () => {
      throw new Error('interrupt failed')
    })
    const abort = mock((_reason?: unknown) => {})
    const debug = mock((_message: string) => {})

    const agent = Object.create(ClaudeAgent.prototype) as any

    agent.currentQuery = { interrupt }
    agent.currentQueryAbortController = { abort }
    agent.pendingSteerMessage = null
    agent.lastAbortReason = null
    agent.debug = debug

    agent.interruptForHandoff(AbortReason.PlanSubmitted)
    await Promise.resolve()
    await Promise.resolve()

    expect(abort).not.toHaveBeenCalled()
    expect(debug).toHaveBeenCalledWith('Claude handoff interrupt failed: interrupt failed')
  })
})
