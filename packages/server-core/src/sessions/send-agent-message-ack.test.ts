import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { getSessionFilePath } from '@craft-agent/shared/sessions/storage'
import { SessionManager, createManagedSession } from './SessionManager.ts'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// These are actual manager/persistence/queue paths with controlled provider
// iterators. No live provider, installed application or session is involved.
describe('inter-agent admission acknowledgement', () => {
  let root: string
  let sm: SessionManager
  let events: Array<{ type: string; sessionId: string; error?: string }>
  let completions: Map<string, ReturnType<typeof deferred<void>>>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-ack-'))
    sm = new SessionManager()
    events = []
    completions = new Map()
    ;(sm as any).eventSink = (_channel: unknown, _target: unknown, event: any) => {
      events.push(event)
      if (event.type === 'complete') completions.get(event.sessionId)?.resolve()
    }
  })

  afterEach(() => {
    mock.restore()
    rmSync(root, { recursive: true, force: true })
  })

  function session(id: string) {
    const workspace = { id: 'ws-ack', name: 'Ack tests', rootPath: root, createdAt: Date.now() }
    const managed = createManagedSession({ id, name: 'Existing named session' }, workspace as never, { messagesLoaded: true })
    ;(sm as any).sessions.set(id, managed)
    completions.set(id, deferred())
    return managed
  }

  function send(id: string, message: string) {
    return (sm as any).sendAgentMessageUntilAccepted(id, message) as Promise<{ delivery: string; targetBusy: boolean }>
  }

  function persisted(id: string) {
    return readFileSync(getSessionFilePath(root, id), 'utf8').trim().split('\n').slice(1).map(line => JSON.parse(line))
  }

  function controlledAgent(managed: ReturnType<typeof session>, run: () => AsyncGenerator<any>) {
    const agent = {
      getModel: () => 'claude-sonnet-4-6',
      getSessionId: () => 'test-sdk-' + managed.id,
      setAllSources: () => {},
      redirect: () => false,
      chat: run,
    }
    managed.agent = agent as never
    return agent
  }

  function registeredSend(managed: ReturnType<typeof session>) {
    // Execute the real initializer in the manager's callback registration, not
    // merely its new helper. This catches a binding reverted to whole-turn await
    // without constructing a provider or touching credential-backed factories.
    const path = new URL('./SessionManager.ts', import.meta.url)
    const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const initializers: ts.Expression[] = []
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'mergeSessionScopedToolCallbacks') {
        const callbacks = node.arguments[1]
        if (callbacks && ts.isObjectLiteralExpression(callbacks)) {
          for (const field of callbacks.properties) {
            if (ts.isPropertyAssignment(field) && field.name.getText(source) === 'sendAgentMessageFn') {
              initializers.push(field.initializer)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(initializers).toHaveLength(1)
    const expression = new Bun.Transpiler({ loader: 'ts', target: 'bun' })
      .transformSync('function registered(managed) { return ' + initializers[0]!.getText(source) + '; }')
    return new Function(expression + '; return registered;')().call(sm, managed) as
      (id: string, message: string) => Promise<{ delivery: string; targetBusy: boolean }>
  }

  it('acks the idle recipient after disk flush while its turn is unresolved', async () => {
    const managed = session('idle')
    const entered = deferred()
    const finish = deferred()
    const agent = controlledAgent(managed, async function* () {
      entered.resolve()
      await finish.promise
      yield { type: 'complete' }
    })
    ;(sm as any).getOrCreateAgent = async () => agent

    const receipt = registeredSend(managed)('idle', 'accepted before complete')
    try {
      const outcome = await Promise.race([
        receipt.then(ack => ({ kind: 'accepted' as const, ack })),
        Bun.sleep(250).then(() => ({ kind: 'awaiting-turn' as const })),
      ])
      expect(outcome.kind).toBe('accepted')
      if (outcome.kind !== 'accepted') throw new Error('callback still awaits recipient turn')
      expect(outcome.ack).toEqual({ delivery: 'delivered', targetBusy: false })
      expect(persisted('idle').filter(m => m.content === 'accepted before complete')).toHaveLength(1)
      await entered.promise
      expect(managed.isProcessing).toBe(true)
      expect(events.some(e => e.type === 'complete')).toBe(false)
    } finally {
      finish.resolve()
      await completions.get('idle')!.promise
    }
    expect(managed.isProcessing).toBe(false)
  })

  it('queues a busy recipient exactly once and persists before acknowledging', async () => {
    const managed = session('busy')
    managed.isProcessing = true
    expect(await send('busy', 'one queued message')).toEqual({ delivery: 'queued', targetBusy: true })
    expect(managed.messageQueue.filter(q => q.message === 'one queued message')).toHaveLength(1)
    expect(persisted('busy').filter(m => m.content === 'one queued message')).toHaveLength(1)
  })

  it('rejects missing sessions and pre-admission disk failures', async () => {
    await expect(send('missing', 'not accepted')).rejects.toThrow('not found')
    session('disk-failure')
    spyOn(sm as any, 'flushSession').mockRejectedValue(new Error('disk unavailable'))
    await expect(send('disk-failure', 'not acknowledged')).rejects.toThrow('disk unavailable')
    expect(events.some(e => e.type === 'complete')).toBe(false)
  })

  it('keeps a later recipient iterator failure visible through normal manager events', async () => {
    const managed = session('recipient-error')
    const entered = deferred()
    const fail = deferred()
    const agent = controlledAgent(managed, async function* () {
      entered.resolve()
      await fail.promise
      throw new Error('recipient provider failed')
    })
    ;(sm as any).getOrCreateAgent = async () => agent
    expect((await send(managed.id, 'accepted')).delivery).toBe('delivered')
    await entered.promise
    fail.resolve()
    await completions.get(managed.id)!.promise
    expect(events.some(e => e.type === 'error' && e.error === 'recipient provider failed')).toBe(true)
    expect(managed.isProcessing).toBe(false)
  })

  it('cleans up a real post-admission agent setup failure so the next message can run', async () => {
    const managed = session('setup-error')
    ;(sm as any).getOrCreateAgent = async () => { throw new Error('agent setup failed') }
    expect((await send(managed.id, 'first accepted')).delivery).toBe('delivered')
    await completions.get(managed.id)!.promise
    expect(events.some(e => e.type === 'error' && e.error === 'agent setup failed')).toBe(true)
    expect(managed.isProcessing).toBe(false)

    completions.set(managed.id, deferred())
    const agent = controlledAgent(managed, async function* () { yield { type: 'complete' } })
    ;(sm as any).getOrCreateAgent = async () => agent
    expect((await send(managed.id, 'next accepted')).delivery).toBe('delivered')
    await completions.get(managed.id)!.promise
    expect(managed.messageQueue).toHaveLength(0)
    expect(persisted(managed.id).filter(m => m.content === 'next accepted')).toHaveLength(1)
  })

  it('observes a rejected lifecycle after ack rather than leaving an unhandled rejection', async () => {
    const managed = session('outer-error')
    const late = deferred()
    spyOn(sm, 'sendMessage').mockImplementation(async (...args) => {
      args[7]?.('persisted-message')
      await late.promise
      throw new Error('late lifecycle rejection')
    })
    const reported = deferred()
    ;(sm as any).eventSink = (_channel: unknown, _target: unknown, event: any) => {
      events.push(event)
      if (event.type === 'error') reported.resolve()
    }
    expect((await send(managed.id, 'accepted')).delivery).toBe('delivered')
    late.resolve()
    await reported.promise
    expect(events.filter(e => e.error === 'late lifecycle rejection')).toHaveLength(1)
  })

  it('does not claim admission when sendMessage returns without an ack', async () => {
    session('no-ack')
    spyOn(sm, 'sendMessage').mockResolvedValue(undefined)
    await expect(send('no-ack', 'not admitted')).rejects.toThrow('without persisting')
  })

  it('allows reciprocal sends without waiting for either whole turn', async () => {
    const a = session('a')
    const b = session('b')
    const finish = deferred()
    const entered = new Map([['a', deferred()], ['b', deferred()]])
    const agents = new Map([a, b].map(m => [m.id, controlledAgent(m, async function* () {
      entered.get(m.id)!.resolve()
      await finish.promise
      yield { type: 'complete' }
    })]))
    ;(sm as any).getOrCreateAgent = async (m: typeof a) => agents.get(m.id)
    await Promise.all([send('a', 'start a'), send('b', 'start b')])
    await Promise.all([...entered.values()].map(d => d.promise))
    const receipts = await Promise.all([send('b', 'from a'), send('a', 'from b')])
    expect(receipts.every(r => r.delivery === 'queued')).toBe(true)
    expect(a.messageQueue.filter(q => q.message === 'from b')).toHaveLength(1)
    expect(b.messageQueue.filter(q => q.message === 'from a')).toHaveLength(1)
    // Avoid replay in this bounded lifecycle fixture; queue admission itself is
    // asserted above and existing midstream tests own replay behavior.
    a.messageQueue = []
    b.messageQueue = []
    finish.resolve()
    await Promise.all([...completions.values()].map(d => d.promise))
  })
})
