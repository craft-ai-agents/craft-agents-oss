import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { BulkUpdateSessionsInput, BulkUpdateSessionsResult } from '@craft-agent/shared/protocol/dto'
import type { HandlerDeps } from '../handler-deps'
import { registerSessionsHandlers } from './sessions'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'

type PushedEvent = { channel: string; target: unknown; args: unknown[] }
type BulkCall = {
  workspaceId: string
  input: Pick<BulkUpdateSessionsInput, 'ids' | 'patch'>
}

function createHarness(
  outcome: BulkUpdateSessionsResult = { ok: ['a', 'b'], failed: [] },
) {
  const handlers = new Map<string, HandlerFn>()
  const pushed: PushedEvent[] = []
  const calls: BulkCall[] = []
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push(channel, target, ...args) {
      pushed.push({ channel, target, args })
    },
    async invokeClient() {},
    hasClientCapability() {
      return false
    },
    findClientsWithCapability() {
      return []
    },
  }
  const sessionManager = {
    async waitForInit() {},
    async bulkUpdateSessions(
      workspaceId: string,
      input: Pick<BulkUpdateSessionsInput, 'ids' | 'patch'>,
    ) {
      calls.push({ workspaceId, input })
      return outcome
    },
  }

  registerSessionsHandlers(
    server,
    {
      sessionManager,
      platform: { logger: { error() {}, warn() {}, info() {}, debug() {} } },
    } as unknown as HandlerDeps,
  )

  return {
    calls,
    pushed,
    async bulk(
      input: BulkUpdateSessionsInput,
      contextWorkspaceId: string | null = 'workspace-1',
    ): Promise<BulkUpdateSessionsResult> {
      const handler = handlers.get(RPC_CHANNELS.sessions.BULK_UPDATE)
      if (!handler) throw new Error('bulk handler was not registered')
      const context = { workspaceId: contextWorkspaceId } as RequestContext
      return handler(context, input) as Promise<BulkUpdateSessionsResult>
    },
  }
}

describe('sessions:bulkUpdate RPC', () => {
  it('delegates once and emits one coalesced event for successful IDs only', async () => {
    const harness = createHarness({
      ok: ['a'],
      failed: [{ id: 'b', error: 'busy' }],
    })
    const input: BulkUpdateSessionsInput = {
      workspaceId: 'workspace-1',
      ids: ['a', 'b'],
      patch: { addLabels: ['added'], priority: 'high' },
    }

    const result = await harness.bulk(input)

    expect(result).toEqual({
      ok: ['a'],
      failed: [{ id: 'b', error: 'busy' }],
    })
    expect(harness.calls).toEqual([
      {
        workspaceId: 'workspace-1',
        input: { ids: ['a', 'b'], patch: input.patch },
      },
    ])
    expect(harness.pushed).toEqual([
      {
        channel: RPC_CHANNELS.sessions.BULK_CHANGED,
        target: { to: 'workspace', workspaceId: 'workspace-1' },
        args: [
          {
            workspaceId: 'workspace-1',
            ids: ['a'],
            patch: input.patch,
          },
        ],
      },
    ])
  })

  it('does not broadcast when no target succeeded', async () => {
    const harness = createHarness({
      ok: [],
      failed: [{ id: 'a', error: 'busy' }],
    })

    await harness.bulk({
      workspaceId: 'workspace-1',
      ids: ['a'],
      patch: { isArchived: true },
    })

    expect(harness.pushed).toEqual([])
  })

  it('requires a transport-bound workspace and rejects input mismatch', async () => {
    const missingContext = createHarness()
    await expect(
      missingContext.bulk(
        { workspaceId: 'workspace-1', ids: ['a'], patch: { isFlagged: true } },
        null,
      ),
    ).rejects.toThrow('bulk_workspace_context_required')
    expect(missingContext.calls).toEqual([])

    const mismatch = createHarness()
    await expect(
      mismatch.bulk(
        { workspaceId: 'workspace-2', ids: ['a'], patch: { isFlagged: true } },
        'workspace-1',
      ),
    ).rejects.toThrow('bulk_workspace_mismatch')
    expect(mismatch.calls).toEqual([])
  })

  it('validates conflicts and limits before manager mutation', async () => {
    const harness = createHarness()
    await expect(
      harness.bulk({
        workspaceId: 'workspace-1',
        ids: ['a'],
        patch: { labels: ['replace'], addLabels: ['added'] },
      }),
    ).rejects.toThrow('bulk_labels_conflict')
    await expect(
      harness.bulk({
        workspaceId: 'workspace-1',
        ids: Array.from({ length: 201 }, (_value, index) => `s${index}`),
        patch: { priority: 'low' },
      }),
    ).rejects.toThrow('bulk_limit')
    expect(harness.calls).toEqual([])
    expect(harness.pushed).toEqual([])
  })
})
