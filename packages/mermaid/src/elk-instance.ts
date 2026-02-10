/**
 * Shared ELK instance singleton.
 *
 * Two paths:
 *   - Bun (tests): Uses elk-api.js + native Bun Worker (async init on first use)
 *   - Electron/Browser/Node: Uses elk.bundled.js (pure synchronous JS)
 *
 * The singleton is created lazily on first use and cached forever.
 * Provides both async (backward compat) and sync layout APIs.
 *
 * Sync path details:
 *   ELK's FakeWorker wraps both postMessage and onmessage in setTimeout(0),
 *   making the normal API fully async. To bypass this:
 *   1. During construction, we capture setTimeout(0) callbacks and flush them
 *      synchronously — this registers the layout algorithms immediately.
 *   2. For layout calls, we call dispatcher.saveDispatch() directly (skipping
 *      the FakeWorker's postMessage setTimeout) and intercept the result via
 *      rawWorker.onmessage (which the dispatcher calls synchronously).
 */

import type { ElkNode } from 'elkjs'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — static import of bundled ELK
import ELKBundled from 'elkjs/lib/elk.bundled.js'

export type ELKType = {
  layout: (graph: ElkNode) => Promise<ElkNode>
}

const isBun = typeof globalThis !== 'undefined' && 'Bun' in globalThis

let elk: ELKType | null = null

interface RawFakeWorker {
  postMessage(msg: unknown): void
  onmessage: ((e: { data: Record<string, unknown> }) => void) | null
  dispatcher: {
    saveDispatch(msg: { data: Record<string, unknown> }): void
  }
}

let rawWorker: RawFakeWorker | null = null

/**
 * Ensure the ELK singleton exists (non-Bun path).
 *
 * Patches setTimeout during construction to capture and synchronously flush
 * the algorithm registration callback that ELK queues via setTimeout(0).
 * Without this, layout calls fail with "algorithm not found" until the
 * next macrotask.
 */
function ensureElk(): ELKType {
  if (!elk) {
    // Capture setTimeout(0) callbacks queued during ELK construction
    // (the FakeWorker's postMessage wraps in setTimeout(0), which defers
    // the algorithm registration message)
    const pending: (() => void)[] = []
    const origSetTimeout = globalThis.setTimeout
    // @ts-ignore — simplified signature for our interception
    globalThis.setTimeout = (fn: () => void, delay?: number) => {
      if (delay === 0) { pending.push(fn); return 0 }
      return origSetTimeout(fn, delay)
    }

    elk = new ELKBundled() as unknown as ELKType

    // Restore setTimeout immediately
    globalThis.setTimeout = origSetTimeout

    // Flush captured callbacks synchronously — registers layout algorithms
    pending.forEach(fn => fn())

    // Cache the raw FakeWorker for elkLayoutSync()
    rawWorker = (elk as unknown as { worker: { worker: RawFakeWorker } }).worker.worker
  }
  return elk
}

/**
 * Get the shared ELK instance (async API, backward compatible).
 * For Bun: uses elk-api.js + Worker (first call initializes async).
 * For everything else: returns the bundled singleton immediately.
 */
export async function getElk(): Promise<ELKType> {
  if (elk) return elk

  if (isBun) {
    // Dynamic import hides these from Vite's static analyzer
    const apiPath = 'elkjs/lib/elk-api.js'
    const workerMod = 'elkjs/lib/elk-worker.js'
    const ELKApi = ((await import(/* @vite-ignore */ apiPath)) as { default: new (opts: unknown) => unknown }).default
    elk = new ELKApi({
      workerFactory: () => {
        const workerPath = (require as unknown as { resolve: (s: string) => string }).resolve(workerMod)
        return new (globalThis as unknown as { Worker: new (path: string) => unknown }).Worker(workerPath)
      },
    }) as unknown as ELKType
    return elk
  }

  return ensureElk()
}

/**
 * Run ELK layout synchronously.
 *
 * Bypasses BOTH of ELK's setTimeout(0) wrappers:
 *   - FakeWorker.postMessage wraps dispatch in setTimeout(0) — bypassed by
 *     calling dispatcher.saveDispatch() directly
 *   - PromisedWorker.onmessage wraps receive in setTimeout(0) — bypassed by
 *     replacing rawWorker.onmessage with a direct interceptor
 *
 * Only works with elk.bundled.js (non-Bun). In Bun tests, use the
 * async layoutGraph() instead.
 */
export function elkLayoutSync(graph: ElkNode): ElkNode {
  ensureElk()

  if (!rawWorker) {
    throw new Error('elkLayoutSync requires elk.bundled.js (not available in Bun)')
  }

  let result: ElkNode | undefined
  let error: unknown

  // Replace onmessage to intercept the result synchronously
  // (the dispatcher calls this directly, without setTimeout)
  const origOnmessage = rawWorker.onmessage
  rawWorker.onmessage = (answer: { data: Record<string, unknown> }) => {
    if (answer.data.error) {
      error = answer.data.error
    } else {
      result = answer.data.data as ElkNode
    }
  }

  // Call dispatcher.saveDispatch directly — bypasses FakeWorker.postMessage's
  // setTimeout(0) wrapper. The dispatcher processes the layout synchronously
  // and calls rawWorker.onmessage with the result.
  rawWorker.dispatcher.saveDispatch({ data: { id: 0, cmd: 'layout', graph } as unknown as Record<string, unknown> })

  // Restore original handler
  rawWorker.onmessage = origOnmessage

  if (error) throw error
  if (!result) throw new Error('ELK layout did not return synchronously')
  return result
}
