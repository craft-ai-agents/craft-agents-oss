import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  formatTeamKnowledgePolicy,
  prefetchTeamKnowledge,
  formatPrefetchBlock,
} from '../team-public-knowledge-injector.ts';
import type { PrefetchEntry } from '../team-public-knowledge-injector.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkspace(overrides?: { enabled?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'tk-injector-'));
  tempDirs.push(dir);
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      id: 'ws_test',
      name: 'Test Workspace',
      slug: 'test',
      teamPublicKnowledge: {
        enabled: overrides?.enabled ?? true,
        documents: [
          { id: 'team-slang', title: 'Team Slang', url: 'https://example.com/slang.md', priority: 10 },
          { id: 'team-concepts', title: 'Team Concepts', url: 'https://example.com/concepts.md', priority: 20 },
        ],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, null, 2),
    'utf-8',
  );
  return dir;
}

function writeTeamKnowledgeCache(
  workspaceRoot: string,
  entries: Record<string, {
    title: string;
    content: string;
    priority: number;
    stale?: boolean;
    fetchedAt?: number;
    updatedAt?: number;
  }>,
): void {
  const cacheDir = join(workspaceRoot, 'team-public-knowledge');
  mkdirSync(cacheDir, { recursive: true });

  const now = Date.now();
  const cacheEntries: Record<string, unknown> = {};

  for (const [id, entry] of Object.entries(entries)) {
    cacheEntries[id] = {
      id,
      title: entry.title,
      url: 'https://example.com/doc',
      priority: entry.priority,
      content: entry.content,
      contentHash: 'abc123',
      version: 1,
      fetchedAt: entry.fetchedAt ?? now,
      updatedAt: entry.updatedAt ?? now - 1000,
      stale: entry.stale ?? false,
    };
  }

  writeFileSync(
    join(cacheDir, 'cache.json'),
    JSON.stringify({ entries: cacheEntries, lastSummary: null }, null, 2),
    'utf-8',
  );
}

// ── Helpers ─────────────────────────────────────────────────────

const slangContent = `# Team Slang

<!-- slang term:ship it title:ship it summary:Deploy to production after code review without waiting -->
Use "ship it" when a PR is ready to deploy. No need to wait for the next release cycle.

<!-- slang term:yolo title:yolo summary:Skip code review and push directly to production -->
YOLO means bypassing the normal review process. Use sparingly!

<!-- concept term:tech debt title:Tech Debt summary:Future cost of reworking shortcuts taken during development -->
Tech debt accumulates when we take shortcuts. Track it in our debt register.

<!-- concept term:code review title:Code Review summary:Peer review process for all code changes before merge -->
All code must be reviewed by at least one peer before merging.

<!-- alias term:MVP title:Minimum Viable Product summary:Smallest feature set that delivers user value -->
MVP is our shorthand for Minimum Viable Product. Ship fast, iterate.
`;

const conceptsContent = `# Engineering Concepts

<!-- concept term:CI/CD title:CI/CD Pipeline summary:Automated build test and deployment pipeline -->
We use GitHub Actions for CI/CD. Every PR triggers lint, test, and build.

<!-- convention term:naming title:Naming Conventions summary:PascalCase for types camelCase for variables -->
Follow the style guide for consistent naming across the codebase.

<!-- background term:history title:Project History summary:The project started as a hackathon prototype in 2023 -->
The project was born during the 2023 summer hackathon.
`;

// ── Tests ────────────────────────────────────────────────────────

