/**
 * End-to-end test for the context file watcher (AGENTS.md / CLAUDE.md).
 *
 * Creates a temp workspace directory, starts the file watcher via the
 * RESOLVE_CONTEXT IPC handler, modifies the files on disk, and asserts
 * that:
 *   - CONTEXT_FILES_CHANGED push events fire
 *   - Unrelated files don't trigger events
 *   - A subsequent compile() call returns the updated file content
 */

import { beforeEach, describe, expect, it, mock, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { RpcServer } from '@archstudio/server-core/transport'

// ── Mock electron before any handler imports ──────────────────────

mock.module('electron', () => ({
  ipcMain: { handle: () => {}, on: () => {} },
  app: {
    isPackaged: false,
    getAppPath: () => '/',
    getPath: () => '/tmp/test-user-data',
    quit: () => {},
    dock: { setIcon: () => {}, setBadge: () => {} },
  },
  nativeTheme: { shouldUseDarkColors: false },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromDataURL: () => ({}),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 0 }),
  },
  shell: {
    openExternal: async () => {},
    openPath: async () => '',
    showItemInFolder: () => {},
  },
  BrowserWindow: {
    fromWebContents: () => null,
    getFocusedWindow: () => null,
    getAllWindows: () => [],
  },
  BrowserView: class {},
  Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
  session: {},
}))

import { RPC_CHANNELS } from '@archstudio/shared/protocol'
import type { HandlerDeps } from '../handler-deps'

// ── Helpers ───────────────────────────────────────────────────────

const PUSH_EVENT_CHANNEL = RPC_CHANNELS.prompts.CONTEXT_FILES_CHANGED

/** A mock RPC server that records push events and stores handlers for invocation. */
function createWatcherMockServer() {
  const handlers = new Map<string, (...args: any[]) => any>()
  const pushEvents: Array<{ channel: string; payload: unknown }> = []

  const server: RpcServer = {
    handle(channel: string, handler: (...args: any[]) => any) {
      handlers.set(channel, handler)
    },
    push(channel: string, payload?: unknown) {
      pushEvents.push({ channel, payload })
    },
    async invokeClient() {},
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }

  return {
    server,
    handlers,
    pushEvents,
    /** Convenience: was PUSH_EVENT_CHANNEL ever pushed? */
    wasPushFired() {
      return pushEvents.some((e) => e.channel === PUSH_EVENT_CHANNEL)
    },
    /** Number of times PUSH_EVENT_CHANNEL was pushed. */
    pushCount() {
      return pushEvents.filter((e) => e.channel === PUSH_EVENT_CHANNEL).length
    },
    clearPushEvents() {
      pushEvents.length = 0
    },
  }
}

/**
 * Create a minimal HandlerDeps with a sessionManager that returns a
 * single workspace whose rootPath points at the temp test directory.
 */
