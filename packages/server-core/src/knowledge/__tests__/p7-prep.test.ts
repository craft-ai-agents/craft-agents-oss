/**
 * P7-prep: managed mode fail-closed + metrics hooks on finalize/propose.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  InMemoryKnowledgeProvider,
  type KnowledgeNode,
  type KnowledgeRef,
  type PublishDraft,
} from '@craft-agent/core/knowledge'
import type { KnowledgeAutomationAction } from '@craft-agent/shared/automations'
import { CodedError } from '@craft-agent/shared/protocol'
import { KnowledgeConnectionsStore } from '../connections-store'
import {
  KnowledgeMetricsStore,
  __resetMetricsStoreCacheForTests,
} from '../metrics-store'
import { KnowledgePublicationService } from '../publication-service'
import { KnowledgePublishDraftsStore } from '../drafts-store'
import { KnowledgeBridgeService } from '../bridge-service'
import { KnowledgeMutationProposalsStore } from '../proposals-store'
import { KnowledgeAuditLog } from '../knowledge-audit'
import {
  ServerKnowledgeActionExecutor,
  type KnowledgeActionExecuteContext,
} from '../automation-actions'

let configDir: string
let workspaceRoot: string
const tmpDirs: string[] = []

const CONNECTION_ID = 'conn-p7'
const DOC_REF: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-1' }
const BLK_REF: KnowledgeRef = { scheme: 'siyuan', kind: 'block', id: 'blk-1' }

function makeDoc(): KnowledgeNode {
  return {
    ref: { ...DOC_REF },
    title: 'Doc',
    markdown: 'hello',
    path: '/Doc',
    attributes: [{ key: 'workflow_status', value: 'open' }],
    createdAt: 0,
    updatedAt: 0,
    contentHash: '',
  }
}

function makeBlock(): KnowledgeNode {
  return {
    ref: { ...BLK_REF },
    title: 'Block',
    markdown: 'block',
    path: '/Doc/blk',
    attributes: [{ key: 'workflow_status', value: 'open' }],
    createdAt: 0,
    updatedAt: 0,
    contentHash: '',
  }
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'p7-prep-cfg-'))
  workspaceRoot = mkdtempSync(join(tmpdir(), 'p7-prep-ws-'))
  tmpDirs.push(configDir, workspaceRoot)
  process.env.CRAFT_CONFIG_DIR = configDir
  __resetMetricsStoreCacheForTests()
})

afterEach(() => {
  __resetMetricsStoreCacheForTests()
  delete process.env.CRAFT_CONFIG_DIR
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

describe('managed mode fail-closed', () => {
  it('saveConnection rejects mode managed with CAPABILITY_DISABLED', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    try {
      store.save({
        baseUrl: 'http://127.0.0.1:6806',
        credentialRef: 'source_bearer::ws::c1',
        mode: 'managed',
      })
      throw new Error('expected CAPABILITY_DISABLED')
    } catch (error) {
      expect(error).toBeInstanceOf(CodedError)
      expect((error as CodedError).code).toBe('CAPABILITY_DISABLED')
      expect((error as CodedError).message).toMatch(/G2|managed/i)
    }
    expect(store.list()).toEqual([])
  })

  it('still saves external-local connections', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const saved = store.save({
      baseUrl: 'http://127.0.0.1:6806',
      credentialRef: 'source_bearer::ws::c1',
      mode: 'external-local',
    })
    expect(saved.mode).toBe('external-local')
  })
})

describe('metrics hooks', () => {
  it('finalize success increments publicationsTotal', async () => {
    const drafts = new KnowledgePublishDraftsStore(workspaceRoot)
    const now = Date.now()
    const draft: PublishDraft = {
      id: 'draft_p7_1',
      status: 'publishing',
      connectionId: CONNECTION_ID,
      title: 'T',
      markdown: '# hi',
      summary: 's',
      outline: [],
      sourceBlocks: [],
      sourceMessages: [],
      excluded: [],
      contentHash: 'abc',
      model: { connectionSlug: 'local', modelId: 'm' },
      createdAt: now,
      updatedAt: now,
      runIds: [],
      mode: 'create',
      targetNotebookId: 'nb',
      targetPath: '/t',
      targetDocId: 'doc_final',
    }
    drafts.save(draft)

    const service = new KnowledgePublicationService()
    const result = await service.finalize({
      workspaceRoot,
      draftId: draft.id,
      proposalId: 'prop_applied_1',
      appliedDocRef: { scheme: 'siyuan', kind: 'document', id: 'doc_final' },
    })
    expect(result.status).toBe('published')

    const metrics = new KnowledgeMetricsStore(workspaceRoot, {
      connectionsActive: () => 0,
      publicationsLast7d: () => 0,
    }).snapshot()
    expect(metrics.counters.publicationsTotal).toBe(1)
  })

  it('automation propose success increments automationProposalsTotal', async () => {
    const provider = new InMemoryKnowledgeProvider({
      connectionId: CONNECTION_ID,
      seed: { nodes: [makeDoc(), makeBlock()] },
    })
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    const bridge = new KnowledgeBridgeService({
      providerResolver: async () => provider,
      proposalsStore: store,
      audit: new KnowledgeAuditLog(workspaceRoot),
      resolvePermissionMode: () => 'allow-all',
      workspaceId: 'ws-1',
    })
    const executor = new ServerKnowledgeActionExecutor({
      getBridge: () => bridge,
      resolveConnectionId: () => CONNECTION_ID,
    })

    const action = {
      type: 'knowledge',
      op: 'set_attribute',
      name: 'knowledge-workflow_status',
      value: 'triaged',
      targetRef: BLK_REF,
    } as KnowledgeAutomationAction

    const ctx: KnowledgeActionExecuteContext = {
      event: 'KnowledgeAttributeChanged',
      payload: { connectionId: CONNECTION_ID, ref: BLK_REF },
      matcherId: 'auto-p7',
      automationName: 'p7 test',
      workspaceId: 'ws-1',
      workspaceRootPath: workspaceRoot,
      env: {},
    }

    const result = await executor.execute(action, ctx)
    expect(result.ok).toBe(true)
    expect(result.proposalId).toBeTruthy()

    const metrics = new KnowledgeMetricsStore(workspaceRoot, {
      connectionsActive: () => 0,
      publicationsLast7d: () => 0,
    }).snapshot()
    expect(metrics.counters.automationProposalsTotal).toBe(1)
  })
})
