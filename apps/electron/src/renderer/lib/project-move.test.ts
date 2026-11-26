import { describe, expect, it } from 'bun:test'
import { MAX_PROJECT_MOVE_SESSIONS, type ProjectMoveEntry } from '@craft-agent/shared/protocol'
import {
  createKeyedBatcher,
  moveSessionsToProject,
  sharedProjectId,
  undoProjectMove,
  type ProjectCommandSender,
} from './project-move'

type Sent = { sessionId: string; command: Parameters<ProjectCommandSender>[1] }

/** A server that answers each setProjectId with `answer(command)` and records what it was sent. */
function server(answer: (sessionId: string, command: Sent['command']) => unknown) {
  const sent: Sent[] = []
  const send: ProjectCommandSender = async (sessionId, command) => {
    sent.push({ sessionId, command })
    return answer(sessionId, command)
  }
  return { send, sent }
}

const entry = (id: string, previousProjectId: string | null = 'app', previousOverride = false): ProjectMoveEntry =>
  ({ id, previousProjectId, previousOverride })

describe('moveSessionsToProject', () => {
  it('sends one command for the selection and returns what the server moved', async () => {
    const { send, sent } = server(() => ({ moved: [entry('a'), entry('b'), entry('b-kid', null)] }))

    const moved = await moveSessionsToProject(send, ['a', 'b', 'a'], 'next')

    expect(sent).toEqual([{ sessionId: 'a', command: { type: 'setProjectId', projectId: 'next', additionalSessionIds: ['b'] } }])
    expect(moved?.map(m => m.id)).toEqual(['a', 'b', 'b-kid'])
  })

  it('sends a single chat without additional ids, which every server understands', async () => {
    const { send, sent } = server(() => ({ moved: [] }))
    expect(await moveSessionsToProject(send, ['a'], null)).toEqual([])
    expect(sent).toEqual([{ sessionId: 'a', command: { type: 'setProjectId', projectId: null } }])
  })

  it(`splits a selection over ${MAX_PROJECT_MOVE_SESSIONS} chats, keeping each chat's state from before the whole move`, async () => {
    const ids = Array.from({ length: MAX_PROJECT_MOVE_SESSIONS + 1 }, (_, i) => `s${i}`)
    const { send, sent } = server((sessionId, command) => {
      if (command.type !== 'setProjectId') return undefined
      // The first batch moved the last chat along as a child; the second moves it again as selected
      return sessionId === 's0'
        ? { moved: [entry('s0'), entry(ids.at(-1)!, 'docs', true)] }
        : { moved: [entry(ids.at(-1)!, 'next', true)] }
    })

    const moved = await moveSessionsToProject(send, ids, 'next')

    expect(sent.map(s => s.sessionId)).toEqual(['s0', ids.at(-1)!])
    expect(sent[0]!.command).toMatchObject({ additionalSessionIds: ids.slice(1, MAX_PROJECT_MOVE_SESSIONS) })
    expect(moved).toEqual([entry('s0'), entry(ids.at(-1)!, 'docs', true)])
  })

  it('moves the rest one by one when an older server answers nothing (it moved only the first chat)', async () => {
    const ids = Array.from({ length: MAX_PROJECT_MOVE_SESSIONS + 2 }, (_, i) => `s${i}`)
    const { send, sent } = server(() => undefined)

    expect(await moveSessionsToProject(send, ids, 'next')).toBeNull()

    expect(sent[0]!.command).toMatchObject({ additionalSessionIds: ids.slice(1, MAX_PROJECT_MOVE_SESSIONS) })
    expect(sent.slice(1).map(s => s.sessionId)).toEqual(ids.slice(1))
    expect(sent.slice(1).every(s => s.command.type === 'setProjectId' && !('additionalSessionIds' in s.command))).toBe(true)
  })
})

describe('undoProjectMove', () => {
  it('restores each chat exactly, in batches the server accepts', async () => {
    const moved = Array.from({ length: MAX_PROJECT_MOVE_SESSIONS + 1 }, (_, i) => entry(`s${i}`, i === 0 ? null : 'app', i === 1))
    const { send, sent } = server(() => ({ moved: [] }))

    await undoProjectMove(send, moved)

    expect(sent.map(s => s.sessionId)).toEqual(['s0', `s${MAX_PROJECT_MOVE_SESSIONS}`])
    const first = sent[0]!.command
    expect(first.type).toBe('restoreProjectIds')
    if (first.type !== 'restoreProjectIds') return
    expect(first.sessions).toHaveLength(MAX_PROJECT_MOVE_SESSIONS)
    expect(first.sessions.slice(0, 2)).toEqual([
      { id: 's0', projectId: null, projectOverride: false },
      { id: 's1', projectId: 'app', projectOverride: true },
    ])
  })
})

describe('sharedProjectId', () => {
  it('names the project all selected chats share, null when none has one, else nothing', () => {
    expect(sharedProjectId([{ projectId: 'app' }, { projectId: 'app' }], 2)).toBe('app')
    expect(sharedProjectId([{}, { projectId: undefined }], 2)).toBeNull()
    expect(sharedProjectId([{ projectId: 'app' }, {}], 2)).toBeUndefined()
    // A selected chat the list doesn't know: no check mark
    expect(sharedProjectId([{ projectId: 'app' }], 2)).toBeUndefined()
    expect(sharedProjectId([], 0)).toBeUndefined()
  })
})

describe('createKeyedBatcher', () => {
  it('hands a burst over once, with the latest value per key, in first-seen order', async () => {
    const batches: Array<[string, string | null][]> = []
    const batcher = createKeyedBatcher<string | null>((batch) => { batches.push([...batch]) }, 5)

    batcher.add('a', 'app')
    batcher.add('b', null)
    batcher.add('a', 'next')
    expect(batches).toEqual([])
    await Bun.sleep(20)

    expect(batches).toEqual([[['a', 'next'], ['b', null]]])
  })

  it('hands over at once on flush (an event of another kind arrived), and nothing when empty', async () => {
    const batches: Array<[string, string][]> = []
    const batcher = createKeyedBatcher<string>((batch) => { batches.push([...batch]) }, 5)

    batcher.flush()
    batcher.add('a', 'app')
    batcher.flush()
    batcher.add('b', 'docs')
    await Bun.sleep(20)

    expect(batches).toEqual([[['a', 'app']], [['b', 'docs']]])
  })
})
