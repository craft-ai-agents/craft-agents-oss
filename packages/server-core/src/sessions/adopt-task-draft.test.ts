import { describe, expect, it } from 'bun:test'
import { SessionManager } from './SessionManager.ts'

// Locks the adoption state machine that prevents "Generate → Create & Run" from minting a duplicate
// top-level orchestrator (#bug1). The success path needs full storage wiring, so here we pin the
// four guard branches that must NEVER promote — they're the correctness guarantees the external
// review asked for (no silent capture of an unrelated/non-draft session).
describe('adoptGeneratedTaskOrchestrator guards', () => {
  function seed(sm: SessionManager, id: string, fields: { taskDraft?: boolean; taskSlug?: string }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(sm as any).sessions.set(id, { id, ...fields })
  }

  it('returns false when the session does not exist', async () => {
    const sm = new SessionManager()
    expect(await sm.adoptGeneratedTaskOrchestrator('missing', 'slug-a')).toBe(false)
  })

  it('returns false when the session is not a task draft', async () => {
    const sm = new SessionManager()
    seed(sm, 'plain', { taskDraft: false })
    expect(await sm.adoptGeneratedTaskOrchestrator('plain', 'slug-a')).toBe(false)
  })

  it('is an idempotent no-op (true) when already bound to the same slug', async () => {
    const sm = new SessionManager()
    seed(sm, 'orch', { taskDraft: false, taskSlug: 'slug-a' })
    expect(await sm.adoptGeneratedTaskOrchestrator('orch', 'slug-a')).toBe(true)
  })

  it('refuses (false) to rebind a session already bound to a different slug', async () => {
    const sm = new SessionManager()
    seed(sm, 'orch', { taskDraft: false, taskSlug: 'slug-a' })
    expect(await sm.adoptGeneratedTaskOrchestrator('orch', 'slug-b')).toBe(false)
    // The existing binding is untouched.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((sm as any).sessions.get('orch').taskSlug).toBe('slug-a')
  })
})

// bindExistingSessionToTask attaches an authored spec onto a *visible* (non-draft) tile — the
// edit-mode save path. Unlike adopt it doesn't require `taskDraft`, but it must still never
// hijack a session already owned by a different task. The success path persists/flushes (needs
// storage wiring), so we pin the three early-return guards that run before any I/O.
describe('bindExistingSessionToTask guards', () => {
  function seed(sm: SessionManager, id: string, fields: { taskDraft?: boolean; taskSlug?: string }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(sm as any).sessions.set(id, { id, ...fields })
  }

  it('returns false when the session does not exist', async () => {
    const sm = new SessionManager()
    expect(await sm.bindExistingSessionToTask('missing', 'slug-a')).toBe(false)
  })

  it('is an idempotent no-op (true) when already bound to the same slug', async () => {
    const sm = new SessionManager()
    seed(sm, 'orch', { taskSlug: 'slug-a' })
    expect(await sm.bindExistingSessionToTask('orch', 'slug-a')).toBe(true)
  })

  it('refuses (false) to rebind a session already owned by a different slug', async () => {
    const sm = new SessionManager()
    seed(sm, 'orch', { taskSlug: 'slug-a' })
    expect(await sm.bindExistingSessionToTask('orch', 'slug-b')).toBe(false)
    // The existing binding is untouched.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((sm as any).sessions.get('orch').taskSlug).toBe('slug-a')
  })
})

// PR #415 follow-up: adopt/bind must route model/cwd/permission through the canonical live-update
// mutators (so the running agent + renderer stay consistent, not just the on-disk metadata), and
// must NOT churn the agent when nothing changed. We stub the (separately-tested) mutators + the
// persistence seam so these tests isolate the delegation contract without full storage wiring.
describe('adopt/bind route changed fields through canonical live-update mutators', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function harness(seedFields: Record<string, unknown>) {
    const sm = new SessionManager()
    const calls = { model: [] as unknown[], cwd: [] as unknown[], mode: [] as unknown[] }
    const events: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const any = sm as any
    any.sendEvent = (e: { type: string }) => events.push(e.type)
    any.persistSession = () => {}
    any.flushSession = async () => {}
    any.setMetadataWriteGuard = () => {}
    any.updateSessionModel = async (_id: string, _ws: string, m: string) => { calls.model.push(m) }
    any.updateWorkingDirectory = (_id: string, p: string) => { calls.cwd.push(p) }
    any.setSessionPermissionMode = (_id: string, m: string) => { calls.mode.push(m) }
    any.sessions.set('s', {
      id: 's',
      taskDraft: true,
      messages: [],
      connectionLocked: false,
      model: 'old-model',
      llmConnection: 'old-conn',
      permissionMode: 'ask',
      workingDirectory: '/old/dir',
      workspace: { id: 'ws', rootPath: '/tmp/ws' },
      ...seedFields,
    })
    return { sm, calls, events }
  }

  const CHANGED = { model: 'new-model', workingDirectory: '/new/dir', permissionMode: 'allow-all' as const, llmConnection: 'new-conn' }

  it('adopt delegates each changed field to its canonical mutator + sets connection directly', async () => {
    const { sm, calls, events } = harness({})
    expect(await sm.adoptGeneratedTaskOrchestrator('s', 'slug', CHANGED)).toBe(true)
    expect(calls.model).toEqual(['new-model'])
    expect(calls.cwd).toEqual(['/new/dir'])
    expect(calls.mode).toEqual(['allow-all'])
    // Connection can't go through setSessionConnection (session has started) → set directly + event.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((sm as any).sessions.get('s').llmConnection).toBe('new-conn')
    expect(events).toContain('connection_changed')
    expect(events).toContain('session_metadata_changed')
  })

  it('adopt does NOT touch the mutators when nothing changed (no agent churn)', async () => {
    const { sm, calls } = harness({ model: 'm', workingDirectory: '/d', permissionMode: 'ask', llmConnection: 'c' })
    expect(
      await sm.adoptGeneratedTaskOrchestrator('s', 'slug', {
        model: 'm', workingDirectory: '/d', permissionMode: 'ask', llmConnection: 'c',
      }),
    ).toBe(true)
    expect(calls.model).toEqual([])
    expect(calls.cwd).toEqual([])
    expect(calls.mode).toEqual([])
  })

  it('bind delegates each changed field to its canonical mutator', async () => {
    const { sm, calls } = harness({ taskDraft: false })
    expect(await sm.bindExistingSessionToTask('s', 'slug', CHANGED)).toBe(true)
    expect(calls.model).toEqual(['new-model'])
    expect(calls.cwd).toEqual(['/new/dir'])
    expect(calls.mode).toEqual(['allow-all'])
  })

  it('bind does NOT touch the mutators when nothing changed', async () => {
    const { sm, calls } = harness({ taskDraft: false, model: 'm', workingDirectory: '/d', permissionMode: 'ask', llmConnection: 'c' })
    expect(
      await sm.bindExistingSessionToTask('s', 'slug', {
        model: 'm', workingDirectory: '/d', permissionMode: 'ask', llmConnection: 'c',
      }),
    ).toBe(true)
    expect(calls.model).toEqual([])
    expect(calls.cwd).toEqual([])
    expect(calls.mode).toEqual([])
  })
})
