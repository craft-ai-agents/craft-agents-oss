/**
 * P2-12 regression test — sources:saveCredentials knowledge fallback.
 *
 * When `sourceSlug` matches no regular source but IS a knowledge connection id,
 * the handler stores the bearer token under the CredentialManager key encoded in
 * the record's credentialRef (`source_bearer::{workspaceId}::{connectionId}`),
 * NOT under the active workspace of the invoking call. The read path
 * (handlers/rpc/knowledge.ts readToken) resolves the record's credentialRef
 * verbatim, so a token written under the wrong workspace is unreadable on
 * multi-workspace installs.
 *
 * Harness mirrors knowledge.test.ts / memory-io.test.ts: the workspace registry
 * and CredentialManager are module seams (bun's mock.module registry is
 * process-global in combined runs — using the real modules would receive THIS
 * directory's other suite's fixtures instead). The connections store runs real
 * against the sandboxed CRAFT_CONFIG_DIR (env-lazy store paths).
 */
import '../memory-test-setup' // must run before any module reading CRAFT_CONFIG_DIR
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { CredentialId } from '@craft-agent/shared/credentials'
import { loadSourceConfig, saveSourceConfig, type FolderSourceConfig } from '@craft-agent/shared/sources'
import { createWorkspaceAtPath, getDefaultWorkspacesDir, loadWorkspaceConfig, saveWorkspaceConfig } from '@craft-agent/shared/workspaces'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { KnowledgeConnectionsStore } from '../../../knowledge'
import { registerSourcesHandlers } from '../sources'

// Credential id string ↔ in-memory store key (`type::workspaceId::sourceId`).
const credentials = new Map<string, { value: string }>()

mock.module('@craft-agent/shared/credentials', () => ({
  getCredentialManager: () => ({
    async get(id: CredentialId) {
      return credentials.get(`${id.type}::${id.workspaceId}::${id.sourceId}`) ?? null
    },
    async set(id: CredentialId, credential: { value: string }) {
      credentials.set(`${id.type}::${id.workspaceId}::${id.sourceId}`, credential)
    },
    async delete(id: CredentialId) {
      return credentials.delete(`${id.type}::${id.workspaceId}::${id.sourceId}`)
    },
  }),
}))

const mockWorkspaces = [
  { id: 'ws-owner', name: 'ws-owner', rootPath: '' },
  { id: 'ws-active', name: 'ws-active', rootPath: '' },
]

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (nameOrId: string) =>
    mockWorkspaces.find((w) => w.id === nameOrId || w.name === nameOrId) ?? null,
  getWorkspaces: () => [...mockWorkspaces],
}))

function writeConfigDefaults(): void {
  writeFileSync(join(process.env.CRAFT_CONFIG_DIR!, 'config-defaults.json'), JSON.stringify({
    version: 'test',
    workspaceDefaults: {
      permissionMode: 'ask',
      cyclablePermissionModes: ['safe', 'ask'],
      localMcpServers: { enabled: true },
    },
  }), 'utf-8')
}

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const deps: HandlerDeps = {
    sessionManager: {} as HandlerDeps['sessionManager'],
    oauthFlowStore: {} as HandlerDeps['oauthFlowStore'],
    platform: {
      appRootPath: '/',
      resourcesPath: '/',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
    },
  }
  registerSourcesHandlers(server, deps)
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ clientId: 'c1', workspaceId: null } as unknown as RequestContext, ...args)
  }
  return { handlers, invoke }
}

beforeEach(() => {
  rmSync(join(process.env.CRAFT_CONFIG_DIR!, 'knowledge'), { recursive: true, force: true })
  credentials.clear()
  mockWorkspaces[0]!.name = 'ws-owner'
  mockWorkspaces[1]!.name = 'ws-active'
  mockWorkspaces[0]!.rootPath = mkdtempSync(join(tmpdir(), 'sources-ws-owner-'))
  mockWorkspaces[1]!.rootPath = mkdtempSync(join(tmpdir(), 'sources-ws-active-'))
})

