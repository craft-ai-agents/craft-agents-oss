import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  getSessionFilePath,
  getSessionPath,
  listSessions,
  loadSession,
  writeSessionJsonl,
  type StoredSession,
} from '@craft-agent/shared/sessions'
import { getProjectPath, saveProjectConfig } from '@craft-agent/shared/projects'
import { RPC_CHANNELS, type ProjectMoveEntry, type SessionEvent } from '@craft-agent/shared/protocol'
import { storedToMessage, type StoredMessage } from '@craft-agent/core/types'
import type { HandlerFn, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handlers/handler-deps'
import { registerSessionsHandlers } from '../handlers/rpc/sessions'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// Project moves on SessionManager: the family cascade on real sessions, what gets saved where, the
// events, Undo, the task paths and the RPC command. Sessions are seeded as if left by an earlier
// run (messages not loaded) unless a test opens them.

type Managed = ReturnType<typeof createManagedSession>

describe('moving chat families between projects', () => {
  let root: string
  let otherRoot: string
  let sm: SessionManager
  let events: SessionEvent[]

  const workspace = (id = 'ws_test', rootPath = root) => ({ id, name: id, rootPath, createdAt: 1 }) as never

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sm-project-families-'))
    otherRoot = mkdtempSync(join(tmpdir(), 'sm-project-families-other-'))
    sm = new SessionManager()
    events = []
    sm.setEventSink(((_channel: string, _target: unknown, event: SessionEvent) => { events.push(event) }) as never)
    for (const id of ['app', 'docs', 'next', 'later']) seedProject(id)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(otherRoot, { recursive: true, force: true })
  })

  function seedProject(id: string) {
    saveProjectConfig(root, { id, slug: id, name: id, createdAt: 1, updatedAt: 1 })
  }

  function sessionsOf(manager: SessionManager): Map<string, Managed> {
    return (manager as unknown as { sessions: Map<string, Managed> }).sessions
  }

  interface Seed {
    parentSessionId?: string
    /** Id of the session this one was branched from */
    branchFrom?: string
    projectId?: string
    projectOverride?: true
    workingDirectory?: string
    taskDraft?: boolean
    messages?: number
    /** Opened in this run: messages loaded */
    loaded?: boolean
    otherWorkspace?: boolean
  }

  function seed(id: string, o: Seed = {}): Managed {
    const rootPath = o.otherWorkspace ? otherRoot : root
    const filePath = getSessionFilePath(rootPath, id)
    mkdirSync(dirname(filePath), { recursive: true })
    const messages = Array.from({ length: o.messages ?? 0 }, (_, i) =>
      ({ id: `${id}-m${i}`, type: 'user', content: `message ${i} of ${id}`, timestamp: 1 }) as StoredMessage)
    const fields = {
      id,
      name: id,
      sessionStatus: 'todo',
      labels: [] as string[],
      parentSessionId: o.parentSessionId,
      branchFromSessionPath: o.branchFrom ? getSessionPath(rootPath, o.branchFrom) : undefined,
      projectId: o.projectId,
      projectOverride: o.projectOverride,
      workingDirectory: o.workingDirectory,
      taskDraft: o.taskDraft,
      createdAt: 1,
    }
    writeSessionJsonl(filePath, { ...fields, workspaceRootPath: rootPath, lastUsedAt: 1, messages } as StoredSession)
    const managed = createManagedSession(
      fields,
      o.otherWorkspace ? workspace('ws_other', otherRoot) : workspace(),
      o.loaded ? { messagesLoaded: true, messages: messages.map(storedToMessage) } : undefined,
    )
    sessionsOf(sm).set(id, managed)
    return managed
  }

  const project = (id: string, rootPath = root) => loadSession(rootPath, id)?.projectId
  const marker = (id: string, rootPath = root) => loadSession(rootPath, id)?.projectOverride
  const projectEvents = () => events.flatMap(e => e.type === 'project_id_changed' ? [`${e.sessionId}:${e.projectId}`] : [])
  const fileOf = (id: string, rootPath = root) => readFileSync(getSessionFilePath(rootPath, id), 'utf-8')
  const messageLines = (id: string) => fileOf(id).split('\n').slice(1).join('\n')

  // --- From the community PR (#1164) ---

  it('reapplying a project fills in existing children and grandchildren without changing their work', async () => {
    seed('parent', { projectId: 'app' })
    seed('child', { parentSessionId: 'parent' })
    seed('grandchild', { parentSessionId: 'child', workingDirectory: '/existing-checkout', messages: 1 })
    seed('unrelated', { projectId: 'app' })

    await sm.setSessionProjectId('parent', 'app')
    expect(project('child')).toBe('app')
    expect(project('grandchild')).toBe('app')
    expect(loadSession(root, 'grandchild')?.workingDirectory).toBe('/existing-checkout')
    expect(loadSession(root, 'grandchild')?.messages.map(m => m.id)).toEqual(['grandchild-m0'])

    await sm.setSessionProjectId('parent', 'next')
    expect(project('grandchild')).toBe('next')
    expect(project('unrelated')).toBe('app')

    await sm.setSessionProjectId('parent', null)
    expect(project('grandchild')).toBeUndefined()
    expect(project('unrelated')).toBe('app')
  })

  it('preserves separately assigned branches including an explicit No project', async () => {
    seed('parent', { projectId: 'app' })
    seed('override', { parentSessionId: 'parent', projectId: 'docs' })
    seed('under-override', { parentSessionId: 'override', projectId: 'docs' })
    seed('clear', { parentSessionId: 'parent', projectId: 'app' })
    seed('inherited', { parentSessionId: 'parent', projectId: 'app' })

    await sm.setSessionProjectId('clear', null)
    await sm.setSessionProjectId('parent', 'next')

    expect(project('override')).toBe('docs')
    expect(project('under-override')).toBe('docs')
    expect(project('clear')).toBeUndefined()
    expect(marker('clear')).toBe(true)
    expect(project('inherited')).toBe('next')
  })

  it('moves multiple selected chats and their families, even when a selected child was an override', async () => {
    seed('parent', { projectId: 'app' })
    seed('override', { parentSessionId: 'parent', projectId: 'docs' })
    seed('under-override', { parentSessionId: 'override', projectId: 'docs' })
    seed('inherited', { parentSessionId: 'parent', projectId: 'app' })
    seed('other-parent')
    seed('other-child', { parentSessionId: 'other-parent' })

    await sm.setSessionProjectId('override', 'next', ['parent', 'other-parent', 'inherited'])
    for (const id of ['parent', 'override', 'under-override', 'inherited', 'other-parent', 'other-child']) {
      expect(project(id)).toBe('next')
    }

    await sm.setSessionProjectId('parent', 'later')
    for (const id of ['override', 'under-override', 'inherited']) {
      expect(project(id)).toBe('later')
    }
    expect(project('other-child')).toBe('next')
  })

  // --- Events, result, what is saved ---

  it('tells clients once per chat that moved and returns what each one had before', async () => {
    seed('root', { projectId: 'app' })
    seed('kid', { parentSessionId: 'root', projectId: 'app' })
    seed('unassigned-kid', { parentSessionId: 'root' })
    seed('apart', { parentSessionId: 'root', projectId: 'docs', projectOverride: true })

    const result = await sm.setSessionProjectId('root', 'next')

    expect(result.moved).toEqual([
      { id: 'root', previousProjectId: 'app', previousOverride: false },
      { id: 'kid', previousProjectId: 'app', previousOverride: false },
      { id: 'unassigned-kid', previousProjectId: null, previousOverride: false },
    ])
    expect(projectEvents()).toEqual(['root:next', 'kid:next', 'unassigned-kid:next'])
    expect(project('apart')).toBe('docs')

    // Nothing left to change: no events, nothing moved
    events = []
    expect(await sm.setSessionProjectId('root', 'next')).toEqual({ moved: [] })
    expect(projectEvents()).toEqual([])
  })

  it('patches only the header of a chat nobody opened: its transcript is neither loaded nor rewritten', async () => {
    seed('root')
    const cold = seed('cold', { parentSessionId: 'root', messages: 3 })
    const before = messageLines('cold')

    await sm.setSessionProjectId('root', 'next')

    expect(cold.messagesLoaded).toBe(false)
    expect(cold.messages).toEqual([])
    expect(project('cold')).toBe('next')
    expect(messageLines('cold')).toBe(before)
    expect(loadSession(root, 'cold')?.messages.map(m => m.id)).toEqual(['cold-m0', 'cold-m1', 'cold-m2'])
  })

  it('a chat opened while its header is patched keeps its whole transcript on the next save', async () => {
    const chat = seed('opened-mid-move', { messages: 400 })
    const file = getSessionFilePath(root, 'opened-mid-move')
    const internals = sm as unknown as { ensureMessagesLoaded: (managed: Managed) => Promise<void> }
    let moved = false
    const move = sm.setSessionProjectId('opened-mid-move', 'app').finally(() => { moved = true })

    // Open the chat (the renderer asking for its messages) the moment its file is missing, if it ever
    // is: a missing file loads as an empty chat, and the chat's next save writes no messages. Polls
    // between event-loop turns, while the file operations run on other threads.
    let openedWhileMissing: Promise<void> | undefined
    while (!moved && !openedWhileMissing) {
      await new Promise(resolve => setImmediate(resolve))
      const until = performance.now() + 2
      while (!openedWhileMissing && performance.now() < until) {
        if (!existsSync(file)) openedWhileMissing = internals.ensureMessagesLoaded(chat)
      }
    }
    await move
    await openedWhileMissing
    await sm.setSessionStatus('opened-mid-move', 'done')

    expect(loadSession(root, 'opened-mid-move')?.messages).toHaveLength(400)
    expect(project('opened-mid-move')).toBe('app')
    expect(openedWhileMissing).toBeUndefined()
  })

  describe('with the config watcher running', () => {
    /** The watcher's debounce (100 ms, 300 ms on Windows), then its read of the header */
    const WATCHER_SETTLE_MS = 450
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    afterEach(() => sm.cleanup())

    it("takes a moved chat's header patch for its own write, so a status set afterwards survives the next turn end", async () => {
      // An id no other test saves: the persistence queue is a singleton, and it must never have written this chat
      const id = 'watched-unopened-chat'
      const chat = seed(id, { messages: 3 })
      sm.setupConfigWatcher(root, 'ws_test')

      await sm.setSessionProjectId(id, 'app')
      await sleep(WATCHER_SETTLE_MS)
      // An echo taken for an external change is kept (the move set a write guard) and applied at the turn end
      expect(chat.pendingExternalMetadata).toBeUndefined()

      await sm.setSessionStatus(id, 'done')
      await sleep(WATCHER_SETTLE_MS)
      chat.isProcessing = true
      await (sm as unknown as { onProcessingStopped: (sessionId: string, reason: string) => Promise<void> })
        .onProcessingStopped(id, 'complete')
      await sm.flushSession(id)

      expect(chat.sessionStatus).toBe('done')
      expect(loadSession(root, id)?.sessionStatus).toBe('done')
      expect(project(id)).toBe('app')
    })
  })

  it('saves an opened chat through the persistence queue, messages included', async () => {
    seed('root', { loaded: true, messages: 2 })
    seed('open-kid', { parentSessionId: 'root', loaded: true, messages: 1 })

    await sm.setSessionProjectId('root', 'next')

    expect(loadSession(root, 'root')?.messages.map(m => m.id)).toEqual(['root-m0', 'root-m1'])
    expect(project('root')).toBe('next')
    expect(project('open-kid')).toBe('next')
  })

  it('keeps a chat it put apart from its parent apart after a restart', async () => {
    seed('parent', { projectId: 'app' })
    seed('child', { parentSessionId: 'parent', projectId: 'app' })
    await sm.setSessionProjectId('child', 'docs')
    expect(marker('child')).toBe(true)

    // A new run reads the sessions from disk
    sm = new SessionManager()
    sm.setEventSink((() => {}) as never)
    for (const meta of listSessions(root)) sessionsOf(sm).set(meta.id, createManagedSession(meta, workspace()))
    expect(sessionsOf(sm).get('child')?.projectOverride).toBe(true)

    await sm.setSessionProjectId('parent', 'next')
    expect(project('parent')).toBe('next')
    expect(project('child')).toBe('docs')
  })

  it('moves branches with the chat they were branched from, as the list nests them', async () => {
    seed('source', { projectId: 'app' })
    seed('branch', { branchFrom: 'source', projectId: 'app' })
    seed('branch-of-branch', { branchFrom: 'branch', projectId: 'app' })

    await sm.setSessionProjectId('source', 'next')

    expect(project('branch')).toBe('next')
    expect(project('branch-of-branch')).toBe('next')
  })

  it("ignores unknown chats and other workspaces' chats, taking the workspace from the first chat it knows", async () => {
    seed('a')
    seed('a-kid', { parentSessionId: 'a' })
    seed('x', { otherWorkspace: true })

    const result = await sm.setSessionProjectId('ghost', 'next', ['a', 'x'])

    expect(result.moved.map(m => m.id)).toEqual(['a', 'a-kid'])
    expect(project('x', otherRoot)).toBeUndefined()
    expect(sessionsOf(sm).get('x')?.projectId).toBeUndefined()
    expect(await sm.setSessionProjectId('ghost', 'next')).toEqual({ moved: [] })
  })

  it("refuses a project the chats' workspace doesn't have, changing nothing", async () => {
    seed('a', { projectId: 'app' })
    await expect(sm.setSessionProjectId('a', 'missing')).rejects.toThrow('Project missing not found')
    expect(project('a')).toBe('app')
    expect(projectEvents()).toEqual([])
  })

  // --- Undo ---

  it('puts chats back exactly as they were, the marker included (Undo)', async () => {
    seed('parent', { projectId: 'app' })
    seed('apart', { parentSessionId: 'parent', projectId: 'docs', projectOverride: true })
    seed('kid', { parentSessionId: 'parent', projectId: 'app' })
    const { moved } = await sm.setSessionProjectId('parent', 'next', ['apart'])
    expect(project('apart')).toBe('next')
    expect(marker('apart')).toBeUndefined()

    const states = moved.map((m: ProjectMoveEntry) => ({ id: m.id, projectId: m.previousProjectId, projectOverride: m.previousOverride }))
    const undone = await sm.restoreSessionProjects('parent', states)

    expect(undone.moved.map(m => m.id).sort()).toEqual(['apart', 'kid', 'parent'])
    expect(project('parent')).toBe('app')
    expect(project('kid')).toBe('app')
    expect(project('apart')).toBe('docs')
    expect(marker('apart')).toBe(true)
  })

  it('restores a chat whose project was deleted meanwhile to no project', async () => {
    seed('a', { projectId: 'docs', projectOverride: true, parentSessionId: 'p' })
    seed('p', { projectId: 'app' })
    await sm.setSessionProjectId('a', 'next')
    rmSync(getProjectPath(root, 'docs'), { recursive: true, force: true })

    await sm.restoreSessionProjects('a', [{ id: 'a', projectId: 'docs', projectOverride: true }])

    expect(project('a')).toBeUndefined()
    expect(marker('a')).toBeUndefined()
  })

  // --- Task paths ---

  it('binding a board tile to a task moves the subtasks added under it along', async () => {
    seed('tile')
    seed('sub-1', { parentSessionId: 'tile' })
    seed('sub-2', { parentSessionId: 'tile', projectId: 'docs', projectOverride: true })

    expect(await sm.bindExistingSessionToTask('tile', 'ship-it', { projectId: 'app' })).toBe(true)

    expect(project('tile')).toBe('app')
    expect(project('sub-1')).toBe('app')
    expect(project('sub-2')).toBe('docs')
    expect(projectEvents()).toEqual(['tile:app', 'sub-1:app'])
    // The task promotion no longer carries the project: project_id_changed did
    const promoted = events.find(e => e.type === 'session_metadata_changed')
    expect(promoted).toMatchObject({ sessionId: 'tile', changes: { taskDraft: false, taskSlug: 'ship-it' } })
    expect(promoted && 'changes' in promoted && 'projectId' in promoted.changes).toBe(false)
  })

  it("adopting a generated orchestrator moves it into the task's project; a missing project is skipped", async () => {
    seed('draft', { taskDraft: true, projectId: 'app' })
    expect(await sm.adoptGeneratedTaskOrchestrator('draft', 'gen-task', { projectId: 'next' })).toBe(true)
    expect(project('draft')).toBe('next')

    seed('tile')
    expect(await sm.bindExistingSessionToTask('tile', 'other-task', { projectId: 'deleted-project' })).toBe(true)
    expect(project('tile')).toBeUndefined()
    expect(loadSession(root, 'tile')?.taskSlug).toBe('other-task')
  })

  // --- RPC command ---

  describe('sessions:command', () => {
    function command() {
      const handlers = new Map<string, HandlerFn>()
      const server = {
        handle: (channel: string, handler: HandlerFn) => { handlers.set(channel, handler) },
        push: () => {},
        invokeClient: async () => undefined,
        hasClientCapability: () => false,
        findClientsWithCapability: () => [],
      } as unknown as RpcServer
      const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
      registerSessionsHandlers(server, { sessionManager: sm, platform: { logger } } as unknown as HandlerDeps)
      const handler = handlers.get(RPC_CHANNELS.sessions.COMMAND)!
      return (sessionId: string, cmd: unknown) => handler({ clientId: 'c', workspaceId: 'ws_test', webContentsId: null }, sessionId, cmd)
    }

    it('moves a selection and returns what moved, then undoes it', async () => {
      seed('a', { projectId: 'app' })
      seed('b')
      seed('b-kid', { parentSessionId: 'b' })
      const send = command()

      const result = await send('a', { type: 'setProjectId', projectId: 'next', additionalSessionIds: ['b'] }) as { moved: ProjectMoveEntry[] }
      expect(result.moved.map(m => m.id)).toEqual(['a', 'b', 'b-kid'])
      expect(['a', 'b', 'b-kid'].map(id => project(id))).toEqual(['next', 'next', 'next'])

      await send('a', {
        type: 'restoreProjectIds',
        sessions: result.moved.map(m => ({ id: m.id, projectId: m.previousProjectId, projectOverride: m.previousOverride })),
      })
      expect(['a', 'b', 'b-kid'].map(id => project(id))).toEqual(['app', undefined, undefined])
    })

    it('refuses malformed commands before anything moves', async () => {
      seed('a')
      seed('b')
      seed('c')
      const send = command()

      await expect(send('a', { type: 'setProjectId', projectId: 'next', additionalSessionIds: 'bc' })).rejects.toThrow('must be an array')
      await expect(send('a', { type: 'setProjectId', projectId: 'next', additionalSessionIds: [42] })).rejects.toThrow('must be an array')
      await expect(send('a', { type: 'setProjectId', additionalSessionIds: ['b'] })).rejects.toThrow('project id or null')
      await expect(send('a', { type: 'restoreProjectIds', sessions: [{ id: 'b', projectId: 'next' }] })).rejects.toThrow('boolean projectOverride')
      expect(['a', 'b', 'c'].map(id => project(id))).toEqual([undefined, undefined, undefined])
      expect(projectEvents()).toEqual([])
    })
  })
})
