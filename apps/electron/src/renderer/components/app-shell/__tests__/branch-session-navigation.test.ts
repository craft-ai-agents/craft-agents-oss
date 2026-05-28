import { describe, expect, test } from 'bun:test'
import { createBranchSessionAndNavigate } from '../branch-session-navigation'

describe('branch session navigation', () => {
  test('activates the child session route in the current panel after branching', async () => {
    let activeRoute = 'allSessions/session/parent'
    const navigateCalls: unknown[][] = []

    const route = await createBranchSessionAndNavigate({
      session: {
        id: 'parent',
        workspaceId: 'workspace-1',
        name: 'Parent chat',
        llmConnection: 'pi',
        model: 'pi-model',
        permissionMode: 'ask',
        workingDirectory: '/tmp/project',
        enabledSourceSlugs: ['docs'],
      },
      messageId: 'message-1',
      createSession: async (workspaceId, options) => {
        expect(workspaceId).toBe('workspace-1')
        expect(options).toMatchObject({
          branchFromMessageId: 'message-1',
          branchFromSessionId: 'parent',
          name: 'Branch of Parent chat',
          llmConnection: 'pi',
          model: 'pi-model',
          permissionMode: 'ask',
          workingDirectory: '/tmp/project',
          enabledSourceSlugs: ['docs'],
        })
        return { id: 'child' }
      },
      navigate: (...args) => {
        navigateCalls.push(args)
        activeRoute = args[0]
      },
    })

    expect(route).toBe('allSessions/session/child')
    expect(activeRoute).toBe('allSessions/session/child')
    expect(navigateCalls).toEqual([['allSessions/session/child']])
  })
})
