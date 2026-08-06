import { describe, it, expect } from 'bun:test';
import { slugify, uniqueTaskSlug } from './slug.ts';

describe('slugify', () => {
  it('kebab-cases titles and strips edge dashes', () => {
    expect(slugify('  Fix the Login Flow!  ')).toBe('fix-the-login-flow');
    expect(slugify('---Weird___input---')).toBe('weird-input');
  });

  it('caps at 48 chars', () => {
    expect(slugify('a'.repeat(80)).length).toBe(48);
  });
});

describe('uniqueTaskSlug', () => {
  it('returns the base slug when free', () => {
    expect(uniqueTaskSlug('My Task', new Set())).toBe('my-task');
  });

  it('suffix-increments on collision and never overwrites', () => {
    const taken = new Set(['my-task', 'my-task-2']);
    expect(uniqueTaskSlug('My Task', taken)).toBe('my-task-3');
  });

  it('falls back to "task" for titles that slugify to nothing', () => {
    expect(uniqueTaskSlug('!!!', new Set())).toBe('task');
    expect(uniqueTaskSlug('!!!', new Set(['task']))).toBe('task-2');
  });

  it('keeps suffixed candidates within the 48-char cap', () => {
    const base = 'a'.repeat(48);
    const candidate = uniqueTaskSlug('a'.repeat(80), new Set([base]));
    expect(candidate.length).toBeLessThanOrEqual(48);
    expect(candidate.endsWith('-2')).toBe(true);
  });
});
