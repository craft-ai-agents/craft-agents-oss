import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const minimalMeta = (overrides?: Partial<WorkflowMetadata>): WorkflowMetadata => ({
  name: 'My Flow',
  description: 'A flow.',
  trigger: { type: 'manual' },
  steps: [{ id: 'one', agent: 'researcher', input: 'do the thing' }],
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
        { id: 'research', agent: 'researcher', input: 'Research {{trigger.topic}}.', description: 'gather facts' },
        { id: 'draft', agent: 'writer', input: 'Use this:\n\n{{steps.research.output}}' },
      ],
    };
    const text = serializeWorkflow(meta, 'Body content here.');
    const parsed = parseWorkflowFile(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.metadata).toEqual(meta);
    expect(parsed!.body).toBe('Body content here.');
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
