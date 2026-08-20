/**
 * knowledge-home.test.ts — W2 KnowledgeHome search + P5 saved-views logic.
 *
 * Renderer tests in this app are logic-level `bun:test` (no DOM harness), so
 * the component's search/routing/view behavior is exercised through the
 * exported helpers with a mocked `window.electronAPI.knowledge`.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { SearchHit } from '@craft-agent/core/knowledge'
import type { ViewConfig as KnowledgeViewConfig } from '@craft-agent/shared/views'
import {
  firstSetAttributeAction,
  groupKeyForHit,
  groupViewHits,
  knowledgeViewRoute,
  listKnowledgeViews,
  resolveKnowledgeApi,
  resolveKnowledgeViewsApi,
  runKnowledgeView,
  searchHitRoute,
  searchKnowledge,
  selectKnowledgeView,
  setViewAttribute,
  type KnowledgeSearchApi,
  type KnowledgeViewsApi,
} from '../KnowledgeHome'

const savedWindow = globalThis.window

function makeHit(
  kind: SearchHit['ref']['kind'],
  id: string,
  extras: Partial<SearchHit & { attributes?: Record<string, string>; topic?: string }> = {},
): SearchHit & { attributes?: Record<string, string>; topic?: string } {
  return {
    ref: { scheme: 'siyuan', kind, id },
    title: `Hit ${id}`,
    snippet: 'plain text context',
    notebookPath: '/Research/TopicA',
    updatedAt: 1725148800000,
    ...extras,
  }
}

function makeView(partial: Partial<KnowledgeViewConfig> & { id: string; name: string }): KnowledgeViewConfig {
  return {
    expression: 'true',
    domain: 'knowledge',
    ...partial,
  }
}

function installKnowledgeApi(api: Partial<KnowledgeSearchApi & KnowledgeViewsApi>) {
  globalThis.window = { electronAPI: { knowledge: api } } as unknown as Window &
    typeof globalThis
}

afterEach(() => {
  globalThis.window = savedWindow
})

describe('searchKnowledge', () => {
  it('searches the first connection and maps hits to siYuan routes (happy path)', async () => {
    const searchCalls: unknown[] = []
    const api: KnowledgeSearchApi = {
      listConnections: async () => [{ id: 'conn-1' }, { id: 'conn-2' }],
      search: async (args) => {
        searchCalls.push(args)
        return { items: [makeHit('document', 'doc-1'), makeHit('block', 'blk-2')] }
      },
    }
    installKnowledgeApi(api)

    const resolved = resolveKnowledgeApi()
    expect(resolved).not.toBeNull()

    const items = await searchKnowledge(resolved, 'ws-42', 'craft agents')
    expect(searchCalls).toEqual([
      { workspaceId: 'ws-42', connectionId: 'conn-1', input: { query: 'craft agents' } },
    ])
    expect(items).toHaveLength(2)
    expect(searchHitRoute(items![0])).toBe('knowledge/document/doc-1')
    expect(searchHitRoute(items![1])).toBe('knowledge/block/blk-2')
  })

  it('returns null and never searches when no connections exist (empty state)', async () => {
    const search = mock(async () => ({ items: [] }))
    const api: KnowledgeSearchApi = {
      listConnections: async () => [],
      search,
    }
    installKnowledgeApi(api)

    const items = await searchKnowledge(resolveKnowledgeApi(), 'ws-42', 'anything')
    expect(items).toBeNull()
    expect(search).not.toHaveBeenCalled()
  })

  it('returns null when the preload knowledge surface is absent', async () => {
    globalThis.window = { electronAPI: {} } as unknown as Window & typeof globalThis
    expect(resolveKnowledgeApi()).toBeNull()
    expect(await searchKnowledge(resolveKnowledgeApi(), 'ws-42', 'q')).toBeNull()
  })

  it('URI-encodes ids so deep-link ids with separators stay a single route segment', () => {
    expect(searchHitRoute(makeHit('document', '20200812/abc def'))).toBe(
      'knowledge/document/20200812%2Fabc%20def',
    )
  })
})

describe('knowledge saved views (P5)', () => {
  const researchView = makeView({
    id: 'research-needs-review',
    name: 'Research needs review',
    knowledgeFilter: {
      pathPrefix: '/Research',
      attributes: { 'knowledge-workflow_status': 'needs-review' },
    },
    groupBy: 'topic',
    sort: [{ field: 'updated_at', direction: 'desc' }],
    presetActions: [{ type: 'set_attribute', name: 'knowledge-workflow_status', value: 'approved' }],
  })

  const recentView = makeView({
    id: 'recent-docs',
    name: 'Recently updated',
    domain: 'knowledge',
  })

  it('builds knowledge/view/{id} deep-link routes', () => {
    expect(knowledgeViewRoute('research-needs-review')).toBe(
      'knowledge/view/research-needs-review',
    )
    expect(knowledgeViewRoute('a/b')).toBe('knowledge/view/a%2Fb')
  })

  it('selectKnowledgeView finds by id and returns null for misses', () => {
    const views = [researchView, recentView]
    expect(selectKnowledgeView(views, 'research-needs-review')?.name).toBe(
      'Research needs review',
    )
    expect(selectKnowledgeView(views, 'missing')).toBeNull()
    expect(selectKnowledgeView(views, null)).toBeNull()
  })

  it('listKnowledgeViews filters to domain knowledge and ignores sessions', async () => {
    const api: KnowledgeViewsApi = {
      listConnections: async () => [{ id: 'c1' }],
      viewsList: async () => [
        researchView,
        makeView({ id: 'view-new', name: 'New', domain: 'sessions', expression: 'true' }),
        recentView,
      ],
      viewRun: async () => ({ items: [], view: researchView }),
      viewSetAttribute: async () => ({ proposalId: 'p1' }),
    }
    installKnowledgeApi(api)
    const list = await listKnowledgeViews(resolveKnowledgeViewsApi())
    expect(list?.map((v) => v.id)).toEqual(['research-needs-review', 'recent-docs'])
  })

  it('resolveKnowledgeViewsApi is null when viewsList is missing', () => {
    installKnowledgeApi({
      listConnections: async () => [],
      search: async () => ({ items: [] }),
    } as KnowledgeSearchApi)
    expect(resolveKnowledgeViewsApi()).toBeNull()
  })

  it('runKnowledgeView uses the first connection and returns items+view', async () => {
    const runCalls: unknown[] = []
    const api: KnowledgeViewsApi = {
      listConnections: async () => [{ id: 'conn-a' }, { id: 'conn-b' }],
      viewsList: async () => [researchView],
      viewRun: async (args) => {
        runCalls.push(args)
        return {
          items: [makeHit('document', 'doc-r1')],
          view: researchView,
        }
      },
      viewSetAttribute: async () => ({ proposalId: 'p-x' }),
    }
    installKnowledgeApi(api)
    const result = await runKnowledgeView(resolveKnowledgeViewsApi(), 'research-needs-review', 'ws-1')
    expect(runCalls).toEqual([
      { connectionId: 'conn-a', viewId: 'research-needs-review', workspaceId: 'ws-1' },
    ])
    expect(result?.connectionId).toBe('conn-a')
    expect(result?.items).toHaveLength(1)
    expect(result?.view.id).toBe('research-needs-review')
  })

  it('runKnowledgeView returns null with zero connections', async () => {
    const viewRun = mock(async () => ({ items: [], view: researchView }))
    const api: KnowledgeViewsApi = {
      listConnections: async () => [],
      viewsList: async () => [],
      viewRun,
      viewSetAttribute: async () => ({ proposalId: 'p' }),
    }
    installKnowledgeApi(api)
    expect(await runKnowledgeView(resolveKnowledgeViewsApi(), 'x')).toBeNull()
    expect(viewRun).not.toHaveBeenCalled()
  })

  it('setViewAttribute forwards to viewSetAttribute and returns proposalId', async () => {
    const calls: unknown[] = []
    const api: KnowledgeViewsApi = {
      listConnections: async () => [{ id: 'c1' }],
      viewsList: async () => [],
      viewRun: async () => ({ items: [], view: researchView }),
      viewSetAttribute: async (args) => {
        calls.push(args)
        return { proposalId: 'prop-99' }
      },
    }
    installKnowledgeApi(api)
    const hit = makeHit('document', 'doc-1')
    const result = await setViewAttribute(resolveKnowledgeViewsApi(), {
      connectionId: 'c1',
      ref: hit.ref,
      name: 'knowledge-workflow_status',
      value: 'approved',
    })
    expect(result).toEqual({ proposalId: 'prop-99' })
    expect(calls).toEqual([
      {
        connectionId: 'c1',
        ref: hit.ref,
        name: 'knowledge-workflow_status',
        value: 'approved',
      },
    ])
  })

  it('firstSetAttributeAction reads presetActions', () => {
    expect(firstSetAttributeAction(researchView)).toEqual({
      name: 'knowledge-workflow_status',
      value: 'approved',
    })
    expect(firstSetAttributeAction(recentView)).toBeNull()
    expect(firstSetAttributeAction(null)).toBeNull()
  })

  it('groupViewHits buckets by notebook path leaf when groupBy is set', () => {
    const items = [
      makeHit('document', 'a', { notebookPath: '/Research/Alpha' }),
      makeHit('document', 'b', { notebookPath: '/Research/Beta' }),
      makeHit('document', 'c', { notebookPath: '/Research/Alpha' }),
      makeHit('document', 'd', { notebookPath: '' }),
    ]
    const groups = groupViewHits(items, 'topic')
    expect(groups.map((g) => g.key).sort()).toEqual(['Alpha', 'Beta', 'ungrouped'])
    expect(groups.find((g) => g.key === 'Alpha')?.items.map((h) => h.ref.id)).toEqual(['a', 'c'])
    expect(groupKeyForHit(items[0]!, 'notebook')).toBe('Research')
    // No groupBy → single flat group
    expect(groupViewHits(items, undefined)).toEqual([{ key: '', items }])
  })

  it('groupKeyForHit topic prefers attributes.topic when present', () => {
    const hit = makeHit('document', 'x', {
      notebookPath: '/Research/LeafName',
      attributes: { topic: 'siyuan-integration' },
    })
    expect(groupKeyForHit(hit, 'topic')).toBe('siyuan-integration')
    expect(groupKeyForHit({ ...hit, topic: 'explicit' }, 'topic')).toBe('explicit')
    expect(
      groupKeyForHit(
        makeHit('document', 'y', {
          notebookPath: '/Research/LeafName',
          attributes: { 'knowledge-workflow_status': 'needs-review' },
        }),
        'status',
      ),
    ).toBe('needs-review')
  })
})
