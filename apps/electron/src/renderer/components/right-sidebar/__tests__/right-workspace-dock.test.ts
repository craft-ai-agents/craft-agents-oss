import { describe, expect, it } from 'bun:test'

import type { SessionFile } from '../../../../shared/types'
import { collectSessionArtifacts } from '../SessionArtifactsSection'
import { analyzeDeliverableWorkflow } from '../deliverable-workflow-state'
import { normalizeRightDockTabs } from '../right-workspace-dock-state'

describe('right workspace dock', () => {
  it('migrates unsupported persisted tabs and falls back to the business workflow tabs', () => {
    expect(normalizeRightDockTabs([])).toEqual([
      { id: 'brief', type: 'brief' },
      { id: 'artifacts', type: 'artifacts' },
    ])
    expect(normalizeRightDockTabs([
      { id: 'files', type: 'files' },
      { id: 'browser-1', type: 'browser' as never },
    ])).toEqual([
      { id: 'files', type: 'files' },
    ])
  })

  it('collects business artifacts recursively and excludes implementation files', () => {
    const tree: SessionFile[] = [
      {
        name: 'outputs',
        path: '/session/outputs',
        type: 'directory',
        children: [
          { name: 'report.md', path: '/session/outputs/report.md', type: 'file', size: 10 },
          { name: 'portrait.png', path: '/session/outputs/portrait.png', type: 'file', size: 20 },
          { name: '需求确认单.md', path: '/session/outputs/需求确认单.md', type: 'file', size: 30 },
          { name: '材料完整性检查.md', path: '/session/outputs/材料完整性检查.md', type: 'file', size: 40 },
        ],
      },
      {
        name: 'attachments',
        path: '/session/attachments',
        type: 'directory',
        children: [{ name: 'source.pdf', path: '/session/attachments/source.pdf', type: 'file', size: 40 }],
      },
      { name: 'worker.ts', path: '/session/worker.ts', type: 'file', size: 30 },
    ]

    expect(collectSessionArtifacts(tree).map(file => file.name)).toEqual(['report.md', 'portrait.png'])
  })

  it('derives workflow completion only from real session evidence', () => {
    const tree: SessionFile[] = [
      {
        name: 'data', path: '/session/data', type: 'directory', children: [
          { name: 'deliverable-brief.md', path: '/session/data/deliverable-brief.md', type: 'file' },
          { name: 'report.pdf', path: '/session/data/report.pdf', type: 'file', size: 100 },
        ],
      },
    ]
    const state = analyzeDeliverableWorkflow([
      {
        id: 'm1', role: 'user', content: 'Create a report', timestamp: 1,
        attachments: [{ id: 'a1', type: 'pdf', name: 'source.pdf', mimeType: 'application/pdf', size: 10, storedPath: '/source.pdf' }],
      },
    ], tree, {
      schemaVersion: 2,
      status: 'final',
      skills: ['documents', 'pdf'],
      skillRouting: { status: 'matched' },
      materials: { status: 'complete', missing: [] },
      brief: { confirmed: true, confirmedAt: '2026-08-28T08:00:00.000Z' },
      deliverables: [{ name: 'report.pdf', path: '/session/data/report.pdf', status: 'final', version: 1 }],
      validation: { passed: true, checkedAt: '2026-08-28T08:01:00.000Z', criteria: [{ name: 'Complete report', passed: true, evidence: 'Opened PDF' }] },
      approval: { approved: true, approvedAt: '2026-08-28T08:02:00.000Z' },
    })

    expect(state).toEqual({
      hasConversation: true,
      hasSkillSelection: true,
      materialCount: 1,
      materialsReady: true,
      hasBrief: true,
      briefConfirmed: true,
      deliverableCount: 1,
      hasValidation: true,
      acceptanceCriteriaPassed: true,
      hasApproval: true,
      isFinal: true,
      blockers: [],
    })

    expect(analyzeDeliverableWorkflow([], tree, {
      schemaVersion: 2,
      status: 'final',
      skills: ['documents'],
      skillRouting: { status: 'matched' },
      materials: { status: 'waived' },
      brief: { confirmed: true, confirmedAt: '2026-08-28T08:00:00.000Z' },
      deliverables: [{ name: 'report.pdf', path: '/session/data/report.pdf', status: 'final', version: 1 }],
      validation: { passed: false, checkedAt: '2026-08-28T08:01:00.000Z', criteria: [{ name: 'Complete report', passed: false }] },
      approval: { approved: true, approvedAt: '2026-08-28T08:02:00.000Z' },
    }).isFinal).toBe(false)
  })

  it('rejects unsupported completion claims and missing artifact versions', () => {
    const tree: SessionFile[] = [{
      name: 'data', path: '/session/data', type: 'directory', children: [
        { name: 'deliverable-brief.md', path: '/session/data/deliverable-brief.md', type: 'file' },
        { name: 'actual.pdf', path: '/session/data/actual.pdf', type: 'file', size: 100 },
      ],
    }]
    const baseline = {
      schemaVersion: 2,
      status: 'final',
      skills: ['pdf'],
      skillRouting: { status: 'matched' },
      materials: { status: 'complete' },
      brief: { confirmed: true, confirmedAt: '2026-08-28T08:00:00.000Z' },
      validation: { passed: true, checkedAt: '2026-08-28T08:01:00.000Z', criteria: [{ name: 'Opens', passed: true, evidence: 'Parsed successfully' }] },
      approval: { approved: true, approvedAt: '2026-08-28T08:02:00.000Z' },
    }

    expect(analyzeDeliverableWorkflow([], tree, {
      ...baseline,
      deliverables: [{ name: 'missing.pdf', path: '/session/data/missing.pdf', status: 'final', version: 1 }],
    }).isFinal).toBe(false)
    expect(analyzeDeliverableWorkflow([], tree, {
      ...baseline,
      deliverables: [{ name: 'actual.pdf', path: '/session/data/actual.pdf', status: 'final' }],
    }).isFinal).toBe(false)
    expect(analyzeDeliverableWorkflow([], tree, {
      ...baseline,
      approval: { approved: false },
      deliverables: [{ name: 'actual.pdf', path: '/session/data/actual.pdf', status: 'final', version: 1 }],
    }).blockers).toContain('approval')
  })

  it('requires non-empty files, dated checks, and criterion evidence', () => {
    const tree: SessionFile[] = [{
      name: 'data', path: '/session/data', type: 'directory', children: [
        { name: 'deliverable-brief.md', path: '/session/data/deliverable-brief.md', type: 'file', size: 10 },
        { name: 'empty.pdf', path: '/session/data/empty.pdf', type: 'file', size: 0 },
      ],
    }]
    const state = analyzeDeliverableWorkflow([], tree, {
      schemaVersion: 2,
      status: 'final',
      skills: ['pdf'],
      skillRouting: { status: 'matched' },
      materials: { status: 'complete', missing: [] },
      brief: { confirmed: true },
      deliverables: [{ name: 'empty.pdf', path: '/session/data/empty.pdf', status: 'final', version: 1 }],
      validation: { passed: true, criteria: [{ name: 'Opens', passed: true }] },
      approval: { approved: true },
    })

    expect(state.isFinal).toBe(false)
    expect(state.briefConfirmed).toBe(false)
    expect(state.hasValidation).toBe(false)
    expect(state.acceptanceCriteriaPassed).toBe(false)
    expect(state.hasApproval).toBe(false)
  })

  it('allows an explicit built-in fallback without pretending a skill ran', () => {
    const tree: SessionFile[] = [{
      name: 'data', path: '/session/data', type: 'directory', children: [
        { name: 'deliverable-brief.md', path: '/session/data/deliverable-brief.md', type: 'file', size: 10 },
        { name: 'result.md', path: '/session/data/result.md', type: 'file', size: 100 },
      ],
    }]
    const state = analyzeDeliverableWorkflow([], tree, {
      schemaVersion: 2,
      status: 'final',
      skillRouting: { status: 'builtin_fallback', reason: 'No matching artifact skill is installed.' },
      skills: [],
      materials: { status: 'waived' },
      brief: { confirmed: true, confirmedAt: '2026-08-28T08:00:00.000Z' },
      deliverables: [{ name: 'result.md', path: '/session/data/result.md', status: 'final', version: 1 }],
      validation: { passed: true, checkedAt: '2026-08-28T08:01:00.000Z', criteria: [{ name: 'Complete', passed: true, evidence: 'Opened Markdown file' }] },
      approval: { approved: true, approvedAt: '2026-08-28T08:02:00.000Z' },
    })

    expect(state.hasSkillSelection).toBe(true)
    expect(state.isFinal).toBe(true)
  })

  it('keeps provider-interrupted partial files in an incomplete workflow', () => {
    const tree: SessionFile[] = [{
      name: 'data', path: '/session/data', type: 'directory', children: [
        { name: 'deliverable-brief.md', path: '/session/data/deliverable-brief.md', type: 'file', size: 20 },
        { name: 'downstream-acceptance.md', path: '/session/data/downstream-acceptance.md', type: 'file', size: 100 },
      ],
    }]

    const state = analyzeDeliverableWorkflow([
      { id: 'm1', role: 'user', content: 'Generate the report', timestamp: 1 },
    ], tree, null)

    expect(state.deliverableCount).toBe(1)
    expect(state.isFinal).toBe(false)
    expect(state.blockers).toEqual(expect.arrayContaining([
      'skills', 'materials', 'briefConfirmation', 'deliverables', 'validation', 'approval',
    ]))
  })
})
