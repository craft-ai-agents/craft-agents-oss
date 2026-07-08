import { describe, it, expect } from 'bun:test'
import {
  buildSpec,
  specToSubtasks,
  canDependOn,
  quickAddNodeId,
  quickAddSessionId,
  quickAddChildToSubtask,
  MAX_REPAIR_ATTEMPTS_CAP,
  type EditorSubtask,
  type SpecNode,
} from '../task-spec-form'

const noConn = new Map<string, string>()

describe('task-spec-form round-trip', () => {
  it('preserves generated node ids so ${nodes.<id>.output} references survive generate → edit → create', () => {
    // A generated spec where one node references another by its (non-title-slug) id.
    const generated: SpecNode[] = [
      { id: 'research-conductor', title: 'Research', prompt: 'Survey the landscape.' },
      {
        id: 'design-and-implement-the-chip',
        title: 'Design & implement the chip',
        prompt: 'Build it using ${nodes.research-conductor.output}',
        depends_on: ['research-conductor'],
      },
    ]

    const subtasks = specToSubtasks(generated, 'fallback-model')
    const spec = buildSpec(
      { title: 'My task', goal: 'g', projectId: '', orchModel: '', subtasks },
      noConn,
    )

    const nodes = spec.nodes as Array<{ id: string; prompt: string; depends_on?: string[] }>
    const ids = nodes.map((n) => n.id)
    // The referenced id is preserved verbatim — NOT re-derived from the title slug ('research').
    expect(ids).toContain('research-conductor')
    const dependent = nodes.find((n) => n.id === 'design-and-implement-the-chip')!
    expect(dependent.prompt).toBe('Build it using ${nodes.research-conductor.output}')
    expect(dependent.depends_on).toEqual(['research-conductor'])
  })

  it('emits task-level sources/skills when picked and omits them when empty', () => {
    const subtasks = specToSubtasks([{ id: 'a', title: 'A', prompt: 'p' }], 'm')
    const picked = buildSpec(
      { title: 'T', goal: 'g', projectId: '', orchModel: '', subtasks, sourceSlugs: ['github'], skillSlugs: ['commit'] },
      noConn,
    )
    expect(picked.sources).toEqual(['github'])
    expect(picked.skills).toEqual(['commit'])

    const empty = buildSpec(
      { title: 'T', goal: 'g', projectId: '', orchModel: '', subtasks, sourceSlugs: [], skillSlugs: [] },
      noConn,
    )
    // Empty selections stay absent (not []) so sessions keep workspace defaults.
    expect('sources' in empty).toBe(false)
    expect('skills' in empty).toBe(false)
  })

  it('preserves multi-dependency (fan-in) edges that the single-dependency editor would otherwise drop', () => {
    const generated: SpecNode[] = [
      { id: 'a', title: 'A', prompt: 'pa' },
      { id: 'b', title: 'B', prompt: 'pb' },
      // Pure ordering edges (no ${nodes.*.output} in the prompt) on BOTH upstreams.
      { id: 'synth', title: 'Synthesize', prompt: 'combine results', depends_on: ['a', 'b'] },
    ]
    const subtasks = specToSubtasks(generated, 'm')
    const spec = buildSpec({ title: 'T', goal: 'g', projectId: '', orchModel: '', subtasks }, noConn)
    const synth = (spec.nodes as Array<{ id: string; depends_on?: string[] }>).find((n) => n.id === 'synth')!
    expect(new Set(synth.depends_on)).toEqual(new Set(['a', 'b']))
  })

  it('drops edges to nodes that no longer exist instead of emitting a dangling depends_on', () => {
    // 'synth' depended on 'a' and 'b'; the user deletes the 'b' row in the editor. synth still
    // carries b's uid, which no longer maps to a node — it must be dropped, not emitted dangling.
    const subtasks = specToSubtasks(
      [
        { id: 'a', title: 'A', prompt: 'pa' },
        { id: 'b', title: 'B', prompt: 'pb' },
        { id: 'synth', title: 'Synthesize', prompt: 'p', depends_on: ['a', 'b'] },
      ],
      'm',
    ).filter((s) => s.nodeId !== 'b') // delete the 'b' upstream row
    const spec = buildSpec({ title: 'T', goal: 'g', projectId: '', orchModel: '', subtasks }, noConn)
    const synth = (spec.nodes as Array<{ id: string; depends_on?: string[] }>).find((n) => n.id === 'synth')!
    expect(synth.depends_on).toEqual(['a']) // 'b' filtered out, not emitted as a dangling ref
  })

  it('preserves qa- node ids so adopted quick-add subtasks survive edit → save round-trips', () => {
    const sessionId = '260703-agile-moor'
    const qaId = quickAddNodeId(sessionId)
    // An editor row merged from a quick-add child (nodeId pre-set, prompt = typed title).
    const subtasks: EditorSubtask[] = [
      { uid: 'a', nodeId: 'generate', title: 'Generate', prompt: 'p', model: 'm', dependsOn: [] },
      { uid: 'b', nodeId: qaId, title: 'Task 2', prompt: 'Task 2', model: 'm', dependsOn: [] },
    ]
    const spec = buildSpec({ title: 'T', goal: 'g', projectId: '', orchModel: '', subtasks }, noConn)
    const ids = (spec.nodes as Array<{ id: string }>).map((n) => n.id)
    // The qa id lands verbatim (never re-derived from the title), and it round-trips back
    // to the same session id — the adoption linkage the board + editor merges rely on.
    expect(ids).toEqual(['generate', qaId])
    expect(quickAddSessionId(qaId)).toBe(sessionId)
    expect(quickAddSessionId('generate')).toBeUndefined()
  })

  it('derives ids from titles for manually added subtasks and dedupes collisions', () => {
    const spec = buildSpec(
      {
        title: 'T',
        goal: 'g',
        projectId: '',
        orchModel: '',
        subtasks: [
          { uid: 'a', title: 'Same Title', prompt: 'p1', model: 'm', dependsOn: [] },
          { uid: 'b', title: 'Same Title', prompt: 'p2', model: 'm', dependsOn: ['a'] },
        ],
      },
      noConn,
    )
    const nodes = spec.nodes as Array<{ id: string; depends_on?: string[] }>
    expect(nodes.map((n) => n.id)).toEqual(['same-title', 'same-title-2'])
    // depends_on still resolves to the deduped id of the first node.
    expect(nodes[1]!.depends_on).toEqual(['same-title'])
  })

  it('emits acceptance_criteria and max_iterations when set, and clamps max_iterations to the cap', () => {
    const spec = buildSpec(
      {
        title: 'T',
        goal: 'g',
        acceptanceCriteria: '  Must pass all tests.  ',
        maxRepairs: MAX_REPAIR_ATTEMPTS_CAP + 5,
        projectId: '',
        orchModel: '',
        subtasks: [{ uid: 'a', title: 'A', prompt: 'p', model: 'm', dependsOn: [] }],
      },
      noConn,
    )
    expect(spec.acceptance_criteria).toBe('Must pass all tests.')
    expect(spec.max_iterations).toBe(MAX_REPAIR_ATTEMPTS_CAP)
  })

  it('omits acceptance_criteria and max_iterations when unset', () => {
    const spec = buildSpec(
      {
        title: 'T',
        goal: 'g',
        projectId: '',
        orchModel: '',
        subtasks: [{ uid: 'a', title: 'A', prompt: 'p', model: 'm', dependsOn: [] }],
      },
      noConn,
    )
    expect('acceptance_criteria' in spec).toBe(false)
    expect('max_iterations' in spec).toBe(false)
  })

  it('emits max_iterations: 0 (disables repairs) rather than omitting it', () => {
    const spec = buildSpec(
      {
        title: 'T',
        goal: 'g',
        maxRepairs: 0,
        projectId: '',
        orchModel: '',
        subtasks: [{ uid: 'a', title: 'A', prompt: 'p', model: 'm', dependsOn: [] }],
      },
      noConn,
    )
    expect(spec.max_iterations).toBe(0)
  })

  it('keeps a preserved id even when it collides with a manual subtask title slug', () => {
    const spec = buildSpec(
      {
        title: 'T',
        goal: 'g',
        projectId: '',
        orchModel: '',
        subtasks: [
          // Manual row whose title slugifies to 'audit'.
          { uid: 'm1', title: 'Audit', prompt: 'p', model: 'x', dependsOn: [] },
          // Generated row that already owns the id 'audit'.
          { uid: 'g1', nodeId: 'audit', title: 'Renamed audit', prompt: 'q', model: 'x', dependsOn: [] },
        ],
      },
      noConn,
    )
    const nodes = spec.nodes as Array<{ id: string }>
    const byUidOrder = nodes.map((n) => n.id)
    // Preserved id wins 'audit'; the manual row is bumped to 'audit-2'.
    expect(byUidOrder).toContain('audit')
    expect(byUidOrder).toContain('audit-2')
  })

  it('round-trips a fan-in generated spec (generate → edit → create) with both edges intact', () => {
    const generated: SpecNode[] = [
      { id: 'research-competitors', title: 'Research competitors', prompt: 'survey' },
      { id: 'audit-board', title: 'Audit board', prompt: 'audit' },
      {
        id: 'synthesize-brief',
        title: 'Synthesize brief',
        prompt: 'combine ${nodes.research-competitors.output} and ${nodes.audit-board.output}',
        depends_on: ['research-competitors', 'audit-board'],
      },
    ]
    const subtasks = specToSubtasks(generated, 'm')
    const synthRow = subtasks.find((s) => s.nodeId === 'synthesize-brief')!
    expect(synthRow.dependsOn).toHaveLength(2) // both edges visible/editable in the model
    const spec = buildSpec({ title: 'T', goal: 'g', projectId: '', orchModel: '', subtasks }, noConn)
    const synth = (spec.nodes as Array<{ id: string; depends_on?: string[] }>).find((n) => n.id === 'synthesize-brief')!
    expect(new Set(synth.depends_on)).toEqual(new Set(['research-competitors', 'audit-board']))
  })

  it('emits both edges after a second dependency is added to a node', () => {
    const subtasks = specToSubtasks(
      [
        { id: 'a', title: 'A', prompt: 'pa' },
        { id: 'b', title: 'B', prompt: 'pb' },
        { id: 'synth', title: 'Synth', prompt: 'p', depends_on: ['a'] },
      ],
      'm',
    )
    const aUid = subtasks.find((s) => s.nodeId === 'a')!.uid
    const bUid = subtasks.find((s) => s.nodeId === 'b')!.uid
    const synth = subtasks.find((s) => s.nodeId === 'synth')!
    synth.dependsOn = [aUid, bUid] // user adds the second dependency in the editor
    const spec = buildSpec({ title: 'T', goal: 'g', projectId: '', orchModel: '', subtasks }, noConn)
    const out = (spec.nodes as Array<{ id: string; depends_on?: string[] }>).find((n) => n.id === 'synth')!
    expect(new Set(out.depends_on)).toEqual(new Set(['a', 'b']))
  })

  it('emits only the remaining edge after one of two dependencies is removed', () => {
    const subtasks = specToSubtasks(
      [
        { id: 'a', title: 'A', prompt: 'pa' },
        { id: 'b', title: 'B', prompt: 'pb' },
        { id: 'synth', title: 'Synth', prompt: 'p', depends_on: ['a', 'b'] },
      ],
      'm',
    )
    const aUid = subtasks.find((s) => s.nodeId === 'a')!.uid
    const synth = subtasks.find((s) => s.nodeId === 'synth')!
    synth.dependsOn = synth.dependsOn.filter((d) => d === aUid) // user removes the 'b' chip
    const spec = buildSpec({ title: 'T', goal: 'g', projectId: '', orchModel: '', subtasks }, noConn)
    const out = (spec.nodes as Array<{ id: string; depends_on?: string[] }>).find((n) => n.id === 'synth')!
    expect(out.depends_on).toEqual(['a'])
  })
})

