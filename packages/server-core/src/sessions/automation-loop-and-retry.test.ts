import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PendingPrompt } from '@craft-agent/shared/automations'
import { MAX_AUTOMATION_CHAIN_DEPTH, SessionManager, buildActivationRetryMessage, createManagedSession } from './SessionManager.ts'

// Found in a decision-harness test run: an automation's own session got the label it listens to
// and re-triggered it, and source-activation retries re-ran per-message decisions and dropped
// mid-turn corrections.
describe('automation loop guard', () => {
  let tmpRoot: string
  let sm: SessionManager
  const workspace = () => ({ id: 'ws-test', name: 'Test Workspace', rootPath: tmpRoot, createdAt: Date.now() })

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-automation-loop-'))
    sm = new SessionManager()
    ;(sm as any).decisionFeatureActive = () => false
    ;(sm as any).persistSession = () => {}
    sm.setEventSink(() => {})
  })

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }))

  function sessionWith(id: string, triggeredBy?: Record<string, unknown>) {
    const managed = createManagedSession({ id, name: id }, workspace() as never, { messagesLoaded: true })
    if (triggeredBy) managed.triggeredBy = triggeredBy
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  const pending = (sessionId: string, matcherId = 'packing', automationName = 'Packing list'): PendingPrompt => ({
    sessionId: undefined,
    matcherId,
    automationName,
    prompt: 'List 5 things to pack',
    mentions: [],
    event: 'LabelAdd',
    eventPayload: { sessionId, label: 'trip' },
  })

  it('never lets an automation re-trigger itself through the session it created', () => {
    sessionWith('user-session')
    sessionWith('auto-session', { automationName: 'Packing list', automationId: 'packing', depth: 1 })
    sessionWith('legacy-auto-session', { automationName: 'Packing list' })

    expect((sm as any).automationLoopGuard(pending('user-session'))).toEqual({ run: true, depth: 1 })
    expect((sm as any).automationLoopGuard(pending('auto-session')).run).toBe(false)
    // Sessions created before ids were recorded match by name.
    expect((sm as any).automationLoopGuard(pending('legacy-auto-session')).run).toBe(false)
    // Another automation may react to it, one level deeper.
    expect((sm as any).automationLoopGuard(pending('auto-session', 'triage', 'Bug triage'))).toEqual({ run: true, depth: 2 })
  })

  it('stops chains through other automations at the depth cap', () => {
    sessionWith('deep', { automationName: 'A', automationId: 'a', depth: MAX_AUTOMATION_CHAIN_DEPTH })
    const verdict = (sm as any).automationLoopGuard(pending('deep', 'b', 'B'))
    expect(verdict.run).toBe(false)
    expect(verdict.reason).toContain('chain')
  })

  it('skips a looping run before its condition check and records it as skipped', async () => {
    sessionWith('auto-session', { automationName: 'Packing list', automationId: 'packing', depth: 1 })
    let created = 0
    ;(sm as any).executePromptAutomation = async () => { created++; return { sessionId: 'x' } }
    let conditionChecks = 0
    ;(sm as any).shouldRunPromptAutomation = async () => { conditionChecks++; return { run: true } }

    await (sm as any).runReadyPrompts('ws-test', tmpRoot, [{ ...pending('auto-session'), semanticCondition: { question: 'Trip?' } }])
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(created).toBe(0)
    expect(conditionChecks).toBe(0)
    const history = join(tmpRoot, 'automations-history.jsonl')
    expect(existsSync(history)).toBe(true)
    const entry = JSON.parse(readFileSync(history, 'utf-8').trim().split('\n').at(-1)!)
    expect(entry).toMatchObject({ id: 'packing', ok: true })
    expect(entry.skipped).toContain('loop guard')
  })

  it('records the automation id and chain depth on the session it creates', async () => {
    sessionWith('user-session')
    let input: Record<string, unknown> | undefined
    ;(sm as any).executePromptAutomation = async (value: Record<string, unknown>) => { input = value; return { sessionId: 'x' } }

    await (sm as any).runReadyPrompts('ws-test', tmpRoot, [pending('user-session')])

    expect(input).toMatchObject({ automationId: 'packing', triggerEvent: 'LabelAdd', chainDepth: 1 })
  })
})

