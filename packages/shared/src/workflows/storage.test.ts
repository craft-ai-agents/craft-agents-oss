import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getActivatedWorkflowsManifestPath } from '../workspaces/storage.ts';
import {
  deleteRun,
  listRuns,
  markRunningRunsInterrupted,
  readRun,
  writeRun,
} from './run-storage.ts';
import type { WorkflowRunSnapshot, WorkflowRunState } from './run-types.ts';
import {
  deleteGlobalWorkflow,
  ensureRequiredWorkflows,
  loadActivatedWorkflows,
  loadAllGlobalWorkflows,
  loadGlobalWorkflow,
  parseWorkflowFile,
  readActivatedWorkflows,
  seedGlobalWorkflowLibraryIfEmpty,
  serializeWorkflow,
  setWorkflowActive,
  writeActivatedWorkflows,
  writeGlobalWorkflow,
} from './storage.ts';
import type { WorkflowMetadata } from './types.ts';

let libDir: string;
let workspace: string;

beforeEach(() => {
  libDir = mkdtempSync(join(tmpdir(), 'wf-lib-'));
  workspace = mkdtempSync(join(tmpdir(), 'wf-ws-'));
});

afterEach(() => {
  rmSync(libDir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

const opts = () => ({ globalWorkflowsDir: libDir });
const RUN_INTERRUPTED_ID = '11111111-1111-4111-8111-111111111111';
const RUN_RUNNING_ID = '22222222-2222-4222-8222-222222222222';
const RUN_FAILED_ID = '33333333-3333-4333-8333-333333333333';
const RUN_MALFORMED_ID = '44444444-4444-4444-8444-444444444444';
const RUN_MISMATCHED_ID = '55555555-5555-4555-8555-555555555555';
const RUN_OTHER_ID = '66666666-6666-4666-8666-666666666666';
const RUN_OUTSIDE_ID = '77777777-7777-4777-8777-777777777777';

const minimalMeta = (overrides?: Partial<WorkflowMetadata>): WorkflowMetadata => ({
  name: 'My Flow',
  description: 'A flow.',
  trigger: { type: 'manual' },
  steps: [{ id: 'one', agent: 'researcher', input: 'do the thing' }],
  ...overrides,
});

const runSnapshot = (
  id: string,
  state: WorkflowRunState,
  overrides?: Partial<WorkflowRunSnapshot>,
): WorkflowRunSnapshot => ({
  id,
  workflowSlug: 'my-flow',
  workspaceId: 'workspace-1',
  state,
  trigger: {
    type: 'manual',
    inputs: {},
    firedAt: '2026-01-01T00:00:00.000Z',
  },
  workflowSnapshot: {
    metadata: minimalMeta({
      steps: [
        { id: 'one', agent: 'researcher', input: 'do the thing' },
        { id: 'two', agent: 'writer', input: 'write it' },
      ],
    }),
    body: '',
  },
  steps: [
    { id: 'one', state: 'queued', attempts: 0 },
    { id: 'two', state: 'queued', attempts: 0 },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// parseWorkflowFile
// ---------------------------------------------------------------------------

describe('parseWorkflowFile', () => {
  test('parses minimal frontmatter with one step', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'steps:',
      '  - id: one',
      '    agent: researcher',
      '    input: hi',
      '---',
      'body',
    ].join('\n');
    const got = parseWorkflowFile(text);
    expect(got).not.toBeNull();
    expect(got!.metadata.name).toBe('A');
    expect(got!.metadata.steps).toHaveLength(1);
    expect(got!.metadata.steps[0]!.id).toBe('one');
    expect(got!.metadata.trigger.type).toBe('manual');
    expect(got!.body).toBe('body');
  });

  test('returns null when name is missing', () => {
    expect(
      parseWorkflowFile('---\ndescription: x\nsteps:\n  - id: a\n    agent: r\n    input: hi\n---\n'),
    ).toBeNull();
  });

  test('returns null when description is missing', () => {
    expect(
      parseWorkflowFile('---\nname: x\nsteps:\n  - id: a\n    agent: r\n    input: hi\n---\n'),
    ).toBeNull();
  });

  test('returns null when steps is missing or empty', () => {
    expect(parseWorkflowFile('---\nname: x\ndescription: y\n---\n')).toBeNull();
    expect(parseWorkflowFile('---\nname: x\ndescription: y\nsteps: []\n---\n')).toBeNull();
  });

  test('returns null on duplicate step ids', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'steps:',
      '  - id: a',
      '    agent: r',
      '    input: hi',
      '  - id: a',
      '    agent: r',
      '    input: hi',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(text)).toBeNull();
  });

  test('returns null on non-slug step.id', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'steps:',
      '  - id: "Bad Id!"',
      '    agent: r',
      '    input: hi',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(text)).toBeNull();
  });

  test('returns null on non-slug agent', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'steps:',
      '  - id: ok',
      '    agent: "Bad Agent!"',
      '    input: hi',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(text)).toBeNull();
  });

  test('returns null on forward template reference', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: "{{steps.second.output}}"',
      '  - id: second',
      '    agent: r',
      '    input: hi',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(text)).toBeNull();
  });

  test('returns null on unknown trigger input reference', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: "{{trigger.missing}}"',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(text)).toBeNull();
  });

  test('accepts backward step reference', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: hi',
      '  - id: second',
      '    agent: r',
      '    input: "{{steps.first.output}}"',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(text)).not.toBeNull();
  });

  test('accepts trigger reference when trigger declares the input', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'trigger:',
      '  type: manual',
      '  inputs:',
      '    - name: topic',
      '      type: string',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: "{{trigger.topic}}"',
      '---',
    ].join('\n');
    const got = parseWorkflowFile(text);
    expect(got).not.toBeNull();
    expect(got!.metadata.trigger.inputs).toEqual([{ name: 'topic', type: 'string' }]);
  });

  test('returns null on duplicate trigger input names', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'trigger:',
      '  type: manual',
      '  inputs:',
      '    - name: topic',
      '      type: string',
      '    - name: topic',
      '      type: number',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: "{{trigger.topic}}"',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(text)).toBeNull();
  });

  test('returns null on trigger inputs without names', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'trigger:',
      '  type: manual',
      '  inputs:',
      '    - type: string',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: hi',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(text)).toBeNull();
  });

  test('returns null on unsupported trigger input types', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'trigger:',
      '  type: manual',
      '  inputs:',
      '    - name: topic',
      '      type: object',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: "{{trigger.topic}}"',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(text)).toBeNull();
  });

  test('returns null on trigger input names that cannot be referenced', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'trigger:',
      '  type: manual',
      '  inputs:',
      '    - name: topic.name',
      '      type: string',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: "{{trigger.topic.name}}"',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(text)).toBeNull();
  });

  test('returns null on trigger references with extra path segments', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'trigger:',
      '  type: manual',
      '  inputs:',
      '    - name: topic',
      '      type: string',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: "{{trigger.topic.name}}"',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(text)).toBeNull();
  });

  test('rejects unsupported workflow execution syntax', () => {
    const base = [
      '---',
      'name: A',
      'description: B',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: hi',
      '---',
    ];
    expect(parseWorkflowFile([...base.slice(0, 3), 'when: true', ...base.slice(3)].join('\n'))).toBeNull();
    expect(parseWorkflowFile([...base.slice(0, -1), '    humanCheckpoint: true', '---'].join('\n'))).toBeNull();
    expect(parseWorkflowFile([...base.slice(0, -1), '    parallelGroup: group-a', '---'].join('\n'))).toBeNull();
  });

  test('validates trigger input defaults against declared type', () => {
    const valid = [
      '---',
      'name: A',
      'description: B',
      'trigger:',
      '  type: manual',
      '  inputs:',
      '    - name: count',
      '      type: number',
      '      default: 2',
      '    - name: enabled',
      '      type: boolean',
      '      default: true',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: "{{trigger.count}} {{trigger.enabled}}"',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(valid)?.metadata.trigger.inputs).toEqual([
      { name: 'count', type: 'number', default: 2 },
      { name: 'enabled', type: 'boolean', default: true },
    ]);

    const invalid = valid.replace('default: 2', 'default: two');
    expect(parseWorkflowFile(invalid)).toBeNull();
  });

  test('warns + downgrades to manual when trigger.type is an unknown string', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'trigger:',
      '  type: schedule',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: hi',
      '---',
    ].join('\n');
    const got = parseWorkflowFile(text);
    expect(got).not.toBeNull();
    expect(got!.metadata.trigger.type).toBe('manual');
    expect(got!.warnings.some((w) => w.code === 'invalid-trigger' && /schedule/.test(w.message))).toBe(true);
  });

  test('rejects outputs.kind with an unsupported value at parse time', () => {
    const text = [
      '---',
      'name: A',
      'description: B',
      'outputs:',
      '  kind: bogus',
      'steps:',
      '  - id: first',
      '    agent: r',
      '    input: hi',
      '---',
    ].join('\n');
    expect(parseWorkflowFile(text)).toBeNull();
  });

  test('accepts every valid OutputKind in outputs.kind', () => {
    const validKinds = [
      'report',
      'document',
      'image',
      'video',
      'audio',
      'dataset',
      'code',
      'receipt',
      'external-action',
      'collection',
      'other',
    ] as const;
    for (const kind of validKinds) {
      const text = [
        '---',
        'name: A',
        'description: B',
        'outputs:',
        `  kind: ${kind}`,
        'steps:',
        '  - id: first',
        '    agent: r',
        '    input: hi',
        '---',
      ].join('\n');
      const got = parseWorkflowFile(text);
      expect(got, `kind=${kind}`).not.toBeNull();
      expect(got!.metadata.outputs?.kind).toBe(kind);
    }
  });
});

