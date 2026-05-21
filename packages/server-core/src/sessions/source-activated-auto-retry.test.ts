import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentEvent } from '@craft-agent/shared/agent'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// Regression test for the source-activated headless auto-retry gap.
//
// Background: v0.9.5 introduced SourceActivationDrainController which drains
// sibling tool_results before firing `source_activated` + `forceAbort`. That
// fixed the orphan-tool_use deadlock. But the re-send of the user message
// (with a "[<slug> activated]" suffix) was only implemented in the Electron
// renderer (`apps/electron/src/renderer/App.tsx`). Headless deployments
// (the WebUI bundle and the docker `craft-agents-server` image) had no
// equivalent, so any automation that triggered `source_test` aborted the
// turn with no replay — leaving orchestrator prompts permanently stalled
// after the first source activation.
//
// The fix moves the auto-retry into SessionManager.processEvent's
// `source_activated` handler so every deployment chains source activations
// the same way.

describe('source_activated server-side auto-retry', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-source-activated-'))
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string) {
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id, name: 'source-activated test' },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  /** Stub sm.sendMessage and capture invocations. */
  function spyOnSendMessage() {
    const calls: Array<{ sessionId: string; message: string }> = []
    ;(sm as unknown as { sendMessage: unknown }).sendMessage = async (
      sessionId: string,
      message: string,
    ): Promise<void> => {
      calls.push({ sessionId, message })
    }
    return calls
  }

  function invokeProcessEvent(managed: unknown, event: AgentEvent): Promise<void> {
    const fn = (sm as unknown as { processEvent: (m: unknown, e: AgentEvent) => Promise<void> }).processEvent
    return fn.call(sm, managed, event)
  }

  it('re-sends the original message with "[<slug> activated]" suffix after source_activated', async () => {
    const sessionId = 'sa-basic'
    const managed = buildSession(sessionId)
    const sendCalls = spyOnSendMessage()

    await invokeProcessEvent(managed, {
      type: 'source_activated',
      sourceSlug: 'gsc',
      originalMessage: 'Run @mytrainer-seo-geo-orchestrator',
    } as AgentEvent)

    // Auto-retry is on a 100ms setTimeout to let the abort propagate.
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(sendCalls).toHaveLength(1)
    expect(sendCalls[0]?.sessionId).toBe(sessionId)
    expect(sendCalls[0]?.message).toBe('Run @mytrainer-seo-geo-orchestrator\n\n[gsc activated]')
  })

  it('chains multiple source activations end-to-end (the SEO/GEO orchestrator case)', async () => {
    const sessionId = 'sa-chained'
    const managed = buildSession(sessionId)
    const sendCalls = spyOnSendMessage()

    await invokeProcessEvent(managed, {
      type: 'source_activated',
      sourceSlug: 'gsc',
      originalMessage: 'orchestrator-prompt',
    } as AgentEvent)
    await new Promise(resolve => setTimeout(resolve, 200))

    await invokeProcessEvent(managed, {
      type: 'source_activated',
      sourceSlug: 'sanity',
      originalMessage: 'orchestrator-prompt',
    } as AgentEvent)
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(sendCalls).toHaveLength(2)
    expect(sendCalls[0]?.message).toBe('orchestrator-prompt\n\n[gsc activated]')
    expect(sendCalls[1]?.message).toBe('orchestrator-prompt\n\n[sanity activated]')
  })

  it('skips auto-retry if a follow-up user message arrives before the 100ms timer fires', async () => {
    const sessionId = 'sa-dedup'
    const managed = buildSession(sessionId) as { messages: unknown[] }
    const sendCalls = spyOnSendMessage()

    await invokeProcessEvent(managed as never, {
      type: 'source_activated',
      sourceSlug: 'dataforseo',
      originalMessage: 'first',
    } as AgentEvent)

    // Simulate a different sender (legacy renderer, user typing) racing in
    // before the 100ms server-side retry fires.
    managed.messages.push({ id: 'mid-race', role: 'user', content: 'raced', timestamp: Date.now() })

    await new Promise(resolve => setTimeout(resolve, 200))

    expect(sendCalls).toHaveLength(0)
  })
})
