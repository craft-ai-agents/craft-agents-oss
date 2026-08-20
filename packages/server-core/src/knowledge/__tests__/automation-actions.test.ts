/**
 * ServerKnowledgeActionExecutor — P6 knowledge automation ops (propose-only).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  InMemoryKnowledgeProvider,
  type KnowledgeNode,
  type KnowledgeRef,
  type MutationOp,
} from '@craft-agent/core/knowledge'
import type { KnowledgeAutomationAction } from '@craft-agent/shared/automations'
import { KnowledgeBridgeService } from '../bridge-service'
import { KnowledgeMutationProposalsStore } from '../proposals-store'
import { KnowledgeAuditLog } from '../knowledge-audit'
import { KnowledgeLinksStore } from '../links-store'
import { AutomationLoopGuard } from '../automation-loop-guard'
import {
  ServerKnowledgeActionExecutor,
  type KnowledgeActionExecuteContext,
} from '../automation-actions'

process.env.CRAFT_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), 'craft-config-auto-act-'))

const CONNECTION_ID = 'conn-auto'
const DOC_REF: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-1' }
const BLK_REF: KnowledgeRef = { scheme: 'siyuan', kind: 'block', id: 'blk-1' }
const NB_REF: KnowledgeRef = { scheme: 'siyuan', kind: 'notebook', id: 'nb-1' }

function makeDoc(markdown = 'hello'): KnowledgeNode {
  return {
    ref: { ...DOC_REF },
    title: 'Doc',
    markdown,
    path: '/Doc',
    attributes: [{ key: 'workflow_status', value: 'open' }],
    createdAt: 0,
    updatedAt: 0,
    contentHash: '',
  }
}

function makeBlock(markdown = 'block'): KnowledgeNode {
  return {
    ref: { ...BLK_REF },
    title: 'Block',
    markdown,
    path: '/Doc/blk',
    attributes: [{ key: 'workflow_status', value: 'open' }],
    createdAt: 0,
    updatedAt: 0,
    contentHash: '',
  }
}

function makeNotebook(): KnowledgeNode {
  return {
    ref: { ...NB_REF },
    title: 'NB',
    path: '/',
    attributes: [],
    createdAt: 0,
    updatedAt: 0,
    contentHash: '',
  }
}

describe('ServerKnowledgeActionExecutor', () => {
  let workspaceRoot: string
  const tmpDirs: string[] = []
  let provider: InMemoryKnowledgeProvider
  let bridge: KnowledgeBridgeService
  let store: KnowledgeMutationProposalsStore
  let executor: ServerKnowledgeActionExecutor
  let loopGuard: AutomationLoopGuard

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'craft-auto-act-'))
    tmpDirs.push(workspaceRoot)
    provider = new InMemoryKnowledgeProvider({
      connectionId: CONNECTION_ID,
      seed: { nodes: [makeNotebook(), makeDoc(), makeBlock()] },
    })
    store = new KnowledgeMutationProposalsStore(workspaceRoot)
    bridge = new KnowledgeBridgeService({
      providerResolver: async () => provider,
      proposalsStore: store,
      audit: new KnowledgeAuditLog(workspaceRoot),
      resolvePermissionMode: () => 'allow-all',
      workspaceId: 'ws-1',
    })
    loopGuard = new AutomationLoopGuard({ ttlMs: 120_000 })
    executor = new ServerKnowledgeActionExecutor({
      getBridge: () => bridge,
      loopGuard,
      resolveConnectionId: () => CONNECTION_ID,
    })
  })

  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  function ctx(over: Partial<KnowledgeActionExecuteContext> = {}): KnowledgeActionExecuteContext {
    return {
      event: 'KnowledgeAttributeChanged',
      payload: { connectionId: CONNECTION_ID, ref: BLK_REF },
      matcherId: 'auto-test',
      automationName: 'test automation',
      workspaceId: 'ws-1',
      workspaceRootPath: workspaceRoot,
      env: {},
      ...over,
    }
  }

  it('set_attribute creates a proposal only (never applies) with actor automation', async () => {
    const action: KnowledgeAutomationAction = {
      type: 'knowledge',
      op: 'set_attribute',
      targetRef: BLK_REF,
      name: 'workflow_status',
      value: 'review',
    }
    const result = await executor.execute(action, ctx())
    expect(result.ok).toBe(true)
    expect(result.proposalId).toBeDefined()

    const proposal = store.get(result.proposalId!)
    expect(proposal).toBeDefined()
    expect(proposal!.status).toBe('pending_review')
    expect(proposal!.actor).toBe('automation')
    expect(proposal!.ops.some((op: MutationOp) => op.op === 'setAttribute')).toBe(true)
    const setOp = proposal!.ops.find((op) => op.op === 'setAttribute')
    expect(setOp && setOp.op === 'setAttribute' && setOp.name).toBe('knowledge-workflow_status')
    // Node content unchanged (not applied)
    const live = await provider.get(BLK_REF)
    expect(live.attributes.find((a) => a.key === 'workflow_status')?.value).toBe('open')
  })

  it('propose_patch never auto-applies even when autoApply true', async () => {
    const action: KnowledgeAutomationAction = {
      type: 'knowledge',
      op: 'propose_patch',
      targetRef: DOC_REF,
      patchMarkdown: 'patched by automation',
      autoApply: true,
    }
    const result = await executor.execute(action, ctx())
    expect(result.ok).toBe(true)
    const proposal = store.get(result.proposalId!)
    expect(proposal!.status).toBe('pending_review')
    const live = await provider.get(DOC_REF)
    expect(live.markdown).toBe('hello')
  })

  it('create_document proposes createDocument against notebook', async () => {
    const action: KnowledgeAutomationAction = {
      type: 'knowledge',
      op: 'create_document',
      notebook: 'nb-1',
      path: '/Research/Reports/r1',
      markdown: '# Report\n',
    }
    const result = await executor.execute(action, ctx())
    expect(result.ok).toBe(true)
    const proposal = store.get(result.proposalId!)
    expect(proposal!.ops[0]?.op).toBe('createDocument')
    expect(proposal!.status).toBe('pending_review')
    expect(proposal!.actor).toBe('automation')
  })

  it('append_block proposes appendBlock', async () => {
    const action: KnowledgeAutomationAction = {
      type: 'knowledge',
      op: 'append_block',
      parentRef: DOC_REF,
      markdown: 'appended line',
    }
    const result = await executor.execute(action, ctx())
    expect(result.ok).toBe(true)
    const proposal = store.get(result.proposalId!)
    expect(proposal!.ops[0]?.op).toBe('appendBlock')
    expect(proposal!.status).toBe('pending_review')
  })

  it('link_session writes Craft-side links store without proposal', async () => {
    const action: KnowledgeAutomationAction = {
      type: 'knowledge',
      op: 'link_session',
      knowledgeRef: BLK_REF,
      craftRef: { scheme: 'craft', kind: 'run', id: 'run-1' },
      relation: 'researched-by',
    }
    const before = store.list().length
    const result = await executor.execute(action, ctx())
    expect(result.ok).toBe(true)
    expect(result.linkId).toBeDefined()
    expect(result.proposalId).toBeUndefined()
    expect(store.list().length).toBe(before)

    const links = new KnowledgeLinksStore(workspaceRoot).list()
    expect(links.some((l) => l.id === result.linkId)).toBe(true)
    expect(links[0]?.relation).toBe('tracked-by') // researched-by mapped
  })

  it('publish_run proposes placeholder document with review attrs', async () => {
    const action: KnowledgeAutomationAction = {
      type: 'knowledge',
      op: 'publish_run',
      runId: 'run-42',
      targetNotebook: 'nb-1',
      targetPath: '/Research/Reports',
      review: 'required',
    }
    const result = await executor.execute(action, ctx())
    expect(result.ok).toBe(true)
    const proposal = store.get(result.proposalId!)
    expect(proposal!.status).toBe('pending_review')
    expect(proposal!.ops[0]?.op).toBe('createDocument')
    expect(proposal!.actor).toBe('automation')
    // summary may ride only on the propose input; actor is the durable audit signal
    expect(proposal!.ops.some((op) => op.op === 'setAttribute')).toBe(true)
  })

  it('loop-guard suppresses re-entrant write from same automation', async () => {
    const action: KnowledgeAutomationAction = {
      type: 'knowledge',
      op: 'set_attribute',
      targetRef: BLK_REF,
      name: 'workflow_status',
      value: 'review',
    }
    const first = await executor.execute(action, ctx({ matcherId: 'loop-a' }))
    expect(first.ok).toBe(true)

    const second = await executor.execute(action, ctx({ matcherId: 'loop-a' }))
    expect(second.ok).toBe(false)
    expect(second.error).toMatch(/loop-guard/)
  })

  it('flags set_attribute outside attributeAllowList but still proposes', async () => {
    const action: KnowledgeAutomationAction = {
      type: 'knowledge',
      op: 'set_attribute',
      targetRef: BLK_REF,
      name: 'other_field',
      value: 'x',
    }
    const result = await executor.execute(
      action,
      ctx({ attributeAllowList: ['workflow_status'], matcherId: 'allow-1' }),
    )
    expect(result.ok).toBe(true)
    expect(result.outsideAllowList).toBe(true)
    expect(result.proposalId).toBeDefined()
  })

  it('cloud_run.submit records intent and returns runId without throwing', async () => {
    const result = await executor.submitCloudRun(
      { type: 'cloud_run.submit', skillSlug: 'deep-research', topic: 't', callbackTag: 'tag' },
      ctx(),
    )
    expect(result.ok).toBe(true)
    expect(result.runId).toMatch(/^run_auto_/)
  })
})