// ---------------------------------------------------------------------------
// serialize round-trip
// ---------------------------------------------------------------------------

describe('serializeWorkflow', () => {
  test('round-trips faithfully', () => {
    const meta: WorkflowMetadata = {
      name: 'Pipeline',
      description: 'A test pipeline',
      avatar: '🧪',
      trigger: {
        type: 'manual',
        inputs: [
          { name: 'topic', type: 'string', required: true, description: 'What to write' },
          { name: 'word_count', type: 'number', default: 600 },
        ],
      },
      steps: [
        {
          id: 'research',
          agent: 'researcher',
          input: 'Research {{trigger.topic}}.',
          description: 'gather facts',
          outputSchema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
          timeout: 30,
          retries: 1,
          onFailure: 'continue',
          completion: {
            requireToolUse: true,
            minOutputChars: 50,
          },
        },
        { id: 'draft', agent: 'writer', input: 'Use this:\n\n{{steps.research.output.title}}' },
      ],
    };
    const text = serializeWorkflow(meta, 'Body content here.');
    const parsed = parseWorkflowFile(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.metadata).toEqual(meta);
    expect(parsed!.body).toBe('Body content here.');
  });

  test('throws on invalid trigger input defaults at save serialization time', () => {
    const meta = minimalMeta({
      trigger: {
        type: 'manual',
        inputs: [{ name: 'count', type: 'number', default: 'two' }],
      },
      steps: [{ id: 'one', agent: 'researcher', input: '{{trigger.count}}' }],
    });
    expect(() => serializeWorkflow(meta, '')).toThrow(/count/);
  });

  test('returns null for invalid Phase 2 reliability fields', () => {
    const base = [
      '---',
      'name: A',
      'description: B',
      'steps:',
      '  - id: one',
      '    agent: r',
      '    input: hi',
    ];
    expect(parseWorkflowFile([...base, '    outputSchema: []', '---'].join('\n'))).toBeNull();
    expect(parseWorkflowFile([...base, '    timeout: 0', '---'].join('\n'))).toBeNull();
    expect(parseWorkflowFile([...base, '    retries: 1.5', '---'].join('\n'))).toBeNull();
    expect(parseWorkflowFile([...base, '    onFailure: skip', '---'].join('\n'))).toBeNull();
    expect(parseWorkflowFile([...base, '    completion: []', '---'].join('\n'))).toBeNull();
    expect(parseWorkflowFile([...base, '    completion:', '      requireToolUse: yes', '---'].join('\n'))).toBeNull();
    expect(parseWorkflowFile([...base, '    completion:', '      minOutputChars: -1', '---'].join('\n'))).toBeNull();
    expect(parseWorkflowFile([...base, '    completion:', '      requireToolsUse: true', '---'].join('\n'))).toBeNull();
  });

  test('parses supported step failure policies', () => {
    const base = [
      '---',
      'name: A',
      'description: B',
      'steps:',
      '  - id: one',
      '    agent: r',
      '    input: hi',
      '    onFailure: ask',
      '  - id: two',
      '    agent: r',
      '    input: bye',
      '    onFailure: continue',
      '---',
    ].join('\n');
    const parsed = parseWorkflowFile(base);
    expect(parsed).not.toBeNull();
    expect(parsed!.metadata.steps[0]!.onFailure).toBe('ask');
    expect(parsed!.metadata.steps[1]!.onFailure).toBe('continue');
  });
});

