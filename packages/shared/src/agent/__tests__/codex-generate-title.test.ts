/**
 * Tests for CodexAgent.generateTitle() logic.
 *
 * generateTitle() starts an ephemeral Codex thread and collects text from
 * agentMessage/delta events until turn/completed. It filters by threadId
 * and has a 15s timeout.
 *
 * These tests validate the event collection and edge-case handling pattern
 * using a mock EventEmitter (same interface as AppServerClient).
 */
import { describe, it, expect } from 'bun:test'
import { EventEmitter } from 'node:events'

// ---------------------------------------------------------------------------
// Simulate the generateTitle event collection logic from codex-agent.ts
// ---------------------------------------------------------------------------

/**
 * Mirrors the event collection logic in CodexAgent.generateTitle()
 * (codex-agent.ts lines ~1622-1676).
 */
function collectTitle(
  emitter: EventEmitter,
  threadId: string,
  timeoutMs: number = 15000,
): Promise<string | null> {
  let title = ''
  return new Promise<string | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      resolve(title || null) // resolve with whatever we have
    }, timeoutMs)

    const onDelta = (ev: { threadId: string; delta: string }) => {
      if (ev.threadId === threadId) {
        title += ev.delta
      }
    }
    const onTurnComplete = (ev: { threadId: string }) => {
      if (ev.threadId === threadId) {
        clearTimeout(timeout)
        cleanup()
        // Apply same validation as production: trim, length check
        const trimmed = title.trim()
        resolve((trimmed.length > 0 && trimmed.length < 100) ? trimmed : null)
      }
    }
    const onCodexError = (ev: { threadId: string; error: { message?: string } }) => {
      if (ev.threadId === threadId) {
        clearTimeout(timeout)
        cleanup()
        reject(new Error(ev.error?.message ?? 'Codex title generation failed'))
      }
    }
    const onProcessError = (err: Error) => {
      clearTimeout(timeout)
      cleanup()
      reject(err)
    }

    const cleanup = () => {
      emitter.off('item/agentMessage/delta', onDelta)
      emitter.off('turn/completed', onTurnComplete)
      emitter.off('codex/error', onCodexError)
      emitter.off('error', onProcessError)
    }

    emitter.on('item/agentMessage/delta', onDelta)
    emitter.on('turn/completed', onTurnComplete)
    emitter.on('codex/error', onCodexError)
    emitter.on('error', onProcessError)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodexAgent.generateTitle() event collection', () => {
  const threadId = 'test-thread-123'

  it('accumulates delta text and returns on turn/completed', async () => {
    const emitter = new EventEmitter()
    const promise = collectTitle(emitter, threadId)

    // Simulate streamed deltas
    emitter.emit('item/agentMessage/delta', { threadId, delta: 'Fix ' })
    emitter.emit('item/agentMessage/delta', { threadId, delta: 'auth bug' })
    emitter.emit('turn/completed', { threadId })

    const result = await promise
    expect(result).toBe('Fix auth bug')
  })

  it('ignores deltas from other threads', async () => {
    const emitter = new EventEmitter()
    const promise = collectTitle(emitter, threadId)

    emitter.emit('item/agentMessage/delta', { threadId: 'other-thread', delta: 'Wrong ' })
    emitter.emit('item/agentMessage/delta', { threadId, delta: 'Correct' })
    emitter.emit('turn/completed', { threadId })

    const result = await promise
    expect(result).toBe('Correct')
  })

  it('resolves with partial text on timeout', async () => {
    const emitter = new EventEmitter()
    // Use very short timeout for test
    const promise = collectTitle(emitter, threadId, 50)

    emitter.emit('item/agentMessage/delta', { threadId, delta: 'Partial' })
    // Don't emit turn/completed — let it timeout

    const result = await promise
    expect(result).toBe('Partial')
  })

  it('resolves null on timeout with no text', async () => {
    const emitter = new EventEmitter()
    const promise = collectTitle(emitter, threadId, 50)

    // Don't emit any events
    const result = await promise
    expect(result).toBeNull()
  })

  it('rejects on codex/error', async () => {
    const emitter = new EventEmitter()
    const promise = collectTitle(emitter, threadId)

    emitter.emit('codex/error', {
      threadId,
      error: { message: 'Rate limit exceeded' },
    })

    expect(promise).rejects.toThrow('Rate limit exceeded')
  })

  it('rejects on process error', async () => {
    const emitter = new EventEmitter()
    const promise = collectTitle(emitter, threadId)

    emitter.emit('error', new Error('Process crashed'))

    expect(promise).rejects.toThrow('Process crashed')
  })

  it('removes all listeners after completion', async () => {
    const emitter = new EventEmitter()
    const promise = collectTitle(emitter, threadId)

    emitter.emit('item/agentMessage/delta', { threadId, delta: 'Done' })
    emitter.emit('turn/completed', { threadId })

    await promise

    expect(emitter.listenerCount('item/agentMessage/delta')).toBe(0)
    expect(emitter.listenerCount('turn/completed')).toBe(0)
    expect(emitter.listenerCount('codex/error')).toBe(0)
    expect(emitter.listenerCount('error')).toBe(0)
  })

  it('returns null for title exceeding 100 chars', async () => {
    const emitter = new EventEmitter()
    const promise = collectTitle(emitter, threadId)

    emitter.emit('item/agentMessage/delta', { threadId, delta: 'A'.repeat(101) })
    emitter.emit('turn/completed', { threadId })

    const result = await promise
    expect(result).toBeNull()
  })

  it('returns null for empty title after trimming', async () => {
    const emitter = new EventEmitter()
    const promise = collectTitle(emitter, threadId)

    emitter.emit('item/agentMessage/delta', { threadId, delta: '   \n\t  ' })
    emitter.emit('turn/completed', { threadId })

    const result = await promise
    expect(result).toBeNull()
  })

  it('trims whitespace from title', async () => {
    const emitter = new EventEmitter()
    const promise = collectTitle(emitter, threadId)

    emitter.emit('item/agentMessage/delta', { threadId, delta: '  Fix bug  ' })
    emitter.emit('turn/completed', { threadId })

    const result = await promise
    expect(result).toBe('Fix bug')
  })
})