describe('model/connection round-trip + project floor (PR #415)', () => {
  // pi/glm is served by 'zai'; claude-x by 'anthropic'. Used to prove connections are derived from
  // the model only when not explicitly preserved.
  const conns = new Map<string, string>([
    ['pi/glm', 'zai'],
    ['claude-x', 'anthropic'],
  ])

  it('round-trips a node with no model without pinning one (it inherits the orchestrator default)', () => {
    const subtasks = specToSubtasks([{ id: 'a', title: 'A', prompt: 'p' }])
    const spec = buildSpec({ title: 'T', goal: 'g', projectId: '', orchModel: '', subtasks }, conns)
    const node = (spec.nodes as Array<{ id: string; model?: string; llmConnection?: string }>)[0]!
    expect('model' in node).toBe(false)
    expect('llmConnection' in node).toBe(false)
  })

  it('preserves an explicit node llmConnection instead of re-deriving it from the model', () => {
    const subtasks = specToSubtasks([
      { id: 'a', title: 'A', prompt: 'p', model: 'pi/glm', llmConnection: 'custom-relay' },
    ])
    const spec = buildSpec({ title: 'T', goal: 'g', projectId: '', orchModel: '', subtasks }, conns)
    const node = (spec.nodes as Array<{ model?: string; llmConnection?: string }>)[0]!
    expect(node.model).toBe('pi/glm')
    // The authored connection is kept verbatim — NOT overwritten by the model's default ('zai').
    expect(node.llmConnection).toBe('custom-relay')
  })

  it('round-trips task defaults (llmConnection + permissionMode) without rewriting them', () => {
    const spec = buildSpec(
      {
        title: 'T',
        goal: 'g',
        projectId: '',
        orchModel: 'pi/glm',
        orchConnection: 'custom-relay',
        permissionMode: 'ask',
        subtasks: specToSubtasks([{ id: 'a', title: 'A', prompt: 'p' }]),
      },
      conns,
    )
    const defaults = spec.defaults as { model?: string; llmConnection?: string; permissionMode?: string }
    expect(defaults.model).toBe('pi/glm')
    expect(defaults.llmConnection).toBe('custom-relay') // preserved, not re-derived to 'zai'
    expect(defaults.permissionMode).toBe('ask')
  })

  it('derives the connection from the model when none is preserved (a fresh model pick)', () => {
    const spec = buildSpec(
      {
        title: 'T',
        goal: 'g',
        projectId: '',
        orchModel: 'pi/glm',
        subtasks: [{ uid: 'a', title: 'A', prompt: 'p', model: 'claude-x', dependsOn: [] }],
      },
      conns,
    )
    const defaults = spec.defaults as { llmConnection?: string }
    const node = (spec.nodes as Array<{ llmConnection?: string }>)[0]!
    expect(defaults.llmConnection).toBe('zai') // orchModel pi/glm → zai
    expect(node.llmConnection).toBe('anthropic') // node model claude-x → anthropic
  })

  it('omits defaults.permissionMode when unset so hand-authored specs are untouched', () => {
    const spec = buildSpec(
      { title: 'T', goal: 'g', projectId: '', orchModel: 'claude-x', subtasks: specToSubtasks([{ id: 'a', prompt: 'p' }]) },
      conns,
    )
    const defaults = spec.defaults as { permissionMode?: string }
    expect('permissionMode' in defaults).toBe(false)
  })

  it('preserves an existing project binding when the picker is left on "No Project" (edit mode)', () => {
    const spec = buildSpec(
      {
        title: 'T',
        goal: 'g',
        projectId: '',
        boundProjectId: 'proj_abc',
        orchModel: '',
        subtasks: specToSubtasks([{ id: 'a', prompt: 'p' }]),
      },
      conns,
    )
    // Blank pick floored to the existing binding — the spec (and thus children) keep the project.
    expect(spec.project).toBe('proj_abc')
  })

  it('lets a picked project override the bound floor', () => {
    const spec = buildSpec(
      {
        title: 'T',
        goal: 'g',
        projectId: 'proj_new',
        boundProjectId: 'proj_abc',
        orchModel: '',
        subtasks: specToSubtasks([{ id: 'a', prompt: 'p' }]),
      },
      conns,
    )
    expect(spec.project).toBe('proj_new')
  })
})