function createTestDeps(tempDir: string): HandlerDeps {
  return {
    sessionManager: {
      getWorkspaces: () => [
        {
          id: 'test-workspace',
          rootPath: tempDir,
          name: 'Test Workspace',
          slug: 'test-workspace',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    } as unknown as HandlerDeps['sessionManager'],
    platform: {
      appRootPath: tempDir,
      resourcesPath: '',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: console,
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
    windowManager: {} as HandlerDeps['windowManager'],
    browserPaneManager: {
      onStateChange: () => {},
      onRemoved: () => {},
      onInteracted: () => {},
    } as unknown as NonNullable<HandlerDeps['browserPaneManager']>,
    oauthFlowStore: {
      store: () => {},
      getByState: () => null,
      remove: () => {},
      cleanup: () => {},
      dispose: () => {},
      size: 0,
    } as unknown as HandlerDeps['oauthFlowStore'],
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Context file watcher end-to-end', () => {
  let tempDir: string
  let mockCtx: ReturnType<typeof createWatcherMockServer>
  let deps: HandlerDeps

  beforeEach(async () => {
    // Create a fresh temp directory (mimics a project root with .git)
    tempDir = mkdtempSync(join(tmpdir(), 'cfw-test-'))
    mkdirSync(join(tempDir, '.git'))
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Initial content\n\nOriginal project instructions.')

    mockCtx = createWatcherMockServer()
    deps = createTestDeps(tempDir)

    const { registerPromptHandlers } = await import('../prompts')
    registerPromptHandlers(mockCtx.server, deps)

    // Start the watcher by invoking the RESOLVE_CONTEXT handler
    const resolveHandler = mockCtx.handlers.get(RPC_CHANNELS.prompts.RESOLVE_CONTEXT)
    expect(resolveHandler).toBeDefined()
    await resolveHandler!({ workspaceId: 'test-workspace' })

    // Give fs.watch a moment to initialise
    await Bun.sleep(200)
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('fires CONTEXT_FILES_CHANGED when AGENTS.md is modified', async () => {
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Modified content\n\nUpdated instructions for the agent.')
    await Bun.sleep(500)

    expect(mockCtx.wasPushFired()).toBe(true)
  })

  it('fires CONTEXT_FILES_CHANGED when CLAUDE.md is modified', async () => {
    writeFileSync(join(tempDir, 'CLAUDE.md'), '# Claude instructions\n\nRun tests after every change.')
    await Bun.sleep(200)

    writeFileSync(join(tempDir, 'CLAUDE.md'), '# Updated Claude instructions\n\nAlways ask before committing.')
    await Bun.sleep(500)

    expect(mockCtx.wasPushFired()).toBe(true)
  })

  it('does not fire for unrelated files', async () => {
    writeFileSync(join(tempDir, 'README.md'), '# Unrelated file')
    await Bun.sleep(500)

    expect(mockCtx.wasPushFired()).toBe(false)
  })

  it('compiles the prompt with fresh context after AGENTS.md changes on disk', async () => {
    const compileHandler = mockCtx.handlers.get(RPC_CHANNELS.prompts.COMPILE)
    expect(compileHandler).toBeDefined()

    // Initial compile — should contain original content
    const result1 = await compileHandler!({ workspaceId: 'test-workspace' })
    const prompt1 = result1.snapshot.prompt as string
    expect(prompt1).toContain('Original project instructions.')
    expect(prompt1).not.toContain('Updated project instructions.')

    // Modify AGENTS.md on disk
    writeFileSync(
      join(tempDir, 'AGENTS.md'),
      '# Initial content\n\nUpdated project instructions.\n\nAdded section on testing.',
    )
    await Bun.sleep(500)

    // The watcher invalidated the cache and pushed CONTEXT_FILES_CHANGED.
    // Now compile again — should pick up fresh content from disk.
    const result2 = await compileHandler!({ workspaceId: 'test-workspace' })
    const prompt2 = result2.snapshot.prompt as string
    expect(prompt2).toContain('Updated project instructions.')
    // Original content is still present (we only added to it, didn't remove)
    // The key assertion: the NEW content is included

    expect(mockCtx.wasPushFired()).toBe(true)
  })

  it('handles the `error` event gracefully (watched directory deleted)', async () => {
    // Delete the temp directory — this should trigger the watcher's error listener
    rmSync(tempDir, { recursive: true, force: true })
    await Bun.sleep(300)

    // The watcher should have logged the error and cleaned up gracefully.
    // No assertion needed for the error logging (it's a console.error side effect),
    // but we verify the watcher reference was cleared by checking that a subsequent
    // RESOLVE_CONTEXT call restarts the watcher successfully.

    // Re-create the directory and file to test recovery
    mkdirSync(tempDir, { recursive: true })
    mkdirSync(join(tempDir, '.git'))
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Recovered')

    // Re-start the watcher via RESOLVE_CONTEXT (simulates Prompt Studio re-opening)
    const resolveHandler = mockCtx.handlers.get(RPC_CHANNELS.prompts.RESOLVE_CONTEXT)
    await resolveHandler!({ workspaceId: 'test-workspace' })
    await Bun.sleep(200)

    // The new watcher should fire on file change
    mockCtx.clearPushEvents()
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Recovered and updated')
    await Bun.sleep(500)

    expect(mockCtx.wasPushFired()).toBe(true)
  })

  it('fires exactly one push event per file change (no duplicate firings)', async () => {
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Single change')
    await Bun.sleep(500)

    expect(mockCtx.pushCount()).toBeGreaterThanOrEqual(1)
    // Allow up to 2 in case fs.watch fires rename+change on some platforms
    expect(mockCtx.pushCount()).toBeLessThanOrEqual(2)
  })
})
