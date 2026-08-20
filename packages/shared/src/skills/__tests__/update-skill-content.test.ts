import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { updateSkillContent, deleteSkill } from '../storage.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-update-'));
  const dir = join(root, 'skills', 'demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    '---\nname: Demo\ndescription: Old desc\n---\n\n# Body\n\nold body\n',
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('updateSkillContent', () => {
  it('updates name, description, and body', () => {
    const skill = updateSkillContent(root, 'demo', {
      name: 'Demo 2',
      description: 'New desc',
      content: '# Body\n\nnew body\n',
    });
    expect(skill).not.toBeNull();
    expect(skill!.metadata.name).toBe('Demo 2');
    expect(skill!.metadata.description).toBe('New desc');
    expect(skill!.content).toContain('new body');

    const raw = readFileSync(join(root, 'skills', 'demo', 'SKILL.md'), 'utf-8');
    expect(raw).toContain('name: Demo 2');
    expect(raw).toContain('description: New desc');
    expect(raw).toContain('new body');
  });

  it('returns null for missing skill', () => {
    expect(updateSkillContent(root, 'missing', { name: 'x', description: 'y' })).toBeNull();
  });

  it('rejects path-traversal and invalid slugs', () => {
    expect(() =>
      updateSkillContent(root, '../outside', { name: 'x', description: 'y' }),
    ).toThrow(/Invalid skill slug/);
    expect(() =>
      updateSkillContent(root, 'Demo', { name: 'x', description: 'y' }),
    ).toThrow(/Invalid skill slug/);
    expect(() =>
      updateSkillContent(root, '', { name: 'x', description: 'y' }),
    ).toThrow(/Invalid skill slug/);
    expect(() =>
      updateSkillContent(root, 'has/slash', { name: 'x', description: 'y' }),
    ).toThrow(/Invalid skill slug/);
  });
});


describe('deleteSkill path safety', () => {
  it('rejects path-traversal and invalid slugs', () => {
    expect(() => deleteSkill(root, '../outside')).toThrow(/Invalid skill slug/);
    expect(() => deleteSkill(root, 'Demo')).toThrow(/Invalid skill slug/);
    expect(() => deleteSkill(root, 'has/slash')).toThrow(/Invalid skill slug/);
  });

  it('deletes a valid workspace skill', () => {
    expect(deleteSkill(root, 'demo')).toBe(true);
    expect(deleteSkill(root, 'demo')).toBe(false);
  });
});
