import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { parseMarkdownEntries } from '../index.ts';

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

describe('markdown entry parser', () => {
  // ── Edge cases ────────────────────────────────────────────────
  describe('edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(parseMarkdownEntries('')).toEqual([]);
    });

    it('returns empty array for whitespace-only string', () => {
      expect(parseMarkdownEntries('   \n\n  \n ')).toEqual([]);
    });

    it('returns empty array for headings without body content', () => {
      const md = '# Empty\n\n## Also Empty\n\n### Nothing\n';
      expect(parseMarkdownEntries(md)).toEqual([]);
    });

    it('splits non-heading text by paragraphs into concept entries', () => {
      const md = 'Just a paragraph of text.\n\nAnother paragraph.';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(2);
      expect(entries[0]!.kind).toBe('concept');
      expect(entries[0]!.content).toBe('Just a paragraph of text.');
      expect(entries[1]!.content).toBe('Another paragraph.');
      expect(entries[0]!.headingPath).toEqual([]);
    });
  });

  // ── Explicit markers ──────────────────────────────────────────
  describe('explicit markers', () => {
    it('parses an alias marker with term and canonical', () => {
      const md = '<!-- alias term:onboarding-flow canonical:user-onboarding-guide -->\nOnboarding flow is also known as the user onboarding guide.';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.kind).toBe('alias');
      expect(entries[0]!.term).toBe('onboarding-flow');
      expect(entries[0]!.canonical).toBe('user-onboarding-guide');
      expect(entries[0]!.content).toBe('Onboarding flow is also known as the user onboarding guide.');
    });

    it('parses a slang marker with term and canonical', () => {
      const md = '<!-- slang term:afk canonical:away-from-keyboard -->\nAFK means Away From Keyboard.';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.kind).toBe('slang');
      expect(entries[0]!.term).toBe('afk');
      expect(entries[0]!.canonical).toBe('away-from-keyboard');
    });

    it('parses a concept marker with title and summary', () => {
      const md = '<!-- concept title:Frontend Architecture summary:The React-based UI layer -->\nThe frontend uses React 18 with TypeScript. State is managed via React context.';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.kind).toBe('concept');
      expect(entries[0]!.title).toBe('Frontend Architecture');
      expect(entries[0]!.summary).toBe('The React-based UI layer');
    });

    it('parses a convention marker with title and summary', () => {
      const md = '<!-- convention title:Naming Convention summary:PascalCase for components -->\nAll React components must use PascalCase names.';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.kind).toBe('convention');
      expect(entries[0]!.title).toBe('Naming Convention');
      expect(entries[0]!.summary).toBe('PascalCase for components');
    });

    it('parses a rule marker with title and summary', () => {
      const md = '<!-- rule title:Auth Required summary:All endpoints require auth -->\nAll API endpoints must require authentication.';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.kind).toBe('rule');
      expect(entries[0]!.title).toBe('Auth Required');
    });

    it('parses a warning marker with title and summary', () => {
      const md = '<!-- warning title:Deprecated API summary:Use v2 instead -->\nThe v1 API is deprecated and will be removed in Q3.';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.kind).toBe('warning');
      expect(entries[0]!.title).toBe('Deprecated API');
      expect(entries[0]!.summary).toBe('Use v2 instead');
    });

    it('parses a process marker', () => {
      const md = '<!-- process title:Deploy Flow summary:Steps to deploy -->\n1. Merge PR\n2. Wait for CI\n3. Deploy to prod';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.kind).toBe('process');
      expect(entries[0]!.title).toBe('Deploy Flow');
    });

    it('parses a background marker', () => {
      const md = '<!-- background title:Why Monorepo summary:Scaling the codebase -->\nWe chose a monorepo to share types and utilities across packages.';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.kind).toBe('background');
      expect(entries[0]!.title).toBe('Why Monorepo');
    });
  });

  // ── Metadata parsing ──────────────────────────────────────────
  describe('metadata parsing', () => {
    it('parses optional id from marker', () => {
      const md = '<!-- concept id:frontend-arch -->\nFrontend architecture details.';
      const entries = parseMarkdownEntries(md);
      expect(entries[0]!.metadata.id).toBe('frontend-arch');
    });

    it('parses tags as comma-separated list', () => {
      const md = '<!-- rule tags:security,authentication,best-practice id:auth-rule -->\nAlways authenticate.';
      const entries = parseMarkdownEntries(md);
      expect(entries[0]!.metadata.tags).toEqual(['security', 'authentication', 'best-practice']);
    });

    it('parses scope from marker', () => {
      const md = '<!-- concept scope:engineering -->\nEngineering guidelines.';
      const entries = parseMarkdownEntries(md);
      expect(entries[0]!.metadata.scope).toBe('engineering');
    });

    it('parses defaults as key/value pairs in braces', () => {
      const md = '<!-- rule defaults:{timeRange:30m,env:prod} -->\nUse these defaults.';
      const entries = parseMarkdownEntries(md);
      expect(entries[0]!.metadata.defaults).toEqual({ timeRange: '30m', env: 'prod' });
    });

    it('parses validUntil as a date string', () => {
      const md = '<!-- rule validUntil:2025-12-31 -->\nValid until end of year.';
      const entries = parseMarkdownEntries(md);
      expect(entries[0]!.metadata.validUntil).toBe('2025-12-31');
    });

    it('parses all metadata fields in one marker', () => {
      const md = `<!-- alias id:alias-1 tags:migration,legacy scope:backend defaults:{retryCount:3} validUntil:2025-06-30 term:old-system canonical:new-system -->\nOld system is now called new-system.`;
      const entries = parseMarkdownEntries(md);
      expect(entries[0]!.metadata).toEqual({
        id: 'alias-1',
        tags: ['migration', 'legacy'],
        scope: 'backend',
        defaults: { retryCount: '3' },
        validUntil: '2025-06-30',
      });
      expect(entries[0]!.term).toBe('old-system');
      expect(entries[0]!.canonical).toBe('new-system');
    });
  });

  // ── Heading path tracking ─────────────────────────────────────
  describe('heading path tracking', () => {
    it('tracks a single h1 heading path', () => {
      const md = '# Team Wiki\n\n<!-- concept -->\nContent here.';
      const entries = parseMarkdownEntries(md);
      expect(entries[0]!.headingPath).toEqual(['Team Wiki']);
    });

    it('tracks nested heading paths (h1 > h2 > h3)', () => {
      const md = '# Guide\n\n## Architecture\n\n### Frontend\n\n<!-- concept -->\nReact with TypeScript.\n\n### Backend\n\n<!-- concept -->\nNode.js with Express.';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(2);
      expect(entries[0]!.headingPath).toEqual(['Guide', 'Architecture', 'Frontend']);
      expect(entries[1]!.headingPath).toEqual(['Guide', 'Architecture', 'Backend']);
    });

    it('handles sibling headings under the same parent', () => {
      const md = '# Project\n\n## Setup\n\n<!-- concept -->\nInstall steps.\n\n## Deployment\n\n<!-- concept -->\nDeploy steps.';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(2);
      expect(entries[0]!.headingPath).toEqual(['Project', 'Setup']);
      expect(entries[1]!.headingPath).toEqual(['Project', 'Deployment']);
    });
  });

  // ── Multiple markers in one section ───────────────────────────
  describe('multiple markers in one section', () => {
    it('creates separate entries for multiple markers in one section', () => {
      const md = '# Rules\n\n<!-- rule id:rule-1 tags:typescript -->\nAlways use strict mode.\n\n<!-- rule id:rule-2 tags:testing -->\nAlways write tests.';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(2);
      expect(entries[0]!.metadata.id).toBe('rule-1');
      expect(entries[0]!.content).toBe('Always use strict mode.');
      expect(entries[0]!.headingPath).toEqual(['Rules']);
      expect(entries[1]!.metadata.id).toBe('rule-2');
      expect(entries[1]!.content).toBe('Always write tests.');
      expect(entries[1]!.headingPath).toEqual(['Rules']);
    });
  });

  // ── Unmarked content ──────────────────────────────────────────
  describe('unmarked content fallback', () => {
    it('splits unmarked section content by paragraphs', () => {
      const md = '# Notes\n\nFirst note paragraph.\n\nSecond note paragraph.\n\nThird paragraph.';
      const entries = parseMarkdownEntries(md);
      expect(entries).toHaveLength(3);
      expect(entries[0]!.kind).toBe('concept');
      expect(entries[0]!.content).toBe('First note paragraph.');
      expect(entries[0]!.headingPath).toEqual(['Notes']);
      expect(entries[1]!.kind).toBe('concept');
      expect(entries[1]!.content).toBe('Second note paragraph.');
      expect(entries[2]!.content).toBe('Third paragraph.');
    });

    it('splits unmarked table sections by table rows', () => {
      const md = '# Slang Terms\n\n| Slang | Formal |\n|-------|--------|\n| AFK | Away From Keyboard |\n| BRB | Be Right Back |\n| LGTM | Looks Good To Me |';
      const entries = parseMarkdownEntries(md);
      // Only header row and data rows are present; header row is skipped
      expect(entries).toHaveLength(3);
      expect(entries[0]!.kind).toBe('concept');
      expect(entries[0]!.content).toContain('AFK');
      expect(entries[0]!.content).toContain('Away From Keyboard');
      expect(entries[0]!.headingPath).toEqual(['Slang Terms']);
      expect(entries[1]!.content).toContain('BRB');
      expect(entries[2]!.content).toContain('LGTM');
    });
  });

  // ── Source metadata ───────────────────────────────────────────
  describe('source metadata', () => {
    it('records sourceDocId, sourceTitle, updatedAt, contentHash, and priority', () => {
      const md = '# Docs\n\n<!-- rule -->\nAlways authenticate.';
      const entries = parseMarkdownEntries(md, {
        sourceDocId: 'doc-1',
        sourceTitle: 'Team Rules',
        updatedAt: 1_000_000,
        priority: 10,
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.sourceDocId).toBe('doc-1');
      expect(entries[0]!.sourceTitle).toBe('Team Rules');
      expect(entries[0]!.updatedAt).toBe(1_000_000);
      expect(entries[0]!.priority).toBe(10);
      expect(entries[0]!.contentHash).toBe(sha256('Always authenticate.'));
    });

    it('computes contentHash from entry content', () => {
      const md = '# Section\n\nContent to hash.';
      const entries = parseMarkdownEntries(md);
      expect(entries[0]!.contentHash).toBe(sha256('Content to hash.'));
    });
  });

  // ── Mixed document ────────────────────────────────────────────
  describe('mixed document', () => {
    it('handles a mix of marked and unmarked sections', () => {
      const md = '# Team Wiki\n\n## Concepts\n\n<!-- concept title:Reactive System -->\nA system that reacts to events.\n\n## Slang\n\n| Slang | Meaning |\n|-------|--------|\n| WIP | Work In Progress |\n| ETA | Estimated Time of Arrival |\n\n## Rules\n\n<!-- rule id:no-direct-db -->\nNever access the database directly from controllers.\n\nAlways use the repository pattern.\n\n<!-- rule id:log-all-errors -->\nLog all errors with stack traces.';
      const entries = parseMarkdownEntries(md);

      // Concepts: 1 marked entry; Slang: 2 table row entries; Rules: 2 marked entries
      // Content between markers belongs to the preceding marker

      expect(entries).toHaveLength(5);

      // Concept entry
      expect(entries[0]!.headingPath).toEqual(['Team Wiki', 'Concepts']);
      expect(entries[0]!.kind).toBe('concept');
      expect(entries[0]!.title).toBe('Reactive System');

      // Table entries
      expect(entries[1]!.headingPath).toEqual(['Team Wiki', 'Slang']);
      expect(entries[1]!.kind).toBe('concept');
      expect(entries[1]!.content).toContain('WIP');

      expect(entries[2]!.headingPath).toEqual(['Team Wiki', 'Slang']);
      expect(entries[2]!.kind).toBe('concept');
      expect(entries[2]!.content).toContain('ETA');

      // Rule entries
      expect(entries[3]!.headingPath).toEqual(['Team Wiki', 'Rules']);
      expect(entries[3]!.kind).toBe('rule');
      expect(entries[3]!.metadata.id).toBe('no-direct-db');
      expect(entries[3]!.content).toBe('Never access the database directly from controllers.\n\nAlways use the repository pattern.');

      expect(entries[4]!.headingPath).toEqual(['Team Wiki', 'Rules']);
      expect(entries[4]!.kind).toBe('rule');
      expect(entries[4]!.metadata.id).toBe('log-all-errors');
      expect(entries[4]!.content).toBe('Log all errors with stack traces.');
    });
  });
});
