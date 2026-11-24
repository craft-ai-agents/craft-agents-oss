import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as config from '@craft-agent/shared/config'
import { readSessionHeader, getSessionFilePath, serializeSession, sessionPersistenceQueue } from '@craft-agent/shared/sessions'
import { saveWorkspaceConfig, type WorkspaceConfig } from '@craft-agent/shared/workspaces'
import { SessionManager } from './SessionManager'
import bundledDefaults from '../../../../apps/electron/resources/config-defaults.json'

const workspaceId = 'workspace-test'

describe('workspace required session start mode', () => {
  let root: string
  let manager: SessionManager
  let workspace: WorkspaceConfig
  let restoreConfigSpies: () => void

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'required-session-start-mode-'))
    workspace = {
      id: workspaceId, name: 'Test workspace', slug: 'test', createdAt: 1, updatedAt: 1,
      defaults: { permissionMode: 'ask', thinkingLevel: 'medium' },
    }
    saveWorkspaceConfig(root, workspace)
    const lookup = spyOn(config, 'getWorkspaceByNameOrId').mockReturnValue({ ...workspace, rootPath: root })
    const defaults = spyOn(config, 'loadConfigDefaults').mockReturnValue(bundledDefaults as ReturnType<typeof config.loadConfigDefaults>)
    restoreConfigSpies = () => { lookup.mockRestore(); defaults.mockRestore() }
    manager = new SessionManager()
    // Exercise prompt dispatch and session creation without calling the model.
    spyOn(manager, 'sendMessage').mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await sessionPersistenceQueue.flushAll()
    restoreConfigSpies()
    rmSync(root, { recursive: true, force: true })
  })

  function requireExecute() {
    // Use the documented on-disk spelling to exercise canonical name parsing.
    saveWorkspaceConfig(root, { ...workspace, defaults: { ...workspace.defaults, requiredPermissionMode: 'execute' } })
  }

  function expectMode(id: string, mode: 'allow-all' | 'ask' | 'safe') {
    expect(manager.getSessionPermissionModeState(id)?.permissionMode).toBe(mode)
    expect(readSessionHeader(getSessionFilePath(root, id))?.permissionMode).toBe(mode)
  }

  it('overrides the workspace default and all restrictive creation requests', async () => {
    requireExecute()
    for (const permissionMode of [undefined, 'safe', 'ask', 'guarded', 'allow-all'] as const) {
      const session = await manager.createSession(workspaceId, { permissionMode })
      expect(session.permissionMode).toBe('allow-all')
      expectMode(session.id, 'allow-all')
    }
  })

  it('enforces Execute when the child requests Explore, without rewriting existing sessions', async () => {
    const parent = await manager.createSession(workspaceId, { permissionMode: 'allow-all' })
    const olderChat = await manager.createSession(workspaceId, { permissionMode: 'safe' })
    requireExecute()
    const child = await manager['createSpawnedSession'](manager['sessions'].get(parent.id)!, {
      prompt: 'Test only', permissionMode: 'safe',
    })
    expect(child.parentSessionId).toBe(parent.id)
    expectMode(child.id, 'allow-all')
    expectMode(olderChat.id, 'safe')
  })

  it('refuses a spawn if the required mode would exceed the parent’s permissions', async () => {
    const parent = await manager.createSession(workspaceId, { permissionMode: 'ask' })
    requireExecute()
    await expect(manager['createSpawnedSession'](manager['sessions'].get(parent.id)!, {
      prompt: 'Test only', permissionMode: 'safe',
    })).rejects.toThrow('looser than the parent')
    expect(manager['sessions'].size).toBe(1)
    expectMode(parent.id, 'ask')
  })

  it('enforces Execute for prompt automations with or without a restrictive override', async () => {
    requireExecute()
    for (const permissionMode of [undefined, 'safe', 'ask'] as const) {
      const result = await manager.executePromptAutomation({
        workspaceId, workspaceRootPath: root, prompt: 'Test only', permissionMode,
      })
      expectMode(result.sessionId, 'allow-all')
    }
  })

  it('enforces the destination mode when importing a session bundle', async () => {
    const session = await manager.createSession(workspaceId, { permissionMode: 'safe' })
    const bundle = serializeSession(root, session.id)!
    requireExecute()
    const imported = await manager.importSession(workspaceId, bundle, 'fork')
    expectMode(imported.sessionId, 'allow-all')
    expectMode(session.id, 'safe')
  })

  it('rejects session creation when a configured required mode is invalid', async () => {
    const path = join(root, 'config.json')
    const stored = JSON.parse(readFileSync(path, 'utf8'))
    stored.defaults.requiredPermissionMode = 'not-a-mode'
    writeFileSync(path, JSON.stringify(stored))
    await expect(manager.createSession(workspaceId)).rejects.toThrow('Invalid workspace defaults.requiredPermissionMode')
    expect(manager['sessions'].size).toBe(0)
  })

  it('keeps existing caller, spawn, and automation defaults when the policy is unset', async () => {
    const chat = await manager.createSession(workspaceId)
    const explicitChat = await manager.createSession(workspaceId, { permissionMode: 'safe' })
    const child = await manager['createSpawnedSession'](manager['sessions'].get(chat.id)!, {
      prompt: 'Test only', permissionMode: 'allow-all',
    })
    const automation = await manager.executePromptAutomation({ workspaceId, workspaceRootPath: root, prompt: 'Test only' })
    expectMode(chat.id, 'ask')
    expectMode(explicitChat.id, 'safe')
    expectMode(child.id, 'ask')
    expectMode(automation.sessionId, 'safe')
  })
})
