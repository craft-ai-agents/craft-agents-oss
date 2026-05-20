/**
 * Tests for suggest_team_public_knowledge handler.
 *
 * Verifies message-level suggestions across team public knowledge entries
 * without requiring an explicit slang or alias term.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleSuggestTeamPublicKnowledge } from './suggest-team-public-knowledge.ts';

function createCtx(workspacePath: string) {
  return {
    sessionId: 'test-session',
    workspacePath,
    get sourcesPath() { return join(workspacePath, 'sources'); },
    get skillsPath() { return join(workspacePath, 'skills'); },
    plansFolderPath: join(workspacePath, 'plans'),
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: (path: string) => existsSync(path),
      readFile: (path: string) => readFileSync(path, 'utf-8'),
      readFileBuffer: (path: string) => readFileSync(path),
      writeFile: (path: string, content: string) => writeFileSync(path, content),
      isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
      readdir: (path: string) => readdirSync(path),
      stat: (path: string) => {
        const s = statSync(path);
        return { size: s.size, isDirectory: () => s.isDirectory() };
      },
    },
    loadSourceConfig: () => null,
    validators: undefined,
  } as const;
}

function writeCache(workspacePath: string, cache: unknown): void {
  const dir = join(workspacePath, 'team-public-knowledge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cache.json'), JSON.stringify(cache, null, 2));
}

describe('suggest_team_public_knowledge', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'suggest-knowledge-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('suggests relevant knowledge from a full message without an explicit term', async () => {
    writeCache(tempDir, {
      entries: {
        handbook: {
          id: 'handbook',
          title: 'Team Handbook',
          url: 'https://example.com/handbook',
          priority: 1,
          content: `# Delivery

<!-- process id:release-checklist title:发布检查 summary:生产发布需要审批 tags:release scope:backend -->
生产发布前要运行 typecheck 和集成测试，并找发布负责人审批。

<!-- background id:lunch -->
Lunch is usually around noon.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: Date.now(),
          updatedAt: Date.now(),
          stale: false,
        },
      },
    });

    const result = await handleSuggestTeamPublicKnowledge(createCtx(tempDir), {
      message: '我们这边一般怎么做生产发布审批？',
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '');

    expect(result.isError).toBeFalsy();
    expect(parsed.suggestions).toHaveLength(1);
    expect(parsed.suggestions[0]).toMatchObject({
      id: 'release-checklist',
      kind: 'process',
      source: 'Team Handbook',
      scope: 'backend',
    });
    expect(parsed.suggestions[0].confidence).toBeGreaterThan(0);
    expect(parsed.suggestions[0].relevance).toBeGreaterThan(0);
    expect(parsed.suggestions[0].matchReason).toContain('message');
  });

  it('ranks relevant rules and warnings ahead of ordinary entries', async () => {
    writeCache(tempDir, {
      entries: {
        handbook: {
          id: 'handbook',
          title: 'Team Handbook',
          url: 'https://example.com/handbook',
          priority: 1,
          content: `# Delivery

<!-- convention id:deploy-convention title:Deploy convention summary:Deploys use the release queue tags:release -->
Use the release queue for production deploy requests.

<!-- warning id:deploy-freeze title:Production deploy freeze summary:Do not deploy during the payment reconciliation window tags:release,payments -->
Payment reconciliation runs on Friday afternoon. Production deploys are blocked during that window.

<!-- background id:release-history title:Release history summary:Background on how release ownership evolved tags:release -->
The release owner role started last year.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: Date.now(),
          updatedAt: Date.now(),
          stale: false,
        },
      },
    });

    const result = await handleSuggestTeamPublicKnowledge(createCtx(tempDir), {
      message: 'Can I do a production deploy during payment reconciliation?',
      limit: 3,
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '');

    expect(parsed.suggestions.map((s: any) => s.id)[0]).toBe('deploy-freeze');
    expect(parsed.suggestions.map((s: any) => s.kind)).toContain('convention');
  });

  it('enforces the default limit and maximum limit of five', async () => {
    let content = '# Items\n';
    for (let i = 1; i <= 8; i++) {
      content += `\n<!-- process id:item-${i} title:Deploy item ${i} summary:Production deploy checklist item ${i} -->\nProduction deploy checklist item ${i}.\n`;
    }
    writeCache(tempDir, {
      entries: {
        handbook: {
          id: 'handbook',
          title: 'Team Handbook',
          url: 'https://example.com/handbook',
          priority: 1,
          content,
          contentHash: 'abc',
          version: 1,
          fetchedAt: Date.now(),
          updatedAt: Date.now(),
          stale: false,
        },
      },
    });

    const defaultResult = await handleSuggestTeamPublicKnowledge(createCtx(tempDir), {
      message: 'production deploy checklist',
    });
    const maxResult = await handleSuggestTeamPublicKnowledge(createCtx(tempDir), {
      message: 'production deploy checklist',
      limit: 99,
    });

    expect(JSON.parse(defaultResult.content[0]?.text ?? '').suggestions).toHaveLength(3);
    expect(JSON.parse(maxResult.content[0]?.text ?? '').suggestions).toHaveLength(5);
  });

  it('excludes low-relevance and stale entries from default suggestions', async () => {
    writeCache(tempDir, {
      entries: {
        fresh: {
          id: 'fresh',
          title: 'Fresh Handbook',
          url: 'https://example.com/fresh',
          priority: 1,
          content: `# Fresh

<!-- rule id:api-auth title:API authentication summary:Always authenticate API requests tags:security -->
API requests must include authentication headers.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: Date.now(),
          updatedAt: Date.now(),
          stale: false,
        },
        stale: {
          id: 'stale',
          title: 'Stale Handbook',
          url: 'https://example.com/stale',
          priority: 1,
          content: `# Stale

<!-- warning id:old-api-auth title:Old API auth warning summary:Old API authentication warning tags:security -->
API authentication used to require a legacy header.`,
          contentHash: 'def',
          version: 1,
          fetchedAt: Date.now(),
          updatedAt: Date.now(),
          stale: true,
          staleAt: Date.now(),
        },
      },
    });

    const result = await handleSuggestTeamPublicKnowledge(createCtx(tempDir), {
      message: 'How should API requests authenticate?',
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '');

    expect(parsed.suggestions.map((s: any) => s.id)).toEqual(['api-auth']);
  });

  it('keeps confidence distinct from message relevance when ranking suggestions', async () => {
    writeCache(tempDir, {
      entries: {
        handbook: {
          id: 'handbook',
          title: 'Team Handbook',
          url: 'https://example.com/handbook',
          priority: 1,
          content: `# Knowledge

<!-- slang id:ship-it term:ship it summary:Deploy to production after approval -->
Deploy to production after approval.

<!-- rule id:approval-rule title:Production approval rule summary:Production deploys require approval from the release owner tags:release -->
Production deploys require approval from the release owner before rollout.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: Date.now(),
          updatedAt: Date.now(),
          stale: false,
        },
      },
    });

    const result = await handleSuggestTeamPublicKnowledge(createCtx(tempDir), {
      message: 'ship it production deploy approval release owner',
      limit: 2,
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '');

    expect(parsed.suggestions[0].id).toBe('approval-rule');
    expect(parsed.suggestions[1].id).toBe('ship-it');
    expect(parsed.suggestions[1].confidence).toBeGreaterThan(parsed.suggestions[0].confidence);
    expect(parsed.suggestions[0].relevance).toBeGreaterThan(parsed.suggestions[1].relevance);
  });
});
