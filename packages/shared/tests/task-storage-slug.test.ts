import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  assertSafePathSegment,
  loadTaskSpec,
  saveTaskSpec,
  taskYamlPath,
} from '../src/tasks/storage.ts';

describe('assertSafePathSegment (task slug / runId / nodeId path guard)', () => {
  const good = ['my-task', 'task_1', 'Task.2', 'a', 'x'.repeat(128)];
  for (const slug of good) {
    it(`accepts ${slug.length > 20 ? 'max-length slug' : JSON.stringify(slug)}`, () => {
      expect(() => assertSafePathSegment(slug)).not.toThrow();
    });
  }

  const bad = [
    '../etc/passwd',
    '..',
    'a/../b',
    'a/b',
    'a\\b',
    '',
    '-leading-dash',
    '.leading-dot',
    'with space',
    'with:colon',
    'x'.repeat(129),
  ];
  for (const slug of bad) {
    it(`rejects ${slug.length > 20 ? 'over-long slug' : JSON.stringify(slug)}`, () => {
      expect(() => assertSafePathSegment(slug)).toThrow(/path segment/);
      expect(() => taskYamlPath('/tmp/ws', slug)).toThrow(/path segment/);
    });
  }

  it('loadTaskSpec/saveTaskSpec refuse traversal slugs (no /tmp escape)', () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-slug-'));
    // trap file outside workspace: if traversal works we'd clobber it
    const trap = join(root, '..', 'craft-slug-trap.yaml');
    expect(() => loadTaskSpec(root, '../escape')).toThrow(/path segment/);
    expect(() =>
      saveTaskSpec(root, {
        id: '../escape',
        name: 'evil',
        nodes: [{ id: 'n1', title: 't', prompt: 'p' }],
      } as never),
    ).toThrow();
    // sanity: normal slug round-trips
    mkdirSync(join(root, 'tasks', 'real-task'), { recursive: true });
    writeFileSync(join(root, 'tasks', 'real-task', 'task.yaml'), 'id: real-task\nname: ok\nnodes: []\n');
    expect(loadTaskSpec(root, 'real-task')).not.toBeNull();
    void trap;
  });
});
