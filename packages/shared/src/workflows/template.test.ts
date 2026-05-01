import { describe, expect, test } from 'bun:test';
import { resolveTemplate, validateTemplateReferences } from './template.ts';

describe('resolveTemplate', () => {
  test('resolves {{trigger.x}}', () => {
    const got = resolveTemplate('Hello {{trigger.name}}!', { trigger: { name: 'Mike' } });
    expect(got.output).toBe('Hello Mike!');
    expect(got.warnings).toEqual([]);
  });

  test('resolves {{steps.<id>.output}} (string passthrough)', () => {
    const got = resolveTemplate('{{steps.research.output}}', {
      steps: { research: { output: 'a paragraph' } },
    });
    expect(got.output).toBe('a paragraph');
  });

  test('resolves {{steps.<id>.output.<path>}} via dot-walk', () => {
    const got = resolveTemplate('Title: {{steps.research.output.title}}', {
      steps: { research: { output: { title: 'AI', body: '...' } } },
    });
    expect(got.output).toBe('Title: AI');
  });

  test('resolves nested dot-walk', () => {
    const got = resolveTemplate('{{steps.s.output.a.b}}', {
      steps: { s: { output: { a: { b: 42 } } } },
    });
    expect(got.output).toBe('42');
  });

  test('resolves {{run.id}} and {{run.startedAt}}', () => {
    const got = resolveTemplate('run {{run.id}} at {{run.startedAt}}', {
      run: { id: 'abc', startedAt: '2026-04-30T00:00:00Z' },
    });
    expect(got.output).toBe('run abc at 2026-04-30T00:00:00Z');
  });

  test('non-string output gets JSON.stringified', () => {
    const got = resolveTemplate('{{steps.s.output}}', {
      steps: { s: { output: { x: 1 } } },
    });
    expect(got.output).toBe('{"x":1}');
  });

  test('unknown trigger field → empty string + warning', () => {
    const got = resolveTemplate('hi {{trigger.missing}}', { trigger: {} });
    expect(got.output).toBe('hi ');
    expect(got.warnings.length).toBe(1);
  });

  test('unknown step → empty string + warning', () => {
    const got = resolveTemplate('{{steps.nope.output}}', { steps: {} });
    expect(got.output).toBe('');
    expect(got.warnings.length).toBe(1);
  });

  test('unknown root token → warning', () => {
    const got = resolveTemplate('{{garbage.x}}', {});
    expect(got.output).toBe('');
    expect(got.warnings.length).toBe(1);
  });

  test('multiple tokens in one template', () => {
    const got = resolveTemplate('{{trigger.a}} / {{trigger.b}}', {
      trigger: { a: '1', b: '2' },
    });
    expect(got.output).toBe('1 / 2');
  });

  test('whitespace inside braces is tolerated', () => {
    const got = resolveTemplate('{{ trigger.name }}', { trigger: { name: 'x' } });
    expect(got.output).toBe('x');
  });
});

describe('validateTemplateReferences', () => {
  test('clean template returns no errors', () => {
    const errs = validateTemplateReferences(
      'Hi {{trigger.topic}} -- prev: {{steps.a.output}}',
      ['a'],
      ['topic'],
    );
    expect(errs).toEqual([]);
  });

  test('flags unknown trigger inputs', () => {
    const errs = validateTemplateReferences('{{trigger.unknown}}', [], []);
    expect(errs.length).toBe(1);
  });

  test('flags forward / unknown step references', () => {
    const errs = validateTemplateReferences('{{steps.future.output}}', [], []);
    expect(errs.length).toBe(1);
  });

  test('flags unrecognized root tokens', () => {
    const errs = validateTemplateReferences('{{nope.x}}', [], []);
    expect(errs.length).toBe(1);
  });

  test('accepts {{run.id}} and {{run.startedAt}}', () => {
    const errs = validateTemplateReferences('{{run.id}} {{run.startedAt}}', [], []);
    expect(errs).toEqual([]);
  });

  test('flags steps without .output', () => {
    const errs = validateTemplateReferences('{{steps.a.foo}}', ['a'], []);
    expect(errs.length).toBe(1);
  });
});
