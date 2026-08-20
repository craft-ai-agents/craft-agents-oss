/**
 * KnowledgePublicationService end-to-end (P4 / K-06):
 * distill → prepare(create) → apply(propose) → approve/apply via bridge → finalize.
 * Idempotent re-publish + adopt-required path.
 *
 * Seam discipline: InMemoryKnowledgeProvider with transactions:true (multi-op
 * create+attrs), real bridge + stores, fresh mkdtemp per test. No mock.module.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  InMemoryKnowledgeProvider,
  PROVENANCE_ATTR,
  hashKnowledgeContent,
  type KnowledgeNode,
  type KnowledgeRef,
} from '@craft-agent/core/knowledge'
import type { KnowledgeChangedPayload } from '@craft-agent/shared/protocol'
import { KnowledgeAuditLog } from '../knowledge-audit'
import { KnowledgeBridgeService } from '../bridge-service'
import { KnowledgeMutationProposalsStore } from '../proposals-store'
import { KnowledgePublicationService } from '../publication-service'
import { KnowledgePublishDraftsStore } from '../drafts-store'
import { KnowledgePublicationsStore } from '../publications-store'
import { KnowledgeLinksStore } from '../links-store'

process.env.CRAFT_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), 'craft-config-pub-'))

const CONNECTION_ID = 'conn-pub-1'
const NB_REF: KnowledgeRef = { scheme: 'siyuan', kind: 'notebook', id: 'nb-1' }
const T0 = Date.parse('2026-08-07T00:00:00.000Z')

let workspaceRoot: string
const tmpDirs: string[] = []
let nowMs = T0

function makeNotebook(): KnowledgeNode {
  return {
    ref: { ...NB_REF },
    title: 'Research',
    path: '/',
    attributes: [],
    createdAt: 0,
    updatedAt: 0,
    contentHash: '',
  }
}

function makeDoc(id: string, path: string, markdown: string, attrs: Array<{ key: string; value: string }> = []): KnowledgeNode {
  return {
    ref: { scheme: 'siyuan', kind: 'document', id },
    title: path.split('/').filter(Boolean).pop() ?? id,
    markdown,
    parentRef: { ...NB_REF },
    path,
    attributes: attrs,
    createdAt: 0,
    updatedAt: 0,
    contentHash: '',
  }
}

function newProvider(...nodes: KnowledgeNode[]): InMemoryKnowledgeProvider {
  return new InMemoryKnowledgeProvider({
    connectionId: CONNECTION_ID,
    seed: { nodes },
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
        transactions: true, // createDocument + provenance attrs in one proposal
        rollback: true,
      },
    },
  })
}

function makeHarness(provider: InMemoryKnowledgeProvider) {
  const store = new KnowledgeMutationProposalsStore(workspaceRoot)
  const audit = new KnowledgeAuditLog(workspaceRoot)
  const pushes: KnowledgeChangedPayload[] = []
  const bridge = new KnowledgeBridgeService({
    providerResolver: async () => provider,
    proposalsStore: store,
    audit,
    now: () => nowMs,
    resolvePermissionMode: () => 'allow-all',
    push: (p) => pushes.push(p),
  })
  const service = new KnowledgePublicationService({ now: () => nowMs })
  return { service, bridge, store, audit, provider, pushes }
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-pub-'))
  tmpDirs.push(workspaceRoot)
  nowMs = T0
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

const MESSAGES = [
  { id: 'msg_u1', role: 'user', content: 'Capture the architecture verdict for Craft × SiYuan.' },
  {
    id: 'msg_a1',
    role: 'assistant',
    content:
      '## Verdict\n\nCraft owns sessions; SiYuan owns documents. Publication is human-gated through the mutation proposal contour. Provenance is mandatory on every write.',
  },
]

describe('stores', () => {
  it('drafts-store persists per-file JSON atomically', () => {
    const drafts = new KnowledgePublishDraftsStore(workspaceRoot)
    expect(drafts.draftsDir).toBe(join(workspaceRoot, 'knowledge', 'drafts'))
    const service = new KnowledgePublicationService({ now: () => nowMs })
    // distill writes via service
    return service
      .distill({
        workspaceRoot,
        connectionId: CONNECTION_ID,
        sessionId: 'sess-1',
        messages: MESSAGES,
      })
      .then((draft) => {
        expect(drafts.get(draft.id)?.title).toBe(draft.title)
        expect(existsSync(join(drafts.draftsDir, `${draft.id}.json`))).toBe(true)
      })
  })

  it('publications/links jsonl skip corrupt lines', () => {
    const pubs = new KnowledgePublicationsStore(workspaceRoot)
    const links = new KnowledgeLinksStore(workspaceRoot)
    // seed corrupt + valid via raw write after first append
    const { mkdirSync, appendFileSync, writeFileSync } = require('fs') as typeof import('fs')
    mkdirSync(join(workspaceRoot, 'knowledge'), { recursive: true })
    writeFileSync(pubs.filePath, '{not json\n')
    appendFileSync(
      pubs.filePath,
      JSON.stringify({
        id: 'pub_1',
        draftId: 'draft_1',
        connectionId: CONNECTION_ID,
        targetRef: { scheme: 'siyuan', kind: 'document', id: 'd1' },
        mode: 'create',
        contentHash: 'abc',
        proposalId: 'p_1',
        provenance: {
          source_run_ids: [],
          published_at: new Date(T0).toISOString(),
          generated_by: { provider: 'p', model: 'm' },
          source_blocks: [],
          content_hash: 'abc',
        },
        createdAt: new Date(T0).toISOString(),
      }) + '\n',
    )
    expect(pubs.list()).toHaveLength(1)
    writeFileSync(links.filePath, 'BROKEN\n')
    links.append({
      id: 'link_1',
      craftRef: { scheme: 'craft', kind: 'session', id: 's1' },
      knowledgeRef: { scheme: 'siyuan', kind: 'document', id: 'd1' },
      relation: 'published-from',
      createdAt: new Date(T0).toISOString(),
    })
    expect(links.list()).toHaveLength(1)
  })
})

describe('distill → prepare(create) → apply → finalize', () => {
  it('full happy path creates proposal, then finalize writes publication+link', async () => {
    const provider = newProvider(makeNotebook())
    const { service, bridge } = makeHarness(provider)

    const draft = await service.distill({
      workspaceRoot,
      connectionId: CONNECTION_ID,
      sessionId: 'sess-42',
      runIds: ['run-7'],
      messages: MESSAGES,
      model: { connectionSlug: 'local', modelId: 'distill-v1' },
    })
    expect(draft.status).toBe('draft')
    expect(draft.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(draft.excluded.every((e) => typeof e.excerptHash === 'string')).toBe(true)

    const prepared = await service.prepare({
      workspaceRoot,
      draftId: draft.id,
      notebookId: NB_REF.id,
      path: '/Research/Craft-SiYuan',
      provider,
    })
    expect(prepared.mode).toBe('create')

    const afterPrepare = service.getDraft(workspaceRoot, draft.id)!
    expect(afterPrepare.status).toBe('target_pending')
    expect(afterPrepare.mode).toBe('create')
    expect(afterPrepare.targetPath).toBe('/Research/Craft-SiYuan')

    const applied = await service.apply({
      workspaceRoot,
      draftId: draft.id,
      provider,
      bridge,
      actor: 'user',
    })
    expect(applied.status).toBe('publishing')
    expect(applied.proposalId).toMatch(/^p_/)

    const proposal = bridge.get(applied.proposalId)
    expect(proposal).toBeTruthy()
    expect(proposal!.status).toBe('pending_review')
    expect(proposal!.ops[0]?.op).toBe('createDocument')
    expect(proposal!.ops.some((op) => op.op === 'setAttribute' && op.name === PROVENANCE_ATTR.contentHash)).toBe(true)

    // User approves + applies via P3
    await bridge.approve(applied.proposalId)
    const applyResult = await bridge.apply(applied.proposalId)
    expect(applyResult.applied).toBe(true)
    expect(applyResult.createdRef?.kind).toBe('document')

    const finalized = await service.finalize({
      workspaceRoot,
      draftId: draft.id,
      proposalId: applied.proposalId,
      appliedDocRef: applyResult.createdRef,
    })
    expect(finalized.status).toBe('published')
    expect(finalized.publicationId).toMatch(/^pub_/)

    const pubs = service.listPublications(workspaceRoot, { sessionId: 'sess-42' })
    expect(pubs).toHaveLength(1)
    expect(pubs[0]!.contentHash).toBe(draft.contentHash)
    expect(pubs[0]!.provenance.source_session_id).toBe('sess-42')
    expect(pubs[0]!.provenance.source_run_ids).toEqual(['run-7'])

    const links = service.listLinks(workspaceRoot, { craftId: 'sess-42' })
    expect(links).toHaveLength(1)
    expect(links[0]!.relation).toBe('published-from')
    expect(links[0]!.knowledgeRef.id).toBe(applyResult.createdRef!.id)

    const publishedDraft = service.getDraft(workspaceRoot, draft.id)!
    expect(publishedDraft.status).toBe('published')

    // doc exists in provider with provenance body
    const doc = await provider.get(applyResult.createdRef!)
    expect(doc.markdown ?? '').toContain('craft:')
    expect(doc.attributes.some((a) => a.key === PROVENANCE_ATTR.sourceSessionId && a.value === 'sess-42')).toBe(true)

    // finalize idempotent
    const again = await service.finalize({
      workspaceRoot,
      draftId: draft.id,
      proposalId: applied.proposalId,
      appliedDocRef: applyResult.createdRef,
    })
    expect(again.publicationId).toBe(finalized.publicationId)
    expect(service.listPublications(workspaceRoot, { sessionId: 'sess-42' })).toHaveLength(1)
  })
})

describe('idempotent re-publish and adopt-required', () => {
  it('prepare returns update when published-from link exists', async () => {
    const existing = makeDoc('doc-existing', '/Research/Craft-SiYuan', '# Old\n', [
      { key: PROVENANCE_ATTR.sourceSessionId, value: 'sess-99' },
    ])
    existing.contentHash = await hashKnowledgeContent(existing.markdown ?? '')
    const provider = newProvider(makeNotebook(), existing)
    const { service, bridge } = makeHarness(provider)

    // seed link as if previously published
    const links = new KnowledgeLinksStore(workspaceRoot)
    links.append({
      id: 'link_seed',
      craftRef: { scheme: 'craft', kind: 'session', id: 'sess-99' },
      knowledgeRef: { scheme: 'siyuan', kind: 'document', id: 'doc-existing' },
      relation: 'published-from',
      createdAt: new Date(T0).toISOString(),
    })

    const draft = await service.distill({
      workspaceRoot,
      connectionId: CONNECTION_ID,
      sessionId: 'sess-99',
      messages: MESSAGES,
    })
    const prepared = await service.prepare({
      workspaceRoot,
      draftId: draft.id,
      notebookId: NB_REF.id,
      path: '/Research/Craft-SiYuan',
      provider,
    })
    expect(prepared.mode).toBe('update')
    expect(prepared.docId).toBe('doc-existing')

    const applied = await service.apply({
      workspaceRoot,
      draftId: draft.id,
      provider,
      bridge,
      actor: 'user',
    })
    expect(applied.status).toBe('publishing')
    const proposal = bridge.get(applied.proposalId)!
    expect(proposal.ops[0]?.op).toBe('updateBlock')
  })

  it('apply short-circuits when contentHash matches last publication', async () => {
    const provider = newProvider(makeNotebook())
    const { service, bridge } = makeHarness(provider)
    const draft = await service.distill({
      workspaceRoot,
      connectionId: CONNECTION_ID,
      sessionId: 'sess-same',
      messages: MESSAGES,
    })
    await service.prepare({
      workspaceRoot,
      draftId: draft.id,
      notebookId: NB_REF.id,
      path: '/R/A',
      provider,
    })
    const first = await service.apply({
      workspaceRoot,
      draftId: draft.id,
      provider,
      bridge,
      actor: 'user',
    })
    await bridge.approve(first.proposalId)
    const ar = await bridge.apply(first.proposalId)
    await service.finalize({
      workspaceRoot,
      draftId: draft.id,
      proposalId: first.proposalId,
      appliedDocRef: ar.createdRef,
    })

    // re-distill identical content → same hash
    const draft2 = await service.distill({
      workspaceRoot,
      connectionId: CONNECTION_ID,
      sessionId: 'sess-same',
      messages: MESSAGES,
    })
    expect(draft2.contentHash).toBe(draft.contentHash)
    await service.prepare({
      workspaceRoot,
      draftId: draft2.id,
      notebookId: NB_REF.id,
      path: '/R/A',
      provider,
    })
    const second = await service.apply({
      workspaceRoot,
      draftId: draft2.id,
      provider,
      bridge,
      actor: 'user',
    })
    expect(second.status).toBe('published')
    expect(second.proposalId).toBe(first.proposalId)
    expect(second.publicationId).toBeTruthy()
  })

  it('path occupied without craft attr → adopt-required; adoptExisting → update', async () => {
    const stranger = makeDoc('doc-stranger', '/Research/Taken', '# Someone else wrote this\n')
    stranger.contentHash = await hashKnowledgeContent(stranger.markdown ?? '')
    const provider = newProvider(makeNotebook(), stranger)
    const { service } = makeHarness(provider)

    const draft = await service.distill({
      workspaceRoot,
      connectionId: CONNECTION_ID,
      sessionId: 'sess-new',
      messages: MESSAGES,
    })
    const blocked = await service.prepare({
      workspaceRoot,
      draftId: draft.id,
      notebookId: NB_REF.id,
      path: '/Research/Taken',
      provider,
    })
    expect(blocked.mode).toBe('adopt-required')
    expect(blocked.docId).toBe('doc-stranger')

    const adopted = await service.prepare({
      workspaceRoot,
      draftId: draft.id,
      notebookId: NB_REF.id,
      path: '/Research/Taken',
      adoptExisting: true,
      provider,
    })
    expect(adopted.mode).toBe('update')
    expect(adopted.docId).toBe('doc-stranger')
    expect(service.getDraft(workspaceRoot, draft.id)!.mode).toBe('update')
  })
})

describe('updateDraft', () => {
  it('recomputes contentHash and can read back', async () => {
    const provider = newProvider(makeNotebook())
    const { service } = makeHarness(provider)
    const draft = await service.distill({
      workspaceRoot,
      connectionId: CONNECTION_ID,
      sessionId: 'sess-edit',
      messages: MESSAGES,
    })
    const updated = service.updateDraft(workspaceRoot, draft.id, {
      title: 'Edited title',
      markdown: '# Edited title\n\nNew body about the publication pipeline.\n',
    })
    expect(updated.title).toBe('Edited title')
    expect(updated.contentHash).not.toBe(draft.contentHash)
    expect(service.getDraft(workspaceRoot, draft.id)?.markdown).toContain('New body')
  })
})
