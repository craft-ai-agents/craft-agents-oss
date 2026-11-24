import { expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

it('creates spawned chats in the current parent project unless a different project is named', () => {
  // Config paths are captured at import time. A subprocess keeps the workspace and
  // its project metadata isolated from the app and from other server tests.
  const configDir = mkdtempSync(join(tmpdir(), 'spawn-project-inheritance-'))
  try {
    const result = Bun.spawnSync([process.execPath, '-e', `
      import assert from 'node:assert/strict'
      import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
      import { addWorkspace, saveConfig } from '@craft-agent/shared/config'
      import { createProject, deleteProject } from '@craft-agent/shared/projects'
      import { loadSession } from '@craft-agent/shared/sessions'
      import { SessionManager } from './packages/server-core/src/sessions/SessionManager.ts'
      import { spawnedSessionOptions } from './packages/server-core/src/sessions/spawn-options.ts'

      saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
      const workspace = addWorkspace({ name: 'Test', rootPath: join(process.env.CRAFT_CONFIG_DIR, 'workspace') })
      const app = createProject(workspace.rootPath, { name: 'App' })
      const docs = createProject(workspace.rootPath, { name: 'Docs' })
      const later = createProject(workspace.rootPath, { name: 'Later' })
      const sm = new SessionManager()
      const parent = await sm.createSession(workspace.id, { projectId: app.id })
      const child = await sm.createSession(workspace.id, spawnedSessionOptions({}, parent))
      const override = await sm.createSession(workspace.id, spawnedSessionOptions({ projectId: docs.id }, parent))
      assert.equal(child.projectId, app.id)
      assert.equal(override.projectId, docs.id)
      assert.equal(loadSession(workspace.rootPath, override.id).projectOverride, true)

      // A moved parent can spawn a child even if the creation request carried a stale snapshot.
      await sm.setSessionProjectId(parent.id, later.id)
      const newerChild = await sm.createSession(workspace.id, spawnedSessionOptions({}, parent))
      assert.equal(newerChild.projectId, later.id)
      assert.equal(loadSession(workspace.rootPath, child.id).projectId, later.id)
      assert.equal(loadSession(workspace.rootPath, override.id).projectId, docs.id)

      // If the parent's project no longer exists, the implicit child still starts.
      deleteProject(workspace.rootPath, later.slug)
      const unbound = await sm.createSession(workspace.id, spawnedSessionOptions({}, parent))
      assert.equal(unbound.projectId, undefined)
      await assert.rejects(sm.createSession(workspace.id, spawnedSessionOptions({ projectId: later.id }, parent)), /not found/)
      await sm.flushAllSessions()
    `], {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
    expect(result.exitCode).toBe(0)
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
}, 15_000)
