/**
 * P6 fundamental P0/P1 fixes — integration coverage.
 *
 * - Loop-guard suppresses watcher emit after noteWrite without automationId
 * - Nested attribute.name condition matches (shared conditions)
 * - CloudRunCompleted emission (mock emit)
 * - bridge registry shared after automation registration
 * - Reference scenario: AttributeChanged → set_attribute propose → noteWrite → watcher suppress
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  InMemoryKnowledgeProvider,
  hashKnowledgeContent,
  type KnowledgeNode,
  type KnowledgeRef,
} from '@craft-agent/core/knowledge'
import { evaluateConditions } from '@craft-agent/shared/automations'
import type { AutomationCondition, KnowledgeAutomationAction } from '@craft-agent/shared/automations'
import { AutomationLoopGuard } from '../automation-loop-guard'
import {
  KnowledgeChangeWatcher,
  stopAllKnowledgeWatches,
  type KnowledgeWatchEvent,
  type KnowledgeWatchPayload,
} from '../change-watcher'
import {
  clearKnowledgeBridgeRegistry,
  getKnowledgeBridge,
  registerKnowledgeBridge,
} from '../bridge-registry'
import { KnowledgeBridgeService } from '../bridge-service'
import { KnowledgeMutationProposalsStore } from '../proposals-store'
import { KnowledgeAuditLog } from '../knowledge-audit'
import {
  ServerKnowledgeActionExecutor,
  type KnowledgeActionExecuteContext,
} from '../automation-actions'
import { emitCloudRunCompletedForTest } from '../../handlers/rpc/cloud-runs'
import type { HandlerDeps } from '../../handlers/handler-deps'

const BLK: KnowledgeRef = { scheme: 'siyuan', kind: 'block', id: 'row-42' }

async function makeNode(
  id: string,
  markdown: string,
  attrs: Array<{ key: string; value: string }> = [],
): Promise<KnowledgeNode> {
  const contentHash = await hashKnowledgeContent(markdown)
  return {
    ref: { scheme: 'siyuan', kind: 'block', id },
    title: 'Row',
    markdown,
    path: `/Row/${id}`,
    attributes: attrs,
    createdAt: 1,
    updatedAt: 1,
    contentHash,
  }
}

describe('P6 fundamental fixes', () => {
  const tmpDirs: string[] = []
  afterEach(() => {
    stopAllKnowledgeWatches()
    clearKnowledgeBridgeRegistry()
    for (const d of tmpDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  it('nested attribute.name condition matches KnowledgeAttributeChanged shape', () => {
    const conditions: AutomationCondition[] = [
      { condition: 'state', field: 'attribute.name', value: 'workflow_status' },
      { condition: 'state', field: 'newValue', value: 'needs-research' },
    ]
    const payload = {
      attribute: { name: 'workflow_status', type: 'text' },
      attributeName: 'workflow_status',
      oldValue: 'open',
      newValue: 'needs-research',
      ref: BLK,
    }
    expect(evaluateConditions(conditions, { payload })).toBe(true)
  })

  it('cloud completion emits CloudRunCompleted via emitWorkspaceEvent', async () => {
    const emitted: Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }> =
      []
    const deps = {
      sessionManager: {
        emitWorkspaceEvent: async (
          workspaceId: string,
          event: string,
          payload: Record<string, unknown>,
        ) => {
          emitted.push({ workspaceId, event, payload })
        },
      },
    } as unknown as HandlerDeps

    await emitCloudRunCompletedForTest(deps, {
      runId: 'run-99',
      workspaceId: 'ws-1',
      state: 'done',
      labels: ['knowledge-triggered'],
      callbackTag: 'row-42',
      skillSlug: 'deep-research',
      topic: 'research topic',
      sessionId: 'sess-1',
    })

    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.event).toBe('CloudRunCompleted')
    expect(emitted[0]!.workspaceId).toBe('ws-1')
    expect(emitted[0]!.payload).toMatchObject({
      runId: 'run-99',
      state: 'done',
      labels: ['knowledge-triggered'],
      callbackTag: 'row-42',
      skillSlug: 'deep-research',
    })
  })

  it('bridge registry returns same instance after automation registration', () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-bridge-reg-'))
    tmpDirs.push(root)
    const bridge = new KnowledgeBridgeService({
      providerResolver: async () => {
        throw new Error('unused')
      },
      proposalsStore: new KnowledgeMutationProposalsStore(root),
      audit: new KnowledgeAuditLog(root),
      workspaceId: 'ws-1',
    })
    registerKnowledgeBridge(root, bridge)
    expect(getKnowledgeBridge(root)).toBe(bridge)
    // Mimic bridgeFor preference: getKnowledgeBridge first
    const existing = getKnowledgeBridge(root)
    expect(existing).toBe(bridge)
  })

  it('reference scenario: AttributeChanged → set_attribute propose → noteWrite → watcher suppress', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-ref-scenario-'))
    tmpDirs.push(root)

    const n1 = await makeNode('row-42', 'body', [
      { key: 'workflow_status', value: 'needs-research' },
    ])
    const provider = new InMemoryKnowledgeProvider({
      connectionId: 'c1',
      seed: { nodes: [n1] },
    })
    const loopGuard = new AutomationLoopGuard({ ttlMs: 120_000 })
    const bridge = new KnowledgeBridgeService({
      providerResolver: async () => provider,
      proposalsStore: new KnowledgeMutationProposalsStore(root),
      audit: new KnowledgeAuditLog(root),
      workspaceId: 'ws-1',
    })
    registerKnowledgeBridge(root, bridge)

    const executor = new ServerKnowledgeActionExecutor({
      getBridge: () => bridge,
      loopGuard,
      resolveConnectionId: () => 'c1',
    })

    // Matcher condition would match attribute.name + newValue
    const conditions: AutomationCondition[] = [
      { condition: 'state', field: 'attribute.name', value: 'workflow_status' },
      { condition: 'state', field: 'newValue', value: 'needs-research' },
    ]
    const eventPayload = {
      workspaceId: 'ws-1',
      connectionId: 'c1',
      timestamp: Date.now(),
      ref: BLK,
      attribute: { name: 'workflow_status', type: 'text' },
      attributeName: 'workflow_status',
      oldValue: 'open',
      newValue: 'needs-research',
    }
    expect(evaluateConditions(conditions, { payload: eventPayload })).toBe(true)

    const action: KnowledgeAutomationAction = {
      type: 'knowledge',
      op: 'set_attribute',
      targetRef: BLK,
      name: 'workflow_status',
      value: 'researching',
    }
    const ctx: KnowledgeActionExecuteContext = {
      event: 'KnowledgeAttributeChanged',
      payload: eventPayload,
      matcherId: 'auto-needs-research',
      automationName: 'needs-research → researching',
      workspaceId: 'ws-1',
      workspaceRootPath: root,
      env: {},
    }
    const result = await executor.execute(action, ctx)
    expect(result.ok).toBe(true)
    expect(result.proposalId).toBeDefined()

    // noteWrite already called by executor — watcher tick must not re-emit
    const events: Array<{ event: KnowledgeWatchEvent; payload: KnowledgeWatchPayload }> = []

    // Seed baseline with old attrs, then flip to researching and expect suppress
    const nOpen = await makeNode('row-42', 'body', [{ key: 'workflow_status', value: 'open' }])
    const pOpen = new InMemoryKnowledgeProvider({ connectionId: 'c1', seed: { nodes: [nOpen] } })
    const wSeed = new KnowledgeChangeWatcher({
      connectionId: 'c1',
      workspaceId: 'ws-1',
      workspaceRoot: root,
      getProvider: async () => pOpen,
      onEvent: () => {},
      loopGuard,
      setIntervalFn: (() => 0) as unknown as typeof setInterval,
      clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
      silentSeed: true,
    })
    await wSeed.tick()

    const nResearching = await makeNode('row-42', 'body', [
      { key: 'workflow_status', value: 'researching' },
    ])
    const pResearching = new InMemoryKnowledgeProvider({
      connectionId: 'c1',
      seed: { nodes: [nResearching] },
    })
    const w2 = new KnowledgeChangeWatcher({
      connectionId: 'c1',
      workspaceId: 'ws-1',
      workspaceRoot: root,
      getProvider: async () => pResearching,
      onEvent: (e, p) => {
        events.push({ event: e, payload: p })
      },
      loopGuard,
      setIntervalFn: (() => 0) as unknown as typeof setInterval,
      clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
      silentSeed: false,
    })
    await w2.tick()

    const attrEvents = events.filter((e) => e.event === 'KnowledgeAttributeChanged')
    expect(attrEvents).toEqual([])
    // Same bridge still registered
    expect(getKnowledgeBridge(root)).toBe(bridge)
    wSeed.stop()
    w2.stop()
  })
})
