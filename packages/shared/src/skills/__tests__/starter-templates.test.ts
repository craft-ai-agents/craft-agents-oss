import { describe, it, expect } from 'bun:test';
import matter from 'gray-matter';
import { STARTER_SKILLS } from '../starter-templates.ts';

describe('STARTER_SKILLS', () => {
  it('has unique kebab-case slugs', () => {
    const slugs = STARTER_SKILLS.map(s => s.slug);
    const seen = new Set<string>();
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(slug)).toBe(false);
      seen.add(slug);
    }
  });

  function getSkillMd(skill: { files: { path: string; content: string }[] }): string {
    const f = skill.files.find(f => f.path === 'SKILL.md');
    if (!f) throw new Error('Missing SKILL.md');
    return f.content;
  }

  it('every entry parses to valid SKILL.md frontmatter (name + description)', () => {
    for (const skill of STARTER_SKILLS) {
      const parsed = matter(getSkillMd(skill));
      expect(typeof parsed.data.name).toBe('string');
      expect((parsed.data.name as string).trim().length).toBeGreaterThan(0);
      expect(typeof parsed.data.description).toBe('string');
      expect((parsed.data.description as string).trim().length).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty markdown body', () => {
    for (const skill of STARTER_SKILLS) {
      const parsed = matter(getSkillMd(skill));
      expect(parsed.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('includes the source-recipe starter skill', () => {
    const recipe = STARTER_SKILLS.find(s => s.slug === 'source-recipe');
    expect(recipe).toBeDefined();
    const parsed = matter(getSkillMd(recipe!));
    expect(parsed.data.name).toBe('Source Recipe');
    // Description must mention list_sources so the trigger matcher can fire.
    expect((parsed.data.description as string).toLowerCase()).toContain('source');
    // Body must reference the live catalog tool.
    expect(parsed.content).toContain('list_sources');
    // Cap rule must be present so curation behavior is preserved.
    expect(parsed.content.toLowerCase()).toContain('3 sources');
  });

  it('keeps the agent-creator, automation-creator, and workflow-creator starters', () => {
    const slugs = STARTER_SKILLS.map(s => s.slug);
    expect(slugs).toContain('agent-creator');
    expect(slugs).toContain('automation-creator');
    expect(slugs).toContain('workflow-creator');
  });

  it('includes the hidden RunnerOS self-edit starter skill', () => {
    const skill = STARTER_SKILLS.find(s => s.slug === 'runneros-self-edit');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('RunnerOS Self Edit');
    expect(parsed.content).toContain('developer.selfEdit.repoPath');
    expect(parsed.content).toContain('apps/electron');
  });

  it('workflow-creator can save confirmed workflow drafts', () => {
    const skill = STARTER_SKILLS.find(s => s.slug === 'workflow-creator');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.tools).toContain('create_workflow');
    expect(parsed.content).toContain('Use `create_workflow` to save');
    expect(parsed.content).toContain('## Chaining pattern');
    expect(parsed.content).toContain('## Reliability defaults');
    expect(parsed.content).toContain('`image`, `video`, `audio`');
    expect(parsed.content).not.toContain('`media`');
  });
});
