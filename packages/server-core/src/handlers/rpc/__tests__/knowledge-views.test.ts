/**
 * P5 knowledge views + envelopes RPC handler tests:
 * - HANDLED_CHANNELS includes 6 P5 channels (total 32)
 * - viewsList returns knowledge-domain defaults
 * - viewRun filters via InMemory provider (research-needs-review fixture)
 * - viewSetAttribute creates a pending proposal via bridge (no apply)
 * - envelope get/upsert/list round-trip
 */
import '../memory-test-setup'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { CredentialId } from '@craft-agent/shared/credentials'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import type {
  KnowledgeConnection,
  KnowledgeNode,
  KnowledgeProvider,
  KnowledgeRef,
  KnowledgeWorkEnvelope,
  MutationProposal,
  SearchHit,
} from '@craft-agent/core/knowledge'
import type { ViewConfig as SharedViewConfig } from '@craft-agent/shared/views'
import { InMemoryKnowledgeProvider } from '@craft-agent/core/knowledge'
import { KnowledgeConnectionsStore, KnowledgeMutationProposalsStore } from '../../../knowledge'
import type { SaveConnectionInput } from '../../../knowledge'
import {
  HANDLED_CHANNELS,
  registerKnowledgeHandlers,
  __setKnowledgeTestConstructors,
  __setSkipKnowledgeWatchAutoStart,
} from '../knowledge'

const credentials = new Map<string, { value: string }>()
let workspaceRoot: string

mock.module('@craft-agent/shared/credentials', () => ({
  getCredentialManager: () => ({
    async get(id: CredentialId) {
      return credentials.get(`${id.type}::${id.workspaceId}::${id.sourceId}`) ?? null
    },
  }),
}))

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) =>
    id === 'ws1' ? { id: 'ws1', name: 'ws1', rootPath: workspaceRoot } : null,
  getWorkspaces: () =>
    workspaceRoot ? [{ id: 'ws1', name: 'ws1', rootPath: workspaceRoot }] : [],
}))

const DOC_NEEDS: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-needs' }
const DOC_OK: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-ok' }
const DOC_OTHER: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-other-nb' }

function makeNode(
  ref: KnowledgeRef,
  path: string,
  title: string,
  attrs: Array<{ key: string; value: string }>,
  updatedAt: number,
): KnowledgeNode {
  return {
    ref,
    title,
    path,
    attributes: attrs,
    createdAt: updatedAt - 1000,
    updatedAt,
    contentHash: 'a'.repeat(64),
    markdown: `# ${title}\n`,
  }
}

/** Seed InMemory with Research docs matching / not matching the default view filter. */
function useResearchFixtureProvider() {
  __setKnowledgeTestConstructors(
    class implements KnowledgeProvider {
      private inner: InMemoryKnowledgeProvider
      constructor(options: { connection: KnowledgeConnection; token: string }) {
        this.inner = new InMemoryKnowledgeProvider({
          connectionId: options.connection.id,
          capabilities: {
            provider: 'memory',
            version: '0.0.0-inmemory',
            minSupportedVersion: '0.0.0',
            features: {
              search: true,
              backlinks: true,
              attributes: true,
              databases: true,
              assets: true,
              liveReference: true,
              watch: false,
              deepLinks: true,
            },
            mutations: {
              createDocument: true,
              appendBlock: true,
              updateBlock: true,
              setAttribute: true,
              transactions: true,
              rollback: true,
            },
          },
          seed: {
            nodes: [
              makeNode(
                { scheme: 'siyuan', kind: 'notebook', id: 'nb-research' },
                '/Research',
                'Research',
                [],
                1,
              ),
              makeNode(
                DOC_NEEDS,
                '/Research/Reports/Needs Review',
                'Needs Review Doc',
                [
                  { key: 'knowledge-workflow_status', value: 'needs-review' },
                  { key: 'topic', value: 'siyuan' },
                ],
                3000,
              ),
              makeNode(
                DOC_OK,
                '/Research/Reports/Approved',
                'Approved Doc',
                [
                  { key: 'knowledge-workflow_status', value: 'approved' },
                  { key: 'topic', value: 'siyuan' },
                ],
                4000,
              ),
              makeNode(
                DOC_OTHER,
                '/Inbox/Note',
                'Inbox Note',
                [{ key: 'knowledge-workflow_status', value: 'needs-review' }],
                5000,
              ),
            ],
          },
        })
      }
      capabilities() {
        return this.inner.capabilities()
      }
      search(input: Parameters<KnowledgeProvider['search']>[0]) {
        return this.inner.search(input)
      }
      get(ref: Parameters<KnowledgeProvider['get']>[0]) {
        return this.inner.get(ref)
      }
      getContext(ref: Parameters<KnowledgeProvider['getContext']>[0], mode: Parameters<KnowledgeProvider['getContext']>[1]) {
        return this.inner.getContext(ref, mode)
      }
      proposeMutation(input: Parameters<KnowledgeProvider['proposeMutation']>[0]) {
        return this.inner.proposeMutation(input)
      }
      applyMutation(id: string) {
        return this.inner.applyMutation(id)
      }
      open(ref: Parameters<KnowledgeProvider['open']>[0]) {
        return this.inner.open(ref)
      }
    } as unknown as new (options: { connection: KnowledgeConnection; token: string }) => KnowledgeProvider,
  )
}

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
    hasClientCapability() {
      return false
    },
    findClientsWithCapability() {
      return []
    },
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
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
  }
  registerKnowledgeHandlers(server, deps)
  const invoke = (channel: string, args: unknown) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    return handler({ clientId: 'c1', workspaceId: null } as unknown as RequestContext, args)
  }
  return { handlers, invoke }
}