// ---------------------------------------------------------------------------
// Run storage
// ---------------------------------------------------------------------------

describe('run storage', () => {
  test('writes, reads, and lists interrupted runs', () => {
    const run = runSnapshot(RUN_INTERRUPTED_ID, 'interrupted', {
      completedAt: '2026-01-01T00:05:00.000Z',
      interruptedAt: '2026-01-01T00:05:00.000Z',
      interruptionReason: 'server restarted',
      resumeFromStepId: 'two',
      steps: [
        {
          id: 'one',
          state: 'succeeded',
          startedAt: '2026-01-01T00:01:00.000Z',
          completedAt: '2026-01-01T00:02:00.000Z',
          attempts: 1,
        },
        {
          id: 'two',
          state: 'failed',
          startedAt: '2026-01-01T00:03:00.000Z',
          completedAt: '2026-01-01T00:05:00.000Z',
          error: { code: 'run-interrupted', message: 'server restarted' },
          attempts: 1,
        },
      ],
    });

    writeRun(workspace, run);

    expect(readRun(workspace, RUN_INTERRUPTED_ID)).toEqual(run);
    expect(listRuns(workspace)).toEqual([run]);
  });

  test('marks running runs interrupted and preserves non-running runs', () => {
    const running = runSnapshot(RUN_RUNNING_ID, 'running', {
      steps: [
        {
          id: 'one',
          state: 'succeeded',
          startedAt: '2026-01-01T00:01:00.000Z',
          completedAt: '2026-01-01T00:02:00.000Z',
          attempts: 1,
        },
        {
          id: 'two',
          state: 'running',
          startedAt: '2026-01-01T00:03:00.000Z',
          sessionId: 'session-1',
          attempts: 1,
        },
      ],
    });
    const failed = runSnapshot(RUN_FAILED_ID, 'failed', {
      completedAt: '2026-01-01T00:04:00.000Z',
      steps: [
        {
          id: 'one',
          state: 'failed',
          completedAt: '2026-01-01T00:04:00.000Z',
          error: { code: 'step-failed', message: 'nope' },
          attempts: 1,
        },
        { id: 'two', state: 'queued', attempts: 0 },
      ],
    });

    writeRun(workspace, running);
    writeRun(workspace, failed);

    const changed = markRunningRunsInterrupted(workspace, 'server restarted');

    expect(changed).toHaveLength(1);
    const recovered = changed[0]!;
    expect(recovered.id).toBe(RUN_RUNNING_ID);
    expect(recovered.state).toBe('interrupted');
    expect(typeof recovered.completedAt).toBe('string');
    expect(recovered.completedAt).toBeDefined();
    expect(recovered.interruptedAt).toBe(recovered.completedAt);
    expect(recovered.updatedAt).toBe(recovered.completedAt!);
    expect(recovered.interruptionReason).toBe('server restarted');
    expect(recovered.resumeFromStepId).toBe('two');
    expect(recovered.steps[0]).toEqual(running.steps[0]);
    expect(recovered.steps[1]).toMatchObject({
      id: 'two',
      state: 'failed',
      sessionId: 'session-1',
      error: { code: 'run-interrupted', message: 'server restarted' },
      attempts: 1,
    });
    expect(recovered.steps[1]!.completedAt).toBe(recovered.completedAt);

    expect(readRun(workspace, RUN_RUNNING_ID)).toEqual(recovered);
    expect(readRun(workspace, RUN_FAILED_ID)).toEqual(failed);
  });

  test('rejects traversal run ids before reading or deleting', () => {
    const outsideDir = join(workspace, '..', RUN_OUTSIDE_ID);
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'run.json'), 'outside');

    expect(readRun(workspace, `../${RUN_OUTSIDE_ID}`)).toBeNull();
    expect(readRun(workspace, `${RUN_OUTSIDE_ID}/..`)).toBeNull();
    expect(readRun(workspace, 'not-a-run-id')).toBeNull();

    expect(deleteRun(workspace, `../${RUN_OUTSIDE_ID}`)).toBe(false);
    expect(existsSync(join(outsideDir, 'run.json'))).toBe(true);
  });

  test('skips malformed and mismatched run snapshots safely', () => {
    const malformedDir = join(workspace, 'runs', RUN_MALFORMED_ID);
    mkdirSync(malformedDir, { recursive: true });
    writeFileSync(join(malformedDir, 'run.json'), JSON.stringify({ id: RUN_MALFORMED_ID, state: 'running' }));

    const mismatched = runSnapshot(RUN_OTHER_ID, 'failed');
    const mismatchedDir = join(workspace, 'runs', RUN_MISMATCHED_ID);
    mkdirSync(mismatchedDir, { recursive: true });
    writeFileSync(join(mismatchedDir, 'run.json'), JSON.stringify(mismatched));

    const good = runSnapshot(RUN_OTHER_ID, 'succeeded');
    writeRun(workspace, good);

    expect(readRun(workspace, RUN_MALFORMED_ID)).toBeNull();
    expect(readRun(workspace, RUN_MISMATCHED_ID)).toBeNull();
    expect(listRuns(workspace)).toEqual([good]);
  });
});

