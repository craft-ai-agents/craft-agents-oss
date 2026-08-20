/**
 * P5 views: domain defaults, knowledge defaults merge, knowledge context + expression eval.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getDefaultKnowledgeViews, getDefaultViews } from '../defaults.ts'
import {
  buildKnowledgeViewContext,
  compileView,
  evaluateView,
  evaluateViews,
  buildViewContext,
} from '../evaluator.ts'
import {
  ensureKnowledgeDefaults,
  listViews,
  loadViewsConfig,
  saveViewsConfig,
  type ViewsConfig,
} from '../storage.ts'

describe('getDefaultViews (sessions)', () => {
  it('still seeds the four classic session view ids', () => {
    const ids = getDefaultViews().map((v) => v.id)
    expect(ids).toEqual(['view-new', 'view-plan', 'view-explore', 'view-processing'])
    for (const v of getDefaultViews()) {
      expect(v.domain === undefined || v.domain === 'sessions').toBe(true)
    }
  })
})

describe('getDefaultKnowledgeViews', () => {
  it('includes research-needs-review with structural filter', () => {
    const views = getDefaultKnowledgeViews()
    const research = views.find((v) => v.id === 'research-needs-review')
    expect(research).toBeDefined()
    expect(research!.domain).toBe('knowledge')
    expect(research!.knowledgeFilter?.pathPrefix).toBe('/Research')
    expect(research!.knowledgeFilter?.attributes).toEqual({
      'knowledge-workflow_status': 'needs-review',
    })
    expect(research!.groupBy).toBe('topic')
    expect(research!.sort).toEqual([{ field: 'updated_at', direction: 'desc' }])
    expect(research!.presetActions).toContainEqual({
      type: 'set_attribute',
      name: 'knowledge-workflow_status',
      value: 'approved',
    })
  })
})

describe('loadViewsConfig v2 merge', () => {
  it('seeds session + knowledge defaults on empty workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'views-p5-empty-'))
    try {
      const config = loadViewsConfig(root)
      expect(config.version).toBe(2)
      const ids = config.views.map((v) => v.id)
      expect(ids).toContain('view-new')
      expect(ids).toContain('view-plan')
      expect(ids).toContain('view-explore')
      expect(ids).toContain('view-processing')
      expect(ids).toContain('research-needs-review')
      const disk = JSON.parse(readFileSync(join(root, 'views.json'), 'utf8')) as ViewsConfig
      expect(disk.version).toBe(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('merges missing knowledge defaults into v1 session-only config without overwrite', () => {
    const root = mkdtempSync(join(tmpdir(), 'views-p5-v1-'))
    try {
      const v1: ViewsConfig = {
        version: 1,
        views: [
          {
            id: 'view-new',
            name: 'Custom New',
            expression: 'hasUnread == true',
          },
          {
            id: 'research-needs-review',
            name: 'User edited research view',
            domain: 'knowledge',
            expression: 'true',
            knowledgeFilter: { pathPrefix: '/Custom' },
          },
        ],
      }
      writeFileSync(join(root, 'views.json'), JSON.stringify(v1, null, 2), 'utf-8')
      const config = loadViewsConfig(root)
      expect(config.version).toBe(2)
      const customNew = config.views.find((v) => v.id === 'view-new')
      expect(customNew?.name).toBe('Custom New')
      // domain backfilled for v1 session views
      expect(customNew?.domain).toBe('sessions')
      // user knowledge view not overwritten
      const research = config.views.find((v) => v.id === 'research-needs-review')
      expect(research?.name).toBe('User edited research view')
      expect(research?.knowledgeFilter?.pathPrefix).toBe('/Custom')
      // other knowledge defaults still merged
      expect(config.views.some((v) => v.id === 'recently-updated')).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('listViews filters by domain', () => {
    const root = mkdtempSync(join(tmpdir(), 'views-p5-list-'))
    try {
      loadViewsConfig(root)
      const sessions = listViews(root, 'sessions')
      const knowledge = listViews(root, 'knowledge')
      expect(sessions.every((v) => (v.domain ?? 'sessions') === 'sessions')).toBe(true)
      expect(knowledge.every((v) => v.domain === 'knowledge')).toBe(true)
      expect(sessions.map((v) => v.id)).toEqual(
        expect.arrayContaining(['view-new', 'view-plan', 'view-explore', 'view-processing']),
      )
      expect(knowledge.map((v) => v.id)).toContain('research-needs-review')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ensureKnowledgeDefaults is idempotent and never duplicates ids', () => {
    const once = ensureKnowledgeDefaults({ version: 1, views: getDefaultViews() })
    const twice = ensureKnowledgeDefaults(once)
    const ids = twice.views.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(twice.version).toBe(2)
  })

  it('saveViewsConfig always writes version 2', () => {
    const root = mkdtempSync(join(tmpdir(), 'views-p5-save-'))
    try {
      saveViewsConfig(root, { version: 1, views: getDefaultViews() })
      const disk = JSON.parse(readFileSync(join(root, 'views.json'), 'utf8')) as ViewsConfig
      expect(disk.version).toBe(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('buildKnowledgeViewContext + evaluate', () => {
  it('maps attributes.topic and envelope fields', () => {
    const ctx = buildKnowledgeViewContext(
      {
        title: 'Hit title',
        notebookPath: 'Research',
        updatedAt: 100,
        ref: { kind: 'document', id: 'd1' },
      },
      {
        title: 'Node title',
        path: '/Research/Reports/A',
        updatedAt: 200,
        ref: { kind: 'document' },
        attributes: [
          { key: 'workflow_status', value: 'needs-review' },
          { key: 'topic', value: 'siyuan' },
        ],
      },
      { status: 'in-progress', labels: ['hot'], flagged: true, archived: false },
    )
    expect(ctx.title).toBe('Node title')
    expect(ctx.notebook).toBe('Research')
    expect(ctx.path).toBe('/Research/Reports/A')
    expect(ctx.kind).toBe('document')
    expect(ctx.updatedAt).toBe(200)
    expect(ctx.attributes.workflow_status).toBe('needs-review')
    expect(ctx.topic).toBe('siyuan')
    expect(ctx.status).toBe('in-progress')
    expect(ctx.labels).toEqual(['hot'])
    expect(ctx.flagged).toBe(true)
    expect(ctx.archived).toBe(false)
  })

  it('evaluates knowledge expression on attributes via dot access', () => {
    const compiled = compileView({
      id: 't',
      name: 't',
      domain: 'knowledge',
      expression: 'attributes.workflow_status == "needs-review" and topic == "siyuan"',
    })
    expect(compiled).not.toBeNull()
    const ctx = buildKnowledgeViewContext(
      { title: 'x', updatedAt: 1, ref: { kind: 'document', id: '1' } },
      {
        attributes: {
          workflow_status: 'needs-review',
          topic: 'siyuan',
        },
      },
    )
    expect(evaluateView(ctx, compiled!)).toBe(true)
    const noMatch = buildKnowledgeViewContext(
      { title: 'x', updatedAt: 1 },
      { attributes: { workflow_status: 'approved', topic: 'siyuan' } },
    )
    expect(evaluateView(noMatch, compiled!)).toBe(false)
  })

  it('session buildViewContext + evaluateViews still work after generalization', () => {
    const compiled = compileView({
      id: 'view-new',
      name: 'New',
      expression: 'hasUnread == true',
    })!
    const ctx = buildViewContext({ hasUnread: true, name: 's' })
    expect(evaluateViews(ctx, [compiled]).map((v) => v.id)).toEqual(['view-new'])
    expect(evaluateViews(buildViewContext({ hasUnread: false }), [compiled])).toEqual([])
  })
})

describe('ensureKnowledgeDefaults stock migration', () => {
  it('rewrites bare workflow_status on research-needs-review to knowledge-workflow_status', () => {
    const migrated = ensureKnowledgeDefaults({
      version: 2,
      views: [
        {
          id: 'research-needs-review',
          name: 'Research needs review',
          domain: 'knowledge',
          expression: 'true',
          knowledgeFilter: {
            pathPrefix: '/Research',
            attributes: { workflow_status: 'needs-review' },
          },
          presetActions: [{ type: 'set_attribute', name: 'workflow_status', value: 'approved' }],
        },
      ],
    })
    const research = migrated.views.find((v) => v.id === 'research-needs-review')!
    expect(research.knowledgeFilter?.attributes).toEqual({
      'knowledge-workflow_status': 'needs-review',
    })
    expect(research.presetActions?.[0]).toMatchObject({
      type: 'set_attribute',
      name: 'knowledge-workflow_status',
      value: 'approved',
    })
  })
})