describe('sources:saveCredentials — knowledge-connection fallback (P2-12)', () => {
  it('stores the bearer token under the workspace encoded in the record credentialRef, not the active workspace', async () => {
    // Connection was registered while ws-owner was the active workspace;
    // the caller now invokes the save plumbing from ws-active.
    new KnowledgeConnectionsStore().save({
      id: 'conn-1',
      baseUrl: 'http://127.0.0.1:6806',
      credentialRef: 'source_bearer::ws-owner::conn-1',
    })
    const { invoke } = createHarness()

    await invoke(RPC_CHANNELS.sources.SAVE_CREDENTIALS, 'ws-active', 'conn-1', 'token-under-record-workspace')

    // The read path key (credentialIdFromRef in readToken) must resolve.
    expect(credentials.get('source_bearer::ws-owner::conn-1')?.value).toBe('token-under-record-workspace')
    // The active-workspace key stays empty — writing there was the unreadable-token bug.
    expect(credentials.get('source_bearer::ws-active::conn-1')).toBeUndefined()
  })

  it('still falls back to the arg workspaceId when the credentialRef is legacy/unparseable', async () => {
    // Legacy single-workspace record without an encoded workspace (ref not in
    // source_bearer::<workspaceId>::<connectionId> shape): the call-scope
    // workspaceId is the only workspace hint available.
    new KnowledgeConnectionsStore().save({
      id: 'conn-legacy',
      baseUrl: 'http://127.0.0.1:6806',
      credentialRef: 'conn-legacy',
    })
    const { invoke } = createHarness()

    await invoke(RPC_CHANNELS.sources.SAVE_CREDENTIALS, 'ws-active', 'conn-legacy', 'legacy-token')

    expect(credentials.get('source_bearer::ws-active::conn-legacy')?.value).toBe('legacy-token')
  })

  it('rejects a slug that is neither a source nor a knowledge connection — mistyped slugs fail loudly', async () => {
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.sources.SAVE_CREDENTIALS, 'ws-active', 'not-a-thing', 'tok'),
    ).rejects.toThrow('Source not found: not-a-thing')
  })
})

describe('sources:get — local default source seeding', () => {
  it('creates offline-safe defaults with a local Craft Markdown Notes source', async () => {
    writeConfigDefaults()
    const rootPath = mockWorkspaces[0]!.rootPath
    const created = createWorkspaceAtPath(rootPath, 'Fresh workspace', undefined, {
      id: 'ws-owner',
      slug: 'fresh-workspace',
    })

    expect(created.defaults?.enabledSourceSlugs).toEqual(['notes'])
    expect(loadSourceConfig(rootPath, 'exa')?.enabled).toBe(false)
    expect(loadSourceConfig(rootPath, 'firecrawl')?.enabled).toBe(false)

    const notesConfigPath = join(rootPath, 'sources', 'notes', 'config.json')
    const before = readFileSync(notesConfigPath, 'utf-8')
    mockWorkspaces[0]!.name = 'Fresh workspace by name'

    const { invoke } = createHarness()
    await invoke(RPC_CHANNELS.sources.GET, 'Fresh workspace by name')

    const notes = loadSourceConfig(rootPath, 'notes')
    expect(notes).toMatchObject({
      slug: 'notes',
      enabled: true,
      provider: 'craft-notes',
      type: 'local',
      local: { format: 'craft-markdown' },
      isAuthenticated: true,
      connectionStatus: 'connected',
    })
    expect(notes?.local?.path).toBe(join(getDefaultWorkspacesDir(), 'ws-owner', 'notes'))
    expect(existsSync(notes?.local?.path ?? '')).toBe(true)
    expect(readFileSync(notesConfigPath, 'utf-8')).toBe(before)
  })

  it('preserves an existing disabled Notes source and empty source defaults', async () => {
    writeConfigDefaults()
    const rootPath = mockWorkspaces[0]!.rootPath
    createWorkspaceAtPath(rootPath, 'Existing workspace', undefined, {
      id: 'ws-owner',
      slug: 'existing-workspace',
    })

    const workspaceConfig = loadWorkspaceConfig(rootPath)!
    workspaceConfig.defaults = { ...workspaceConfig.defaults, enabledSourceSlugs: [] }
    saveWorkspaceConfig(rootPath, workspaceConfig)

    const disabledNotes: FolderSourceConfig = {
      id: 'notes-vault',
      name: 'Notes vault',
      slug: 'notes',
      enabled: false,
      provider: 'craft-notes',
      type: 'local',
      local: { path: join(rootPath, 'chosen-notes'), format: 'obsidian' },
      isAuthenticated: true,
      connectionStatus: 'connected',
      createdAt: 1,
      updatedAt: 1,
    }
    saveSourceConfig(rootPath, disabledNotes)
    const notesConfigPath = join(rootPath, 'sources', 'notes', 'config.json')
    const before = readFileSync(notesConfigPath, 'utf-8')

    const { invoke } = createHarness()
    await invoke(RPC_CHANNELS.sources.GET, 'ws-owner')

    expect(readFileSync(notesConfigPath, 'utf-8')).toBe(before)
    expect(loadWorkspaceConfig(rootPath)?.defaults?.enabledSourceSlugs).toEqual([])
    expect(loadSourceConfig(rootPath, 'notes')).toMatchObject({
      enabled: false,
      local: { format: 'obsidian' },
    })
  })
})