// ---------------------------------------------------------------------------
// CRUD on the global library
// ---------------------------------------------------------------------------

describe('write / load / delete', () => {
  test('write + load one workflow', () => {
    writeGlobalWorkflow({ slug: 'my-flow', metadata: minimalMeta(), body: 'notes' }, opts());
    const loaded = loadGlobalWorkflow('my-flow', opts());
    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.name).toBe('My Flow');
    expect(loaded!.body).toBe('notes');
  });

  test('write rejects invalid slug', () => {
    expect(() =>
      writeGlobalWorkflow({ slug: 'Bad Slug!', metadata: minimalMeta(), body: '' }, opts()),
    ).toThrow();
  });

  test('write rejects invalid trigger input defaults before saving', () => {
    expect(() =>
      writeGlobalWorkflow({
        slug: 'bad-default',
        metadata: minimalMeta({
          trigger: {
            type: 'manual',
            inputs: [{ name: 'flag', type: 'boolean', default: 'yes' }],
          },
          steps: [{ id: 'one', agent: 'researcher', input: '{{trigger.flag}}' }],
        }),
        body: '',
      }, opts()),
    ).toThrow(/flag/);
    expect(existsSync(join(libDir, 'bad-default', 'WORKFLOW.md'))).toBe(false);
  });

  test('write rejects parser-invalid metadata before saving', () => {
    expect(() =>
      writeGlobalWorkflow({
        slug: 'bad-steps',
        metadata: minimalMeta({
          steps: [
            { id: 'one', agent: 'researcher', input: 'first' },
            { id: 'one', agent: 'writer', input: '{{steps.one.output}}' },
          ],
        }),
        body: '',
      }, opts()),
    ).toThrow(/Invalid workflow metadata/);

    expect(existsSync(join(libDir, 'bad-steps', 'WORKFLOW.md'))).toBe(false);
  });

  test('loadAll returns all parseable workflows sorted by slug', () => {
    writeGlobalWorkflow({ slug: 'b-flow', metadata: minimalMeta({ name: 'B' }), body: '' }, opts());
    writeGlobalWorkflow({ slug: 'a-flow', metadata: minimalMeta({ name: 'A' }), body: '' }, opts());
    const all = loadAllGlobalWorkflows(opts());
    expect(all.map((w) => w.slug)).toEqual(['a-flow', 'b-flow']);
  });

  test('loadAll skips malformed and non-slug directories', () => {
    writeGlobalWorkflow({ slug: 'good', metadata: minimalMeta(), body: '' }, opts());
    // malformed
    const badDir = join(libDir, 'broken');
    require('node:fs').mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'WORKFLOW.md'), 'no frontmatter at all');
    // non-slug dir name
    const upperDir = join(libDir, 'NoUpper');
    require('node:fs').mkdirSync(upperDir, { recursive: true });
    writeFileSync(join(upperDir, 'WORKFLOW.md'), serializeWorkflow(minimalMeta(), ''));

    const all = loadAllGlobalWorkflows(opts());
    expect(all.map((w) => w.slug)).toEqual(['good']);
  });

  test('delete removes the workflow', () => {
    writeGlobalWorkflow({ slug: 'gone', metadata: minimalMeta(), body: '' }, opts());
    expect(deleteGlobalWorkflow('gone', [workspace], opts())).toBe(true);
    expect(loadGlobalWorkflow('gone', opts())).toBeNull();
  });

  test('delete clears the slug from each workspace activation manifest', () => {
    writeGlobalWorkflow({ slug: 'gone', metadata: minimalMeta(), body: '' }, opts());
    setWorkflowActive(workspace, 'gone', true);
    expect(readActivatedWorkflows(workspace).active).toContain('gone');
    deleteGlobalWorkflow('gone', [workspace], opts());
    expect(readActivatedWorkflows(workspace).active).not.toContain('gone');
  });
});