function seedConnection(id: string, overrides: Partial<SaveConnectionInput> = {}) {
  return new KnowledgeConnectionsStore().save({
    id,
    baseUrl: 'http://127.0.0.1:6806',
    credentialRef: `source_bearer::ws1::${id}`,
    ...overrides,
  })
}

beforeEach(() => {
  __setSkipKnowledgeWatchAutoStart(true)
  workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-views-ws-'))
  rmSync(join(process.env.CRAFT_CONFIG_DIR!, 'knowledge'), { recursive: true, force: true })
  credentials.clear()
  useResearchFixtureProvider()
  seedConnection('conn-1')
  credentials.set('source_bearer::ws1::conn-1', { value: 'tok' })
})

afterEach(() => {
  __setKnowledgeTestConstructors(null)
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('P5 HANDLED_CHANNELS', () => {
  it('includes the six P5 view/envelope channels (total 32 with P6 watch)', () => {
    expect(HANDLED_CHANNELS).toContain(RPC_CHANNELS.knowledge.ENVELOPE_GET)
    expect(HANDLED_CHANNELS).toContain(RPC_CHANNELS.knowledge.ENVELOPE_UPSERT)
    expect(HANDLED_CHANNELS).toContain(RPC_CHANNELS.knowledge.ENVELOPE_LIST)
    expect(HANDLED_CHANNELS).toContain(RPC_CHANNELS.knowledge.VIEWS_LIST)
    expect(HANDLED_CHANNELS).toContain(RPC_CHANNELS.knowledge.VIEW_RUN)
    expect(HANDLED_CHANNELS).toContain(RPC_CHANNELS.knowledge.VIEW_SET_ATTRIBUTE)
    expect(HANDLED_CHANNELS).toHaveLength(37) // 9 P1 + 7 P3 + 8 P4 + 6 P5 + 2 P6 + 3 P7-prep + 2 P7
  })

  it('registers handlers for every P5 channel', () => {
    const { handlers } = createHarness()
    for (const ch of [
      RPC_CHANNELS.knowledge.ENVELOPE_GET,
      RPC_CHANNELS.knowledge.ENVELOPE_UPSERT,
      RPC_CHANNELS.knowledge.ENVELOPE_LIST,
      RPC_CHANNELS.knowledge.VIEWS_LIST,
      RPC_CHANNELS.knowledge.VIEW_RUN,
      RPC_CHANNELS.knowledge.VIEW_SET_ATTRIBUTE,
    ]) {
      expect(handlers.has(ch)).toBe(true)
    }
    expect(handlers.size).toBe(HANDLED_CHANNELS.length)
  })
})

describe('viewsList', () => {
  it('returns knowledge-domain defaults including research-needs-review', async () => {
    const { invoke } = createHarness()
    const views = (await invoke(RPC_CHANNELS.knowledge.VIEWS_LIST, {
      connectionId: 'conn-1',
    })) as SharedViewConfig[]
    expect(views.every((v) => v.domain === 'knowledge')).toBe(true)
    const research = views.find((v) => v.id === 'research-needs-review')
    expect(research).toBeDefined()
    expect(research!.knowledgeFilter?.pathPrefix).toBe('/Research')
    expect(research!.knowledgeFilter?.attributes?.['knowledge-workflow_status']).toBe('needs-review')
    // session views must not leak
    expect(views.some((v) => v.id === 'view-new')).toBe(false)
  })
})

describe('viewRun', () => {
  it('filters InMemory hits for research-needs-review', async () => {
    const { invoke } = createHarness()
    const result = (await invoke(RPC_CHANNELS.knowledge.VIEW_RUN, {
      connectionId: 'conn-1',
      viewId: 'research-needs-review',
    })) as { items: Array<SearchHit & { attributes?: Record<string, string>; topic?: string }>; view: SharedViewConfig }

    expect(result.view.id).toBe('research-needs-review')
    expect(result.view.groupBy).toBe('topic')
    // Only DOC_NEEDS: path /Research + knowledge-workflow_status=needs-review
    expect(result.items.map((h) => h.ref.id)).toEqual(['doc-needs'])
    expect(result.items[0]!.title).toBe('Needs Review Doc')
    // sorted updated_at desc (single item)
    expect(result.items[0]!.updatedAt).toBe(3000)
    // groupBy topic enrichment attaches attributes/topic
    expect(result.items[0]!.attributes?.topic).toBe('siyuan')
    expect(result.items[0]!.topic).toBe('siyuan')
    expect(result.items[0]!.attributes?.['knowledge-workflow_status']).toBe('needs-review')
  })

  it('throws NOT_FOUND for unknown viewId', async () => {
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.VIEW_RUN, {
        connectionId: 'conn-1',
        viewId: 'no-such-view',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('viewSetAttribute', () => {
  it('creates a pending proposal via bridge and does not apply', async () => {
    const { invoke } = createHarness()
    const result = (await invoke(RPC_CHANNELS.knowledge.VIEW_SET_ATTRIBUTE, {
      connectionId: 'conn-1',
      ref: DOC_NEEDS,
      name: 'knowledge-workflow_status',
      value: 'approved',
    })) as { proposalId: string }

    expect(typeof result.proposalId).toBe('string')
    expect(result.proposalId.length).toBeGreaterThan(0)

    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    const proposal = store.get(result.proposalId) as MutationProposal | null
    expect(proposal).not.toBeNull()
    expect(proposal!.status).toBe('pending_review')
    expect(proposal!.ops).toEqual([
      {
        op: 'setAttribute',
        blockId: DOC_NEEDS.id,
        // default preset already uses knowledge- prefix — no double-prefix
        name: 'knowledge-workflow_status',
        value: 'approved',
      },
    ])
    // Must NOT be applied
    expect(proposal!.status).not.toBe('applied')
  })

  it('keeps allowlist name and matches default view filter key end-to-end', async () => {
    const { invoke } = createHarness()
    const views = (await invoke(RPC_CHANNELS.knowledge.VIEWS_LIST, {
      connectionId: 'conn-1',
    })) as SharedViewConfig[]
    const research = views.find((v) => v.id === 'research-needs-review')!
    const filterKey = Object.keys(research.knowledgeFilter?.attributes ?? {})[0]
    const preset = research.presetActions?.find((a) => a.type === 'set_attribute')
    expect(filterKey).toBe('knowledge-workflow_status')
    expect(preset).toEqual({
      type: 'set_attribute',
      name: 'knowledge-workflow_status',
      value: 'approved',
    })

    const result = (await invoke(RPC_CHANNELS.knowledge.VIEW_SET_ATTRIBUTE, {
      connectionId: 'conn-1',
      ref: DOC_NEEDS,
      name: preset!.name,
      value: preset!.value,
    })) as { proposalId: string }
    const proposal = new KnowledgeMutationProposalsStore(workspaceRoot).get(result.proposalId)!
    expect(proposal.ops[0]).toMatchObject({
      op: 'setAttribute',
      name: 'knowledge-workflow_status',
      value: 'approved',
    })
  })

  it('prefixes bare workflow_status to knowledge-workflow_status', async () => {
    const { invoke } = createHarness()
    const result = (await invoke(RPC_CHANNELS.knowledge.VIEW_SET_ATTRIBUTE, {
      connectionId: 'conn-1',
      ref: DOC_NEEDS,
      name: 'workflow_status',
      value: 'approved',
    })) as { proposalId: string }
    const proposal = new KnowledgeMutationProposalsStore(workspaceRoot).get(result.proposalId)!
    expect(proposal.ops[0]).toMatchObject({
      op: 'setAttribute',
      name: 'knowledge-workflow_status',
      value: 'approved',
    })
  })
})

describe('envelopes', () => {
  it('upsert → get → list round-trip', async () => {
    const { invoke } = createHarness()
    const now = Date.now()
    const upserted = (await invoke(RPC_CHANNELS.knowledge.ENVELOPE_UPSERT, {
      connectionId: 'conn-1',
      envelope: {
        knowledgeRef: DOC_NEEDS,
        status: 'triage',
        labels: ['p5'],
        flagged: true,
        createdAt: now,
        updatedAt: now,
      } satisfies KnowledgeWorkEnvelope,
    })) as KnowledgeWorkEnvelope

    expect(upserted.knowledgeRef.id).toBe('doc-needs')
    expect(upserted.status).toBe('triage')

    const got = (await invoke(RPC_CHANNELS.knowledge.ENVELOPE_GET, {
      connectionId: 'conn-1',
      ref: DOC_NEEDS,
    })) as KnowledgeWorkEnvelope | null
    expect(got?.status).toBe('triage')
    expect(got?.flagged).toBe(true)

    const list = (await invoke(RPC_CHANNELS.knowledge.ENVELOPE_LIST, {
      connectionId: 'conn-1',
    })) as KnowledgeWorkEnvelope[]
    expect(list).toHaveLength(1)
    expect(list[0]!.labels).toEqual(['p5'])
  })
})
