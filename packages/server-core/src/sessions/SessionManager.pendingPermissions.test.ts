import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const tempConfigDir = mkdtempSync(path.join(tmpdir(), 'craft-agent-pending-permissions-'))
const originalConfigDir = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = tempConfigDir

const sharedConfig = await import('@craft-agent/shared/config')
const serverCoreSessions = await import('./SessionManager.ts')

const { saveConfig } = sharedConfig
const { SessionManager, createManagedSession } = serverCoreSessions

const workspace = {
  id: 'ws-pending-permissions-test',
  name: 'Pending Permissions Test',
  rootPath: path.join(tempConfigDir, 'workspace'),
  createdAt: Date.now(),
}

const sessionId = 'session-pending-permissions-test'

function configureConfig(): void {
  mkdirSync(workspace.rootPath, { recursive: true })
  saveConfig({
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    activeSessionId: null,
  })
}

function buildManager() {
  const manager = new SessionManager()
  const managed = createManagedSession({
    id: sessionId,
  }, workspace, {
    messages: [],
    messagesLoaded: true,
  })

  managed.agent = { supportsBranching: true } as any

  const sessions = (manager as unknown as { sessions: Map<string, typeof managed> }).sessions
  sessions.set(sessionId, managed)

  return { manager, managed }
}

beforeEach(() => {
  configureConfig()
})

afterAll(() => {
  process.env.CRAFT_CONFIG_DIR = originalConfigDir
  rmSync(tempConfigDir, { recursive: true, force: true })
})

describe('SessionManager.getPendingPermissionRequests', () => {
  it('returns recoverable pending permission requests for a live session', () => {
    const { manager } = buildManager()
    const pending = (manager as unknown as {
      pendingPermissionRequests: Map<string, {
        sessionId: string
        request: import('@craft-agent/shared/protocol').PermissionRequest
      }>
    }).pendingPermissionRequests

    pending.set('req-1', {
      sessionId,
      request: {
        requestId: 'req-1',
        sessionId,
        toolName: 'Bash',
        description: 'Run command',
        command: 'echo hello',
        type: 'bash',
      },
    })
    pending.set('req-2', {
      sessionId: 'other-session',
      request: {
        requestId: 'req-2',
        sessionId: 'other-session',
        toolName: 'Bash',
        description: 'Other command',
      },
    })

    expect(manager.getPendingPermissionRequests(sessionId)).toEqual([
      {
        requestId: 'req-1',
        sessionId,
        toolName: 'Bash',
        description: 'Run command',
        command: 'echo hello',
        type: 'bash',
      },
    ])
  })

  it('returns an empty list when the session has no live agent', () => {
    const { manager, managed } = buildManager()
    managed.agent = null
    const pending = (manager as unknown as {
      pendingPermissionRequests: Map<string, {
        sessionId: string
        request: import('@craft-agent/shared/protocol').PermissionRequest
      }>
    }).pendingPermissionRequests

    pending.set('req-1', {
      sessionId,
      request: {
        requestId: 'req-1',
        sessionId,
        toolName: 'Bash',
        description: 'Run command',
      },
    })

    expect(manager.getPendingPermissionRequests(sessionId)).toEqual([])
  })
})