describe('source-activation auto-retry', () => {
  it('puts corrections steered into the turn after the original request', () => {
    expect(buildActivationRetryMessage('Plan Szárszó', [], 'openweather')).toEqual({
      plain: 'Plan Szárszó\n\n[openweather activated]',
      retry: 'Plan Szárszó\n\n[openweather activated]',
    })
    expect(buildActivationRetryMessage('Plan Szárszó', ['make it Balatonfűzfő', '  '], 'openweather')).toEqual({
      plain: 'Plan Szárszó\n\n[openweather activated]',
      retry: 'Plan Szárszó\n\nmake it Balatonfűzfő\n\n[openweather activated]',
    })
  })

  it('keeps the turn\'s thinking decision and asks nothing again', async () => {
    const sm = new SessionManager()
    let asked = 0
    ;(sm as any).decisionFeatureActive = () => { asked++; return true }
    const managed = createManagedSession({ id: 's', name: 's' }, { id: 'w', name: 'w', rootPath: tmpdir(), createdAt: 1 } as never, { messagesLoaded: true })
    managed.thinkingLevel = 'max'

    managed.turnThinkingOverride = 'high'
    const kept = await (sm as any).startPreTurnDecisions(managed, 'Plan the trip\n\n[openweather activated]', { hidden: true }, { activationResend: true })
    expect(kept).toEqual({ thinkingOverride: 'high', suggestionHint: null })

    managed.turnThinkingOverride = null
    expect((sm as any).startPreTurnDecisions(managed, 'x\n\n[a activated]', { hidden: true }, { activationResend: true })).toBeNull()
    expect(asked).toBe(0)
  })

  // Found in the 2026-09-30 decision log: every "OAuth token revoked" 401 re-ran both turn-start
  // decisions for the same message and wrote the suggestions follow-up twice.
  it('keeps an auth retry\'s thinking level and hint, asks nothing again and keeps the request\'s trace', async () => {
    const sm = new SessionManager()
    let asked = 0
    ;(sm as any).decisionFeatureActive = () => { asked++; return true }
    const managed = createManagedSession({ id: 's', name: 's' }, { id: 'w', name: 'w', rootPath: tmpdir(), createdAt: 1 } as never, { messagesLoaded: true })
    managed.thinkingLevel = 'max'
    managed.turnThinkingOverride = 'low'
    managed.turnSuggestionHint = '<system-reminder>Use the dri-board skill.</system-reminder>'
    const trace = { trace: { decisionId: 'd1', candidates: [] } as never, used: new Set<string>() }
    managed.suggestionTrace = trace

    const kept = await (sm as any).startPreTurnDecisions(managed, 'Update the DRI board', undefined, { authRetry: true })
    expect(kept).toEqual({ thinkingOverride: 'low', suggestionHint: '<system-reminder>Use the dri-board skill.</system-reminder>' })
    expect(managed.suggestionTrace).toBe(trace)
    expect(asked).toBe(0)
  })

  it('does not rate the thinking level of hidden messages such as background-task nudges', () => {
    const sm = new SessionManager()
    ;(sm as any).decisionFeatureActive = () => true
    const managed = createManagedSession({ id: 's', name: 's' }, { id: 'w', name: 'w', rootPath: tmpdir(), createdAt: 1 } as never, { messagesLoaded: true })
    managed.thinkingLevel = 'max'
    const nudge = '[background-task-completed] The background agent you launched (Map code) has finished.'
    // The previous turn's answer no longer matches the last reply once another message ran.
    managed.thinkingTrace = { answers: {} } as never
    expect((sm as any).startPreTurnDecisions(managed, nudge, { hidden: true })).toBeNull()
    expect(managed.thinkingTrace).toBeUndefined()
  })
})
