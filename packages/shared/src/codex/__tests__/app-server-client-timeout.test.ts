/**
 * Tests for AppServerClient request timeout behavior.
 *
 * The AppServerClient uses a timeout mechanism that rejects pending requests
 * if no response is received within `requestTimeout` ms. This prevents
 * callers from hanging forever when the app-server is stuck.
 *
 * These tests validate the timeout pattern using a minimal simulation
 * (same logic as app-server-client.ts sendRequest).
 */
import { describe, it, expect } from 'bun:test'

// ---------------------------------------------------------------------------
// Simulate the timeout/pending-request pattern from app-server-client.ts
// ---------------------------------------------------------------------------

interface PendingRequest {
  method: string
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

/**
 * Minimal simulation of the sendRequest timeout logic.
 * Mirrors: app-server-client.ts sendRequest() lines ~518-566
 */
class RequestTimeoutSimulator {
  pendingRequests = new Map<string, PendingRequest>()
  private nextId = 1

  sendRequest<T>(method: string, timeoutMs: number): { id: string; promise: Promise<T> } {
    const id = String(this.nextId++)

    const timeoutId = setTimeout(() => {
      const pending = this.pendingRequests.get(id)
      if (pending) {
        this.pendingRequests.delete(id)
        pending.reject(new Error(`Request timeout: ${method} (${id}) did not receive a response within ${timeoutMs}ms`))
      }
    }, timeoutMs)

    const promise = new Promise<T>((resolve, reject) => {
      const wrappedReject = (err: Error) => {
        clearTimeout(timeoutId)
        reject(err)
      }

      this.pendingRequests.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject: wrappedReject,
        timeoutId,
      })
    })

    return { id, promise }
  }

  resolveRequest(id: string, value: unknown): void {
    const pending = this.pendingRequests.get(id)
    if (pending) {
      clearTimeout(pending.timeoutId)
      this.pendingRequests.delete(id)
      pending.resolve(value)
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppServerClient request timeout', () => {
  it('rejects with descriptive error on timeout', async () => {
    const sim = new RequestTimeoutSimulator()
    const { promise } = sim.sendRequest('thread/start', 50) // Very short timeout

    // Don't resolve — let it timeout
    try {
      await promise
      throw new Error('Should have timed out')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain('Request timeout')
      expect((err as Error).message).toContain('thread/start')
      expect((err as Error).message).toContain('50ms')
    }
  })

  it('removes pending request from map after timeout', async () => {
    const sim = new RequestTimeoutSimulator()
    const { id, promise } = sim.sendRequest('thread/start', 50)

    expect(sim.pendingRequests.has(id)).toBe(true)

    try { await promise } catch { /* expected timeout */ }

    expect(sim.pendingRequests.has(id)).toBe(false)
  })

  it('resolves successfully before timeout fires', async () => {
    const sim = new RequestTimeoutSimulator()
    const { id, promise } = sim.sendRequest<{ result: string }>('thread/start', 5000)

    // Resolve immediately
    sim.resolveRequest(id, { result: 'ok' })

    const result = await promise
    expect(result).toEqual({ result: 'ok' })
    expect(sim.pendingRequests.has(id)).toBe(false)
  })

  it('clears timeout when resolved before expiry', async () => {
    const sim = new RequestTimeoutSimulator()
    const { id, promise } = sim.sendRequest<string>('turn/start', 5000)

    // Resolve before timeout
    sim.resolveRequest(id, 'done')
    const result = await promise
    expect(result).toBe('done')

    // Pending map should be clean
    expect(sim.pendingRequests.size).toBe(0)
  })

  it('handles multiple concurrent requests independently', async () => {
    const sim = new RequestTimeoutSimulator()
    const req1 = sim.sendRequest<string>('thread/start', 50) // Will timeout
    const req2 = sim.sendRequest<string>('turn/start', 5000)  // Will be resolved

    sim.resolveRequest(req2.id, 'resolved')

    const result2 = await req2.promise
    expect(result2).toBe('resolved')

    try {
      await req1.promise
      throw new Error('Should have timed out')
    } catch (err) {
      expect((err as Error).message).toContain('thread/start')
    }
  })
})