// ---------------------------------------------------------------------------
// Activation manifest
// ---------------------------------------------------------------------------

describe('activation manifest', () => {
  test('read returns empty manifest when missing', () => {
    const m = readActivatedWorkflows(workspace);
    expect(m.active).toEqual([]);
  });

  test('write + read round-trips', () => {
    writeActivatedWorkflows(workspace, ['a', 'b']);
    expect(readActivatedWorkflows(workspace).active.sort()).toEqual(['a', 'b']);
  });

  test('read backs up malformed manifest before returning empty manifest', () => {
    const path = getActivatedWorkflowsManifestPath(workspace);
    writeFileSync(path, '{not-json', 'utf-8');

    const m = readActivatedWorkflows(workspace);
    expect(m.active).toEqual([]);
    expect(existsSync(path)).toBe(false);

    const backups = readdirSync(workspace).filter((name) => name.startsWith('activated-workflows.json.broken-'));
    expect(backups).toHaveLength(1);
    const backupName = backups[0];
    expect(backupName).toBeDefined();
    expect(readFileSync(join(workspace, backupName!), 'utf-8')).toBe('{not-json');
  });

  test('setWorkflowActive toggles a single slug', () => {
    setWorkflowActive(workspace, 'flow-x', true);
    expect(readActivatedWorkflows(workspace).active).toContain('flow-x');
    setWorkflowActive(workspace, 'flow-x', false);
    expect(readActivatedWorkflows(workspace).active).not.toContain('flow-x');
  });

  test('loadActivatedWorkflows skips and self-heals slugs missing from the library', () => {
    writeGlobalWorkflow({ slug: 'present', metadata: minimalMeta(), body: '' }, opts());
    writeActivatedWorkflows(workspace, ['present', 'missing']);
    const loaded = loadActivatedWorkflows(workspace, opts());
    expect(loaded.map((w) => w.slug)).toEqual(['present']);
    // Self-healed:
    expect(readActivatedWorkflows(workspace).active).toEqual(['present']);
  });
});

