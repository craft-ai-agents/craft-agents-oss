/**
 * SessionManager must tear down the Craft Pages listeners it started.
 *
 * Without this the loopback servers outlive the manager: on workspace switch or
 * app shutdown the ports stay bound, and every restart leaks another one.
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionManager } from './SessionManager.ts'
import type { PagesRuntime } from '../pages/runtime.ts'

const KEY = 'CRAFT_FEATURE_CRAFT_PAGES'
const original = process.env[KEY]
let ws: string
let sm: SessionManager

beforeEach(() => {
  process.env[KEY] = '1'
  ws = mkdtempSync(join(tmpdir(), 'craft-sm-pages-'))
  sm = new SessionManager()
})

afterEach(async () => {
  // Belt and braces: if the assertion failed, still release the port.
  await (sm as unknown as { pagesRuntime: PagesRuntime }).pagesRuntime.disposeAll().catch(() => {})
  rmSync(ws, { recursive: true, force: true })
  if (original === undefined) delete process.env[KEY]
  else process.env[KEY] = original
})

describe('SessionManager.cleanup', () => {
  it('disposes Craft Pages listeners', async () => {
    const runtime = (sm as unknown as { pagesRuntime: PagesRuntime }).pagesRuntime
    await runtime.ensureStarted(ws)
    expect(runtime.isRunning(ws)).toBe(true)

    sm.cleanup()

    // cleanup() is synchronous by contract; disposal is fire-and-forget.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(runtime.isRunning(ws)).toBe(false)
  })

  it('is safe to call when no pages listener was ever started', () => {
    expect(() => sm.cleanup()).not.toThrow()
  })
})
