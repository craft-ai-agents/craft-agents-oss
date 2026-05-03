import { describe, it, expect } from 'bun:test';
import type {
  SessionToolContext,
  ListSkillsOptions,
  ListSkillsResult,
} from '../context.ts';
import { handleListSkills } from './list-skills.ts';

function makeCtx(listSkills?: (options?: ListSkillsOptions) => ListSkillsResult): SessionToolContext {
  const ctx: Partial<SessionToolContext> = {
    sessionId: 't',
    workspacePath: '/tmp',
    plansFolderPath: '/tmp/plans',
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: {
      exists: () => false,
      readFile: () => '',
      readFileBuffer: () => Buffer.from(''),
      writeFile: () => {},
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
    get sourcesPath() { return '/tmp/sources'; },
    get skillsPath() { return '/tmp/skills'; },
  };
  if (listSkills) ctx.listSkills = listSkills;
  return ctx as SessionToolContext;
}

describe('handleListSkills', () => {
  it('returns an error when listSkills is not wired into the context', async () => {
    const result = await handleListSkills(makeCtx(), {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not available');
  });

  it('passes options through to the injected callback verbatim', async () => {
    let captured: ListSkillsOptions | undefined;
    const ctx = makeCtx((options) => {
      captured = options;
      return { total: 0, returned: 0, skills: [] };
    });

    await handleListSkills(ctx, { activeOnly: true, search: 'foo', tags: ['research'] });

    expect(captured).toEqual({ activeOnly: true, search: 'foo', tags: ['research'] });
  });

  it('returns the JSON-serialized result on success', async () => {
    const ctx = makeCtx(() => ({
      total: 2,
      returned: 2,
      skills: [
        {
          slug: 'commit',
          name: 'Git Commit',
          description: 'Helps with commits',
          source: 'workspace',
          active: true,
          tags: ['git'],
        },
        {
          slug: 'web-search',
          name: 'Web Search',
          description: 'Searches the web',
          source: 'global-dormant',
          active: false,
          tags: ['research'],
        },
      ],
    }));

    const result = await handleListSkills(ctx, {});
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.total).toBe(2);
    expect(parsed.skills).toHaveLength(2);
    expect(parsed.skills[1].source).toBe('global-dormant');
    expect(parsed.skills[1].active).toBe(false);
  });

  it('surfaces thrown errors as a tool error response', async () => {
    const ctx = makeCtx(() => {
      throw new Error('listSkills exploded');
    });

    const result = await handleListSkills(ctx, {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('listSkills exploded');
  });
});