// ---------------------------------------------------------------------------
// Seeding & migrations
// ---------------------------------------------------------------------------

describe('seedGlobalWorkflowLibraryIfEmpty', () => {
  test('seeds starters on first run', () => {
    const res = seedGlobalWorkflowLibraryIfEmpty(
      [{ slug: 'starter', metadata: minimalMeta(), body: '' }],
      opts(),
    );
    expect(res.seeded).toBe(1);
    expect(loadGlobalWorkflow('starter', opts())).not.toBeNull();
  });

  test('never overwrites existing files and does not re-seed', () => {
    writeGlobalWorkflow(
      { slug: 'starter', metadata: minimalMeta({ name: 'User Edit' }), body: 'mine' },
      opts(),
    );
    seedGlobalWorkflowLibraryIfEmpty(
      [{ slug: 'starter', metadata: minimalMeta({ name: 'Original' }), body: 'theirs' }],
      opts(),
    );
    const loaded = loadGlobalWorkflow('starter', opts());
    expect(loaded!.metadata.name).toBe('User Edit');
    expect(loaded!.body).toBe('mine');

    // Second call is a no-op even after deleting the starter.
    deleteGlobalWorkflow('starter', [workspace], opts());
    const second = seedGlobalWorkflowLibraryIfEmpty(
      [{ slug: 'starter', metadata: minimalMeta(), body: '' }],
      opts(),
    );
    expect(second.seeded).toBe(0);
  });
});

