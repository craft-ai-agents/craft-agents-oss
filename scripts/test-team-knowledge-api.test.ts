import { describe, expect, it } from 'bun:test';
import { parseMarkdownEntries } from '../packages/shared/src/markdown-entry-parser/index.ts';
import {
  handleTeamKnowledgeApiRequest,
  TEAM_KNOWLEDGE_DOCUMENTS,
} from './test-team-knowledge-api.ts';

describe('test team knowledge API fixture', () => {
  it('serves a four-document index for the new team knowledge kinds', async () => {
    const response = handleTeamKnowledgeApiRequest(new Request('http://localhost:3100/api/team/knowledge'));
    const body = await response.json() as { documents: Array<{ id: string; title: string; url: string; priority: number }> };
    const index = body.documents;

    expect(response.status).toBe(200);
    expect(index.map(document => document.id)).toEqual([
      'terminology',
      'common-knowledge',
      'notices',
      'constraints',
    ]);
    expect(index.map(document => document.priority)).toEqual([1, 2, 3, 4]);
    expect(index.every(document => document.url === `/api/team/knowledge/${document.id}`)).toBe(true);
  });

  it('uses the new marker kinds and limits trigger names to term entries', () => {
    const documents = Object.fromEntries(TEAM_KNOWLEDGE_DOCUMENTS.map(document => [document.id, document]));
    const terminologyEntries = parseMarkdownEntries(documents.terminology!.markdown);
    const commonEntries = parseMarkdownEntries(documents['common-knowledge']!.markdown);
    const noticeEntries = parseMarkdownEntries(documents.notices!.markdown);
    const ruleEntries = parseMarkdownEntries(documents.constraints!.markdown);

    expect(terminologyEntries).toHaveLength(5);
    expect(terminologyEntries.map(entry => entry.kind)).toEqual(['term', 'term', 'term', 'term', 'term']);
    expect(terminologyEntries.map(entry => entry.term)).toEqual(['花豹', '天眼', 'owl', '受托', '乐高']);

    expect(commonEntries.map(entry => entry.kind)).toEqual(['knowledge', 'knowledge', 'knowledge']);
    expect(noticeEntries.map(entry => entry.kind)).toEqual(['notice', 'notice', 'notice']);
    expect(ruleEntries.map(entry => entry.kind)).toEqual(['rule', 'rule', 'rule']);

    expect(documents.terminology!.markdown.match(/<!-- term name:/g)).toHaveLength(5);
    expect(documents['common-knowledge']!.markdown).toContain('<!-- knowledge');
    expect(documents.notices!.markdown).toContain('<!-- notice');
    expect(documents.constraints!.markdown).toContain('<!-- rule');
  });

  it('returns Markdown for known documents and JSON 404s for unknown documents', async () => {
    const known = handleTeamKnowledgeApiRequest(new Request('http://localhost:3100/api/team/knowledge/terminology'));
    const missing = handleTeamKnowledgeApiRequest(new Request('http://localhost:3100/api/team/knowledge/missing'));

    expect(known.status).toBe(200);
    expect(known.headers.get('content-type')).toContain('text/markdown');
    expect(await known.text()).toContain('<!-- term name:花豹 summary:前端性能监控系统 -->');

    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
  });
});