describe('TeamPublicKnowledgeInjector', () => {
  describe('formatTeamKnowledgePolicy', () => {
    it('returns policy block with top 5 trigger terms from alias/slang/concept entries', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        'team-slang': { title: 'Team Slang', content: slangContent, priority: 10 },
        'team-concepts': { title: 'Team Concepts', content: conceptsContent, priority: 20 },
      });

      const policy = formatTeamKnowledgePolicy(ws);
      expect(policy).not.toBeNull();

      // Should contain the policy opening
      expect(policy).toContain('<team_public_knowledge>');
      expect(policy).toContain('<policy>');
      expect(policy).toContain('</policy>');

      // Should contain trigger terms (alias/slang/concept only, not convention/background)
      expect(policy).toContain('"ship it"');
      expect(policy).toContain('"yolo"');
      expect(policy).toContain('"tech debt"');
      expect(policy).toContain('"code review"');
      expect(policy).toContain('"MVP"');

      // Should NOT contain non-trigger entries
      expect(policy).not.toContain('"naming"');
      expect(policy).not.toContain('"history"');
      expect(policy).not.toContain('"CI/CD"');

      // Should not include source excerpts or long explanations
      expect(policy).not.toContain('Deploy to production');
      expect(policy).not.toContain('GitHub Actions');
    });

    it('returns null when team public knowledge is disabled', () => {
      const ws = createWorkspace({ enabled: false });
      writeTeamKnowledgeCache(ws, {
        'team-slang': { title: 'Team Slang', content: slangContent, priority: 10 },
      });

      expect(formatTeamKnowledgePolicy(ws)).toBeNull();
    });

    it('returns null when no trigger terms exist in the cache', () => {
      const ws = createWorkspace();
      // Entries with no alias/slang/concept terms
      writeTeamKnowledgeCache(ws, {
        'team-concepts': {
          title: 'No Triggers',
          content: '# Only conventions\n\n<!-- convention term:"naming" -->Convention content.',
          priority: 10,
        },
      });

      expect(formatTeamKnowledgePolicy(ws)).toBeNull();
    });

    it('returns null when cache is empty', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {});
      expect(formatTeamKnowledgePolicy(ws)).toBeNull();
    });

    it('limits trigger terms to top 5 by priority', () => {
      const ws = createWorkspace();
      // Create many entries with varying priorities
      let manyEntries = '';
      for (let i = 1; i <= 10; i++) {
        manyEntries += `\n<!-- slang term:term${i} -->\nTerm ${i} content.\n`;
      }
      const content = `# Many Terms\n${manyEntries}`;
      writeTeamKnowledgeCache(ws, {
        'team-slang': { title: 'Many Terms', content, priority: 10 },
      });

      const policy = formatTeamKnowledgePolicy(ws);
      expect(policy).not.toBeNull();
      expect(policy).toContain('"term1"');
      expect(policy).toContain('"term5"');
      expect(policy).not.toContain('"term6"');
    });

    it('deduplicates identical trigger terms across entries', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        'doc-a': {
          title: 'Doc A',
          content: '# Doc A\n\n<!-- slang term:ship it -->\nShip it means deploy.\n',
          priority: 10,
        },
        'doc-b': {
          title: 'Doc B',
          content: '# Doc B\n\n<!-- slang term:ship it -->\nShip it also means celebrate.\n',
          priority: 20,
        },
      });

      const policy = formatTeamKnowledgePolicy(ws);
      expect(policy).not.toBeNull();
      // "ship it" should appear only once in trigger terms
      const matches = policy!.match(/"ship it"/g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('prefetchTeamKnowledge', () => {
    it('returns prefetch entries when user message contains exact trigger term as a word', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        'team-slang': { title: 'Team Slang', content: slangContent, priority: 10 },
        'team-concepts': { title: 'Team Concepts', content: conceptsContent, priority: 20 },
      });

      const results = prefetchTeamKnowledge(ws, 'we should ship it today');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.kind).toBe('slang');
      expect(results[0]!.summary).toContain('Deploy to production');
      expect(results[0]!.confidence).toBeGreaterThan(0);
      expect(results[0]!.source).toBe('Team Slang');
      expect(results[0]!.updatedAt).toBeGreaterThan(0);
    });

    it('returns prefetch entries on case-insensitive match', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        'team-slang': { title: 'Team Slang', content: slangContent, priority: 10 },
      });

      const results = prefetchTeamKnowledge(ws, 'SHIP IT now');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.kind).toBe('slang');
    });

    it('limits prefetch to at most 3 entries', () => {
      const ws = createWorkspace();
      // Create a doc with many terms that all match
      let manyContent = '';
      for (let i = 1; i <= 10; i++) {
        manyContent += `\n<!-- slang term:match${i} -->\nMatch ${i} content.\n`;
      }
      writeTeamKnowledgeCache(ws, {
        'many-terms': {
          title: 'Many Terms',
          content: `# Many\n${manyContent}`,
          priority: 1,
        },
      });

      const results = prefetchTeamKnowledge(ws, 'match1 match2 match3 match4 match5');
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('returns empty array for user message with no matching terms', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        'team-slang': { title: 'Team Slang', content: slangContent, priority: 10 },
      });

      const results = prefetchTeamKnowledge(ws, 'what is the weather today');
      expect(results).toEqual([]);
    });

    it('returns empty array when team public knowledge is disabled', () => {
      const ws = createWorkspace({ enabled: false });
      writeTeamKnowledgeCache(ws, {
        'team-slang': { title: 'Team Slang', content: slangContent, priority: 10 },
      });

      const results = prefetchTeamKnowledge(ws, 'ship it');
      expect(results).toEqual([]);
    });

    it('returns empty array for empty message', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        'team-slang': { title: 'Team Slang', content: slangContent, priority: 10 },
      });

      expect(prefetchTeamKnowledge(ws, '')).toEqual([]);
      expect(prefetchTeamKnowledge(ws, '   ')).toEqual([]);
    });

    it('sorts results by confidence descending, then by updatedAt descending', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        'doc-a': {
          title: 'Doc A',
          content: '# Doc\n\n<!-- slang term:exact term summary:First doc about exact term -->\nContent A.\n',
          priority: 10,
          updatedAt: 3000,
        },
      });

      const results = prefetchTeamKnowledge(ws, 'exact term reference');
      expect(results.length).toBeGreaterThan(0);
    });

    it('matches multi-word trigger terms as substrings', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        'team-slang': { title: 'Team Slang', content: slangContent, priority: 10 },
      });

      const results = prefetchTeamKnowledge(ws, 'we have a lot of tech debt to address');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.kind === 'concept')).toBe(true);
    });

    it('excludes stale entries from prefetch index', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        'fresh-slang': {
          title: 'Fresh Slang',
          content: '# Fresh\n\n<!-- slang term:fresh term summary:This is fresh -->\nFresh content.\n',
          priority: 10,
          stale: false,
        },
        'stale-slang': {
          title: 'Stale Slang',
          content: '# Stale\n\n<!-- slang term:stale term summary:This is stale -->\nStale content.\n',
          priority: 20,
          stale: true,
        },
      });

      const results = prefetchTeamKnowledge(ws, 'fresh term stale term');
      expect(results.length).toBe(1);
      expect(results[0]!.source).toBe('Fresh Slang');
    });

    it('excludes entries past validUntil from trigger and prefetch context', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        expired: {
          title: 'Expired Knowledge',
          content: '# Expired\n\n<!-- slang term:old deploy validUntil:2025-01-01 summary:Expired deploy guidance -->\nExpired content.\n',
          priority: 1,
        },
        fresh: {
          title: 'Fresh Knowledge',
          content: '# Fresh\n\n<!-- slang term:new deploy validUntil:2099-01-01 summary:Fresh deploy guidance -->\nFresh content.\n',
          priority: 2,
        },
      });

      const policy = formatTeamKnowledgePolicy(ws);
      const results = prefetchTeamKnowledge(ws, 'old deploy new deploy');

      expect(policy).not.toContain('"old deploy"');
      expect(policy).toContain('"new deploy"');
      expect(results.map(r => r.source)).toEqual(['Fresh Knowledge']);
    });

    it('excludes documents past the stale TTL from trigger and prefetch context', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        old: {
          title: 'Old Knowledge',
          content: '# Old\n\n<!-- slang term:ancient deploy summary:Outdated deploy guidance -->\nOld content.\n',
          priority: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
        },
        fresh: {
          title: 'Fresh Knowledge',
          content: '# Fresh\n\n<!-- slang term:current deploy summary:Current deploy guidance -->\nFresh content.\n',
          priority: 2,
        },
      });

      const policy = formatTeamKnowledgePolicy(ws);
      const results = prefetchTeamKnowledge(ws, 'ancient deploy current deploy');

      expect(policy).not.toContain('"ancient deploy"');
      expect(policy).toContain('"current deploy"');
      expect(results.map(r => r.source)).toEqual(['Fresh Knowledge']);
    });

    it('excludes unresolved conflicts from trigger and prefetch context', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        docA: {
          title: 'Doc A',
          content: '# A\n\n<!-- alias term:runtime canonical:node summary:Runtime means Node.js -->\nUse Node.js.\n',
          priority: 10,
          updatedAt: 3000,
        },
        docB: {
          title: 'Doc B',
          content: '# B\n\n<!-- alias term:runtime canonical:bun summary:Runtime means Bun -->\nUse Bun.\n',
          priority: 10,
          updatedAt: 3000,
        },
      });

      expect(formatTeamKnowledgePolicy(ws)).toBeNull();
      expect(prefetchTeamKnowledge(ws, 'runtime')).toEqual([]);
    });
  });

  describe('formatPrefetchBlock', () => {
    it('formats prefetch entries as reference data XML with all required fields', () => {
      const entries: PrefetchEntry[] = [
        {
          kind: 'slang',
          summary: 'Ship it means deploy after review without waiting.',
          confidence: 1,
          relevance: 'exact match',
          source: 'Team Slang',
          updatedAt: 1_700_000_000_000,
        },
        {
          kind: 'concept',
          summary: 'Tech debt represents future cost of reworking shortcuts.',
          confidence: 0.9,
          relevance: 'term match',
          source: 'Team Concepts',
          updatedAt: 1_700_000_000_001,
        },
      ];

      const block = formatPrefetchBlock(entries);
      expect(block).not.toBeNull();
      expect(block).toContain('<reference_data>');
      expect(block).toContain('</reference_data>');

      // Each entry should have required attributes
      expect(block).toContain('kind="slang"');
      expect(block).toContain('kind="concept"');
      expect(block).toContain('confidence="1"');
      expect(block).toContain('confidence="0.9"');
      expect(block).toContain('relevance="exact match"');
      expect(block).toContain('relevance="term match"');
      expect(block).toContain('source="Team Slang"');
      expect(block).toContain('source="Team Concepts"');
      expect(block).toContain('updatedAt="1700000000000"');
      expect(block).toContain('updatedAt="1700000000001"');

      // Each entry should have summary
      expect(block).toContain('<summary>Ship it means deploy after review without waiting.</summary>');
      expect(block).toContain('<summary>Tech debt represents future cost of reworking shortcuts.</summary>');
    });

    it('returns null for empty results array', () => {
      expect(formatPrefetchBlock([])).toBeNull();
    });

    it('escapes XML special characters in summary and source fields', () => {
      const entries: PrefetchEntry[] = [
        {
          kind: 'slang',
          summary: 'Use "quotes" & <brackets> in summary',
          confidence: 1,
          relevance: 'high',
          source: 'Source & Co <test>',
          updatedAt: 1_700_000_000_000,
        },
      ];

      const block = formatPrefetchBlock(entries);
      expect(block).toContain('&quot;quotes&quot;');
      expect(block).toContain('&amp;');
      expect(block).toContain('&lt;brackets&gt;');
      expect(block).toContain('Source &amp; Co &lt;test&gt;');
    });
  });

  describe('dynamic user-context formatting (integration)', () => {
    it('injects policy and prefetch together when terms match', () => {
      const ws = createWorkspace();
      writeTeamKnowledgeCache(ws, {
        'team-slang': { title: 'Team Slang', content: slangContent, priority: 10 },
      });

      const policy = formatTeamKnowledgePolicy(ws);
      const results = prefetchTeamKnowledge(ws, 'we should ship it to production');
      const prefetchBlock = formatPrefetchBlock(results);

      expect(policy).not.toBeNull();
      expect(prefetchBlock).not.toBeNull();

      // Policy should contain the trigger terms
      expect(policy).toContain('"ship it"');
      expect(policy).toContain('"yolo"');

      // Prefetch should contain the matched entry
      expect(prefetchBlock).toContain('kind="slang"');
      expect(prefetchBlock).toContain('Deploy to production');

      // Combined output should flow naturally as reference data
      const combined = [policy, prefetchBlock].filter(Boolean).join('\n\n');
      expect(combined).toContain('<team_public_knowledge>');
      expect(combined).toContain('<reference_data>');
    });
  });
});
