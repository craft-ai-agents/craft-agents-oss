/**
 * P4 publication RPC handler tests (spec 06):
 * HANDLED_CHANNELS membership for 8 publish channels; distill with inline
 * messages → draft; get/update draft; prepare create; apply → proposalId;
 * finalize without applied proposal → conflict/error; list empty.
 *
 * Harness mirrors knowledge.test.ts (CRAFT_CONFIG_DIR + workspace/credential
 * mock.module). Apply path uses InMemoryKnowledgeProvider via the handler
 * constructor seam so we don't need a full SiYuan kernel fixture matrix.
 */
import '../memory-test-setup'
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { CredentialId } from '@craft-agent/shared/credentials'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import type {
  ApplyResult,
  KnowledgeConnection,
  KnowledgeProvider,
  PublishApplyResult,
  PublishDraft,
  PublishPrepareResult,
} from '@craft-agent/core/knowledge'
import { InMemoryKnowledgeProvider } from '@craft-agent/core/knowledge'
import { KnowledgeConnectionsStore, KnowledgeMutationProposalsStore } from '../../../knowledge'
import type { KnowledgeProposalFileRecord } from '../../../knowledge/bridge-service'
import type { SaveConnectionInput } from '../../../knowledge'
import { HANDLED_CHANNELS, registerKnowledgeHandlers, __setKnowledgeTestConstructors, __setSkipKnowledgeWatchAutoStart } from '../knowledge'

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

/** Seed an InMemory provider so prepare/apply do not depend on SiYuan kernel fixtures. */
function useInMemoryProvider() {
  __setKnowledgeTestConstructors(
    class implements KnowledgeProvider {
      private inner: InMemoryKnowledgeProvider
      constructor(options: { connection: KnowledgeConnection; token: string }) {
        this.inner = new InMemoryKnowledgeProvider({
          connectionId: options.connection.id,
          // Match production publish batch: createDocument + provenance setAttribute ops.
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
              {
                ref: { scheme: 'siyuan', kind: 'notebook', id: 'nb-1' },
                title: 'Research',
                path: '/Research',
                attributes: [],
                createdAt: 0,
                updatedAt: 0,
                contentHash: '0'.repeat(64),
                markdown: '',
              },
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

afterEach(() => {
  __setKnowledgeTestConstructors(null)
})

afterAll(() => {
  __setKnowledgeTestConstructors(null)
})

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
      imageProcessor: { getMetadata: async () => null, process: async () => Buffer.from('') },
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

const SAMPLE_MESSAGES = [
  {
    id: 'm1',
    role: 'user',
    content: 'Document the Session to Knowledge publication pipeline architecture decisions.',
  },
  {
    id: 'm2',
    role: 'assistant',
    content:
      '## Architecture\n\nThe publication pipeline distills session transcripts into structured drafts, then routes writes through the P3 mutation proposal lifecycle. Provenance is recorded as YAML front-matter and craft-* attributes.\n\n## Steps\n\n1. Distill\n2. Prepare target\n3. Apply proposal\n4. Finalize after applied',
  },
]

beforeEach(() => {
  __setSkipKnowledgeWatchAutoStart(true)
  workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-publish-ws-'))
  rmSync(join(process.env.CRAFT_CONFIG_DIR!, 'knowledge'), { recursive: true, force: true })
  credentials.clear()
})

describe('P4 publication channels registration', () => {
  it('includes all 8 publish channels in HANDLED_CHANNELS', () => {
    const publish = [
      RPC_CHANNELS.knowledge.PUBLISH_DISTILL,
      RPC_CHANNELS.knowledge.PUBLISH_GET_DRAFT,
      RPC_CHANNELS.knowledge.PUBLISH_UPDATE_DRAFT,
      RPC_CHANNELS.knowledge.PUBLISH_PREPARE,
      RPC_CHANNELS.knowledge.PUBLISH_APPLY,
      RPC_CHANNELS.knowledge.PUBLISH_FINALIZE,
      RPC_CHANNELS.knowledge.PUBLISH_LIST,
      RPC_CHANNELS.knowledge.LIST_LINKS,
    ]
    for (const ch of publish) expect(HANDLED_CHANNELS).toContain(ch)
    expect(HANDLED_CHANNELS).toHaveLength(37) // 9 P1 + 7 P3 + 8 P4 + 6 P5 + 2 P6 + 3 P7-prep + 2 P7
  })

  it('registers handlers for every publish channel', () => {
    const { handlers } = createHarness()
    for (const ch of [
      RPC_CHANNELS.knowledge.PUBLISH_DISTILL,
      RPC_CHANNELS.knowledge.PUBLISH_GET_DRAFT,
      RPC_CHANNELS.knowledge.PUBLISH_UPDATE_DRAFT,
      RPC_CHANNELS.knowledge.PUBLISH_PREPARE,
      RPC_CHANNELS.knowledge.PUBLISH_APPLY,
      RPC_CHANNELS.knowledge.PUBLISH_FINALIZE,
      RPC_CHANNELS.knowledge.PUBLISH_LIST,
      RPC_CHANNELS.knowledge.LIST_LINKS,
    ]) {
      expect(handlers.has(ch)).toBe(true)
    }
  })
})

describe('publishDistill / get / update', () => {
  it('distills inline messages into a persisted draft', async () => {
    seedConnection('conn-1', { status: 'ok' })
    const { invoke } = createHarness()
    const draft = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_DISTILL, {
      connectionId: 'conn-1',
      sessionId: 'sess_test_1',
      messages: SAMPLE_MESSAGES,
      model: { connectionSlug: 'local', modelId: 'deterministic-distill' },
    })) as PublishDraft

    expect(draft.id).toMatch(/^draft_/)
    expect(draft.status).toBe('draft')
    expect(draft.connectionId).toBe('conn-1')
    expect(draft.sessionId).toBe('sess_test_1')
    expect(draft.markdown.length).toBeGreaterThan(40)
    expect(draft.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(draft.sourceMessages.length).toBeGreaterThan(0)
    expect(draft.title.length).toBeGreaterThan(0)

    const loaded = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_GET_DRAFT, {
      draftId: draft.id,
      connectionId: 'conn-1',
    })) as PublishDraft | null
    expect(loaded?.id).toBe(draft.id)
    expect(loaded?.contentHash).toBe(draft.contentHash)
  })

  it('updates draft title and markdown and recomputes contentHash', async () => {
    seedConnection('conn-1', { status: 'ok' })
    const { invoke } = createHarness()
    const draft = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_DISTILL, {
      connectionId: 'conn-1',
      sessionId: 'sess_test_1',
      messages: SAMPLE_MESSAGES,
    })) as PublishDraft

    const updated = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_UPDATE_DRAFT, {
      draftId: draft.id,
      connectionId: 'conn-1',
      title: 'Revised title',
      markdown: '# Revised title\n\n## Body\n\nUpdated body content for the publication draft.',
    })) as PublishDraft

    expect(updated.title).toBe('Revised title')
    expect(updated.markdown).toContain('Updated body content')
    expect(updated.contentHash).not.toBe(draft.contentHash)
    expect(updated.markdown).toContain('## Body')
  })

  it('rejects distill without messages', async () => {
    seedConnection('conn-1', { status: 'ok' })
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.PUBLISH_DISTILL, {
        connectionId: 'conn-1',
        sessionId: 'sess_empty',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
  })
})

