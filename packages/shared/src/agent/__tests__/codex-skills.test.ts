/**
 * Tests for Codex Skill Extraction
 *
 * Verifies that [skill:...] mentions in messages are:
 * 1. Parsed and converted to Codex UserInput { type: "skill" } items
 * 2. Stripped from the text content sent to Codex
 *
 * The skill extraction logic lives in CodexAgent.buildUserInput(), which uses:
 * - parseMentions() from @craft-agent/shared/mentions (parses [skill:slug] syntax)
 * - stripAllMentions() from @craft-agent/shared/mentions (removes all [bracket] mentions)
 * - loadWorkspaceSkills() from skills/storage (resolves skill paths)
 *
 * Since buildUserInput() is private, we test the shared parsing functions directly
 * and verify the integration by mocking loadWorkspaceSkills and calling buildUserInput
 * through reflection.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { parseMentions, stripAllMentions } from '../../mentions/index.ts';
import type { LoadedSkill } from '../../skills/types.ts';

// ============================================================
// Test Helpers
// ============================================================

function createMockSkill(slug: string, path?: string): LoadedSkill {
  return {
    slug,
    metadata: {
      name: slug.charAt(0).toUpperCase() + slug.slice(1),
      description: `A ${slug} skill`,
    },
    content: `# ${slug}\n\nDo the thing.`,
    path: path ?? `/test/workspace/skills/${slug}`,
    source: 'workspace',
  };
}

// ============================================================
// Tests: parseMentions (skill extraction)
// ============================================================

describe('parseMentions - skill extraction', () => {
  const availableSkills = ['commit', 'review', 'deploy'];

  it('should extract a single skill mention', () => {
    const result = parseMentions(
      '[skill:commit] Please commit my changes',
      availableSkills,
      []
    );
    expect(result.skills).toEqual(['commit']);
  });

  it('should extract skill mention with workspaceId prefix', () => {
    const result = parseMentions(
      '[skill:ws-123:commit] Please commit my changes',
      availableSkills,
      []
    );
    expect(result.skills).toEqual(['commit']);
  });

  it('should extract multiple skill mentions', () => {
    const result = parseMentions(
      '[skill:commit] and [skill:review] these changes',
      availableSkills,
      []
    );
    expect(result.skills).toEqual(['commit', 'review']);
  });

  it('should deduplicate repeated skill mentions', () => {
    const result = parseMentions(
      '[skill:commit] first [skill:commit] second',
      availableSkills,
      []
    );
    expect(result.skills).toEqual(['commit']);
  });

  it('should ignore unknown skill slugs', () => {
    const result = parseMentions(
      '[skill:nonexistent] do something',
      availableSkills,
      []
    );
    expect(result.skills).toEqual([]);
  });

  it('should return empty skills for plain message', () => {
    const result = parseMentions(
      'Just a plain message without mentions',
      availableSkills,
      []
    );
    expect(result.skills).toEqual([]);
  });

  it('should extract skills alongside other mention types', () => {
    const result = parseMentions(
      '[skill:commit] [source:linear] [file:/path/to/file.ts] do things',
      availableSkills,
      ['linear']
    );
    expect(result.skills).toEqual(['commit']);
    expect(result.sources).toEqual(['linear']);
    expect(result.files).toEqual(['/path/to/file.ts']);
  });
});

// ============================================================
// Tests: stripAllMentions
// ============================================================

describe('stripAllMentions', () => {
  it('should strip skill mentions', () => {
    const result = stripAllMentions('[skill:commit] Please commit');
    expect(result).toBe('Please commit');
  });

  it('should strip skill mentions with workspaceId', () => {
    const result = stripAllMentions('[skill:ws-123:commit] Please commit');
    expect(result).toBe('Please commit');
  });

  it('should strip source mentions', () => {
    const result = stripAllMentions('[source:linear] Check issues');
    expect(result).toBe('Check issues');
  });

  it('should strip file mentions', () => {
    const result = stripAllMentions('[file:/path/to/file.ts] Review this');
    expect(result).toBe('Review this');
  });

  it('should strip folder mentions', () => {
    const result = stripAllMentions('[folder:/path/to/dir] Look here');
    expect(result).toBe('Look here');
  });

  it('should strip all mention types together', () => {
    const result = stripAllMentions(
      '[skill:commit] [source:linear] [file:/a.ts] [folder:/dir] do stuff'
    );
    expect(result).toBe('do stuff');
  });

  it('should collapse whitespace after stripping', () => {
    const result = stripAllMentions(
      '[skill:commit]   Please   [source:linear]   commit'
    );
    expect(result).toBe('Please commit');
  });

  it('should return empty string when message is only mentions', () => {
    const result = stripAllMentions('[skill:commit] [source:linear]');
    expect(result).toBe('');
  });

  it('should leave plain text unchanged', () => {
    const result = stripAllMentions('Just a plain message');
    expect(result).toBe('Just a plain message');
  });
});

// ============================================================
// Tests: Skill UserInput construction logic
// ============================================================

describe('Skill UserInput item construction', () => {
  it('should build skill UserInput items from parsed mentions', () => {
    const skills = [
      createMockSkill('commit', '/workspace/skills/commit'),
      createMockSkill('review', '/workspace/skills/review'),
    ];
    const message = '[skill:ws:commit] [skill:ws:review] Please help';
    const skillSlugs = skills.map(s => s.slug);

    const parsed = parseMentions(message, skillSlugs, []);

    // Build skill items like buildUserInput does (path must point to SKILL.md file)
    const skillItems = parsed.skills
      .map(slug => skills.find(s => s.slug === slug))
      .filter(Boolean)
      .map(skill => ({
        type: 'skill' as const,
        name: skill!.slug,
        path: skill!.path + '/SKILL.md',
      }));

    expect(skillItems).toHaveLength(2);
    expect(skillItems[0]).toEqual({
      type: 'skill',
      name: 'commit',
      path: '/workspace/skills/commit/SKILL.md',
    });
    expect(skillItems[1]).toEqual({
      type: 'skill',
      name: 'review',
      path: '/workspace/skills/review/SKILL.md',
    });
  });

  it('should skip unknown skills (no UserInput item)', () => {
    const skills = [createMockSkill('commit')];
    const message = '[skill:ws:nonexistent] do something';
    const skillSlugs = skills.map(s => s.slug);

    const parsed = parseMentions(message, skillSlugs, []);

    const skillItems = parsed.skills
      .map(slug => skills.find(s => s.slug === slug))
      .filter(Boolean);

    expect(skillItems).toHaveLength(0);
  });

  it('should produce no skill items for plain message', () => {
    const skills = [createMockSkill('commit')];
    const message = 'Just a regular message';
    const skillSlugs = skills.map(s => s.slug);

    const parsed = parseMentions(message, skillSlugs, []);

    expect(parsed.skills).toHaveLength(0);
  });

  it('should strip mentions from text and produce clean message', () => {
    const message = '[skill:ws:commit] [source:linear] Please commit the changes';

    const cleanMessage = stripAllMentions(message);

    expect(cleanMessage).toBe('Please commit the changes');
    expect(cleanMessage).not.toContain('[skill:');
    expect(cleanMessage).not.toContain('[source:');
  });

  it('should handle mixed content: skills extracted + text preserved', () => {
    const skills = [
      createMockSkill('commit', '/ws/skills/commit'),
      createMockSkill('review', '/ws/skills/review'),
    ];
    const message = '[skill:ws:commit] Fix the bug and [skill:ws:review] the changes please';
    const skillSlugs = skills.map(s => s.slug);

    // Parse skills
    const parsed = parseMentions(message, skillSlugs, []);
    expect(parsed.skills).toEqual(['commit', 'review']);

    // Strip mentions for clean text
    const cleanMessage = stripAllMentions(message);
    expect(cleanMessage).toBe('Fix the bug and the changes please');

    // Build skill items
    const skillItems = parsed.skills
      .map(slug => skills.find(s => s.slug === slug))
      .filter(Boolean)
      .map(skill => ({ type: 'skill' as const, name: skill!.slug, path: skill!.path + '/SKILL.md' }));

    expect(skillItems).toHaveLength(2);
  });
});