describe('ensureRequiredWorkflows', () => {
  test('writes missing required workflows', () => {
    const res = ensureRequiredWorkflows(
      [{ slug: 'required', metadata: minimalMeta(), body: '' }],
      opts(),
    );
    expect(res.ensured).toBe(1);
    expect(loadGlobalWorkflow('required', opts())).not.toBeNull();
  });

  test('respects tombstones (deleted workflows do not come back)', () => {
    writeGlobalWorkflow({ slug: 'goner', metadata: minimalMeta(), body: '' }, opts());
    deleteGlobalWorkflow('goner', [workspace], opts());
    const res = ensureRequiredWorkflows(
      [{ slug: 'goner', metadata: minimalMeta(), body: '' }],
      opts(),
    );
    expect(res.ensured).toBe(0);
    expect(loadGlobalWorkflow('goner', opts())).toBeNull();
  });

  test('writing a tombstoned slug forgets the tombstone', () => {
    writeGlobalWorkflow({ slug: 'rev', metadata: minimalMeta(), body: '' }, opts());
    deleteGlobalWorkflow('rev', [workspace], opts());
    writeGlobalWorkflow({ slug: 'rev', metadata: minimalMeta(), body: '' }, opts());
    // ensureRequired should now reseed missing-ness checks normally
    const res = ensureRequiredWorkflows(
      [{ slug: 'rev', metadata: minimalMeta(), body: '' }],
      opts(),
    );
    // file already exists → ensured stays 0, but it's not tombstoned anymore
    expect(res.ensured).toBe(0);
    expect(existsSync(join(libDir, 'rev', 'WORKFLOW.md'))).toBe(true);
    // and verify the tombstone file actually no longer lists it
    const deletedFile = join(libDir, '.deleted-workflows.json');
    if (existsSync(deletedFile)) {
      const parsed = JSON.parse(readFileSync(deletedFile, 'utf-8'));
      expect(parsed.deleted ?? []).not.toContain('rev');
    }
  });
});