describe('quickAddChildToSubtask (PR #415 follow-up)', () => {
  it('preserves an explicit model AND llmConnection from the child session', () => {
    const row = quickAddChildToSubtask({
      sessionId: '260703-agile-moor',
      title: 'Do X',
      model: 'pi/glm',
      llmConnection: 'custom-relay',
    })
    expect(row.nodeId).toBe(quickAddNodeId('260703-agile-moor'))
    expect(row.title).toBe('Do X')
    expect(row.prompt).toBe('Do X')
    expect(row.model).toBe('pi/glm')
    // The connection is carried over — a custom-routed quick-add child keeps its backend on adoption.
    expect(row.llmConnection).toBe('custom-relay')
  })

  it('omits model/llmConnection when the child inherits (node then inherits the orchestrator default)', () => {
    const row = quickAddChildToSubtask({ sessionId: 's1', title: 'Y' })
    expect('model' in row).toBe(false)
    expect('llmConnection' in row).toBe(false)
  })
})

describe('canDependOn cycle guard', () => {
  const rows = (edges: Record<string, string[]>) =>
    Object.entries(edges).map(([uid, dependsOn]) => ({ uid, title: uid, prompt: '', model: 'm', dependsOn }))

  it('forbids self-dependency', () => {
    expect(canDependOn(rows({ a: [] }), 'a', 'a')).toBe(false)
  })

  it('forbids an edge that would close a cycle (candidate transitively depends on the node)', () => {
    // a → c already exists (a depends on c). Offering a as a dependency of c would form c → a → c.
    expect(canDependOn(rows({ a: ['c'], c: [] }), 'c', 'a')).toBe(false)
  })

  it('allows a safe, unrelated dependency', () => {
    expect(canDependOn(rows({ a: [], b: [], c: [] }), 'c', 'a')).toBe(true)
  })
})