describe('publishPrepare create', () => {
  it('prepares a create target when path is free', async () => {
    useInMemoryProvider()
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'tok' })
    const { invoke } = createHarness()
    const draft = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_DISTILL, {
      connectionId: 'conn-1',
      sessionId: 'sess_prep',
      messages: SAMPLE_MESSAGES,
    })) as PublishDraft

    const prepared = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_PREPARE, {
      draftId: draft.id,
      connectionId: 'conn-1',
      notebookId: 'nb-1',
      path: '/Research/Publication Pipeline',
    })) as PublishPrepareResult

    expect(prepared.mode).toBe('create')

    const reloaded = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_GET_DRAFT, {
      draftId: draft.id,
      connectionId: 'conn-1',
    })) as PublishDraft
    expect(reloaded.status).toBe('target_pending')
    expect(reloaded.mode).toBe('create')
    expect(reloaded.targetNotebookId).toBe('nb-1')
    expect(reloaded.targetPath).toContain('Publication')
  })
})

describe('publishApply + finalize', () => {
  it('apply returns a proposalId with publishing status', async () => {
    useInMemoryProvider()
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'tok' })
    const { invoke } = createHarness()
    const draft = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_DISTILL, {
      connectionId: 'conn-1',
      sessionId: 'sess_apply',
      messages: SAMPLE_MESSAGES,
    })) as PublishDraft
    await invoke(RPC_CHANNELS.knowledge.PUBLISH_PREPARE, {
      draftId: draft.id,
      connectionId: 'conn-1',
      notebookId: 'nb-1',
      path: '/Research/Apply Path',
    })

    const result = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_APPLY, {
      draftId: draft.id,
      connectionId: 'conn-1',
    })) as PublishApplyResult

    expect(result.proposalId).toMatch(/^p_/)
    expect(result.status).toBe('publishing')

    const reloaded = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_GET_DRAFT, {
      draftId: draft.id,
      connectionId: 'conn-1',
    })) as PublishDraft
    expect(reloaded.status).toBe('publishing')
    expect(reloaded.proposalId).toBe(result.proposalId)
  })

  it('finalize without applied proposal rejects with HASH_CONFLICT', async () => {
    useInMemoryProvider()
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'tok' })
    const { invoke } = createHarness()
    const draft = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_DISTILL, {
      connectionId: 'conn-1',
      sessionId: 'sess_fin',
      messages: SAMPLE_MESSAGES,
    })) as PublishDraft
    await invoke(RPC_CHANNELS.knowledge.PUBLISH_PREPARE, {
      draftId: draft.id,
      connectionId: 'conn-1',
      notebookId: 'nb-1',
      path: '/Research/Finalize Path',
    })
    const applied = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_APPLY, {
      draftId: draft.id,
      connectionId: 'conn-1',
    })) as PublishApplyResult

    // Proposal is still draft/pending_review — finalize must refuse.
    await expect(
      invoke(RPC_CHANNELS.knowledge.PUBLISH_FINALIZE, {
        draftId: draft.id,
        proposalId: applied.proposalId,
        connectionId: 'conn-1',
      }),
    ).rejects.toMatchObject({ code: 'HASH_CONFLICT' })
  })

  it('finalize succeeds after proposal is marked applied', async () => {
    useInMemoryProvider()
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'tok' })
    const { invoke } = createHarness()
    const draft = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_DISTILL, {
      connectionId: 'conn-1',
      sessionId: 'sess_fin_ok',
      messages: SAMPLE_MESSAGES,
    })) as PublishDraft
    await invoke(RPC_CHANNELS.knowledge.PUBLISH_PREPARE, {
      draftId: draft.id,
      connectionId: 'conn-1',
      notebookId: 'nb-1',
      path: '/Research/Finalize Ok',
    })
    const applied = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_APPLY, {
      draftId: draft.id,
      connectionId: 'conn-1',
    })) as PublishApplyResult

    // Simulate P3 apply completing: flip proposal status to applied on disk.
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    const record = store.get(applied.proposalId) as KnowledgeProposalFileRecord | null
    expect(record).toBeTruthy()
    const now = new Date().toISOString()
    store.save({
      ...record!,
      status: 'applied',
      appliedAt: now,
      statusHistory: [
        ...(record!.statusHistory ?? []),
        { from: record!.status, to: 'applied', at: now, actor: 'user' },
      ],
      updatedAt: now,
    } as KnowledgeProposalFileRecord)

    const finalized = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_FINALIZE, {
      draftId: draft.id,
      proposalId: applied.proposalId,
      connectionId: 'conn-1',
      appliedDocRef: { scheme: 'siyuan', kind: 'document', id: 'doc_pub_1' },
    })) as PublishApplyResult

    expect(finalized.status).toBe('published')
    expect(finalized.publicationId).toMatch(/^pub_/)
    expect(finalized.docRef).toEqual({ scheme: 'siyuan', kind: 'document', id: 'doc_pub_1' })
  })

  it('finalize create uses proposal.createdRef when appliedDocRef omitted', async () => {
    useInMemoryProvider()
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'tok' })
    const { invoke } = createHarness()
    const draft = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_DISTILL, {
      connectionId: 'conn-1',
      sessionId: 'sess_created_ref',
      messages: SAMPLE_MESSAGES,
    })) as PublishDraft
    await invoke(RPC_CHANNELS.knowledge.PUBLISH_PREPARE, {
      draftId: draft.id,
      connectionId: 'conn-1',
      notebookId: 'nb-1',
      path: '/Research/Created Ref Path',
    })
    const applied = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_APPLY, {
      draftId: draft.id,
      connectionId: 'conn-1',
    })) as PublishApplyResult

    // Real apply path: approve + APPLY_PROPOSAL persists createdRef on the proposal record.
    await invoke(RPC_CHANNELS.knowledge.APPROVE_PROPOSAL, { proposalId: applied.proposalId })
    const applyResult = (await invoke(RPC_CHANNELS.knowledge.APPLY_PROPOSAL, {
      proposalId: applied.proposalId,
      workspaceId: 'ws1',
    })) as ApplyResult
    expect(applyResult.status).toBe('applied')
    expect(applyResult.createdRef?.kind).toBe('document')
    expect(applyResult.createdRef?.id).toBeTruthy()

    const record = new KnowledgeMutationProposalsStore(workspaceRoot).get(applied.proposalId)
    expect(record?.createdRef).toEqual(applyResult.createdRef)

    // Auto-finalize may already have published the draft; if so, re-finalize is idempotent.
    // Drop appliedDocRef intentionally — handler must resolve via proposal.createdRef.
    const finalized = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_FINALIZE, {
      draftId: draft.id,
      proposalId: applied.proposalId,
      connectionId: 'conn-1',
    })) as PublishApplyResult

    expect(finalized.status).toBe('published')
    expect(finalized.publicationId).toMatch(/^pub_/)
    expect(finalized.docRef).toEqual(applyResult.createdRef)
  })

  it('apply → approve → applyProposal auto-finalizes publishing draft', async () => {
    useInMemoryProvider()
    seedConnection('conn-1', { status: 'ok' })
    credentials.set('source_bearer::ws1::conn-1', { value: 'tok' })
    const { invoke } = createHarness()
    const draft = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_DISTILL, {
      connectionId: 'conn-1',
      sessionId: 'sess_auto_fin',
      messages: SAMPLE_MESSAGES,
    })) as PublishDraft
    await invoke(RPC_CHANNELS.knowledge.PUBLISH_PREPARE, {
      draftId: draft.id,
      connectionId: 'conn-1',
      notebookId: 'nb-1',
      path: '/Research/Auto Finalize',
    })
    const applied = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_APPLY, {
      draftId: draft.id,
      connectionId: 'conn-1',
    })) as PublishApplyResult
    expect(applied.status).toBe('publishing')

    await invoke(RPC_CHANNELS.knowledge.APPROVE_PROPOSAL, { proposalId: applied.proposalId })
    const applyResult = (await invoke(RPC_CHANNELS.knowledge.APPLY_PROPOSAL, {
      proposalId: applied.proposalId,
      workspaceId: 'ws1',
    })) as ApplyResult
    expect(applyResult.status).toBe('applied')
    expect(applyResult.createdRef?.id).toBeTruthy()

    const published = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_GET_DRAFT, {
      draftId: draft.id,
      connectionId: 'conn-1',
    })) as PublishDraft
    expect(published.status).toBe('published')
    expect(published.publicationId).toMatch(/^pub_/)
    expect(published.targetDocId).toBe(applyResult.createdRef!.id)

    const pubs = (await invoke(RPC_CHANNELS.knowledge.PUBLISH_LIST, {
      connectionId: 'conn-1',
      sessionId: 'sess_auto_fin',
    })) as Array<{ id: string; targetRef: { id: string }; proposalId: string }>
    expect(pubs).toHaveLength(1)
    expect(pubs[0]!.proposalId).toBe(applied.proposalId)
    expect(pubs[0]!.targetRef.id).toBe(applyResult.createdRef!.id)

    const links = (await invoke(RPC_CHANNELS.knowledge.LIST_LINKS, {
      connectionId: 'conn-1',
    })) as Array<{ relation: string; knowledgeRef: { id: string } }>
    expect(links.some((l) => l.relation === 'published-from' && l.knowledgeRef.id === applyResult.createdRef!.id)).toBe(
      true,
    )
  })
})

describe('publish prepare/apply require connectionId', () => {
  it('prepare without connectionId → INVALID_REF', async () => {
    seedConnection('conn-1', { status: 'ok' })
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.PUBLISH_PREPARE, {
        draftId: 'draft_x',
        notebookId: 'nb-1',
        path: '/x',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
  })

  it('apply without connectionId → INVALID_REF', async () => {
    seedConnection('conn-1', { status: 'ok' })
    const { invoke } = createHarness()
    await expect(
      invoke(RPC_CHANNELS.knowledge.PUBLISH_APPLY, {
        draftId: 'draft_x',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REF' })
  })
})

describe('publishList / listLinks', () => {
  it('lists empty publications and links for a fresh workspace', async () => {
    seedConnection('conn-1', { status: 'ok' })
    const { invoke } = createHarness()
    const pubs = await invoke(RPC_CHANNELS.knowledge.PUBLISH_LIST, { connectionId: 'conn-1' })
    const links = await invoke(RPC_CHANNELS.knowledge.LIST_LINKS, { connectionId: 'conn-1' })
    expect(pubs).toEqual([])
    expect(links).toEqual([])
  })
})
