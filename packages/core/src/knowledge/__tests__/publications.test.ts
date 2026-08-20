/**
 * distillFromMessages + publication type helpers (P4 / K-06).
 * Deterministic engine — no LLM.
 */
import { describe, expect, test } from 'bun:test'
import {
  PUBLISH_MARKDOWN_MAX_CHARS,
  buildBodyWithProvenance,
  buildProvenanceYaml,
  distillFromMessages,
  hashExcerpt,
  hashMarkdownContent,
} from '../publications.ts'

const BASE_OPTS = {
  connectionId: 'conn-1',
  sessionId: 'sess-1',
  now: Date.parse('2026-08-07T12:00:00.000Z'),
  draftId: 'draft_test_1',
  model: { connectionSlug: 'local', modelId: 'distill-v1' },
} as const

describe('distillFromMessages', () => {
  test('builds draft from assistant content with sourceMessages and stable contentHash', () => {
    const messages = [
      { id: 'msg_u1', role: 'user', content: 'Summarize the SiYuan publication design decisions.' },
      {
        id: 'msg_a1',
        role: 'assistant',
        content:
          '## Design\n\nSession is process; Document is accepted result. Publish only through proposal and human approval. Provenance uses craft attributes and YAML front matter.',
      },
    ]
    const draft = distillFromMessages(messages, BASE_OPTS)
    expect(draft.id).toBe('draft_test_1')
    expect(draft.status).toBe('draft')
    expect(draft.sessionId).toBe('sess-1')
    expect(draft.sourceMessages.length).toBeGreaterThan(0)
    expect(draft.markdown).toContain('Session is process')
    expect(draft.markdown).not.toMatch(/bearer\s+/i)
    expect(draft.contentHash).toBe(hashMarkdownContent(draft.markdown))
    expect(draft.outline.some((o) => o.heading === 'Design' || o.heading.includes('Design'))).toBe(true)
    // stable hash across identical input
    const again = distillFromMessages(messages, BASE_OPTS)
    expect(again.contentHash).toBe(draft.contentHash)
    expect(again.markdown).toBe(draft.markdown)
  })

  test('excludes credential-like fragments from markdown and records excerptHash only', () => {
    const secret = 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz012345'
    const messages = [
      { id: 'msg_u1', role: 'user', content: 'Publish the notes' },
      {
        id: 'msg_a1',
        role: 'assistant',
        content: `Here is the conclusion about the bridge storage layout and proposal lifecycle.\n\n${secret}\n\nKeep the audit trail append-only.`,
      },
    ]
    const draft = distillFromMessages(messages, BASE_OPTS)
    expect(draft.markdown).not.toContain('Bearer')
    expect(draft.markdown).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345')
    expect(draft.excluded.some((e) => e.reason === 'credential-like')).toBe(true)
    const cred = draft.excluded.find((e) => e.reason === 'credential-like')!
    expect(cred.excerptHash).toMatch(/^[a-f0-9]{32,}$/)
    expect(JSON.stringify(draft)).not.toContain(secret)
  })

  test('excludes PEM blocks as credential-like', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWy\n-----END RSA PRIVATE KEY-----'
    const draft = distillFromMessages(
      [
        { id: 'msg_1', role: 'user', content: 'goal: capture findings' },
        {
          id: 'msg_2',
          role: 'assistant',
          content: `Findings about the mutation safety contour and inverse ops.\n\n${pem}\n\nAlso prefer soft rollback.`,
        },
      ],
      BASE_OPTS,
    )
    expect(draft.markdown).not.toContain('PRIVATE KEY')
    expect(draft.excluded.some((e) => e.reason === 'credential-like')).toBe(true)
  })

  test('excludes raw tool-call dumps and large JSON blobs', () => {
    const bigJson = JSON.stringify({ tool_call: { name: 'run', args: { x: 'y'.repeat(600) } } })
    const draft = distillFromMessages(
      [
        { id: 'msg_1', role: 'user', content: 'What did we learn?' },
        {
          id: 'msg_2',
          role: 'assistant',
          content: `We learned that proposals must capture baseHash before apply and re-read after write.\n\n${bigJson}`,
        },
      ],
      BASE_OPTS,
    )
    expect(draft.markdown).not.toContain('tool_call')
    expect(draft.excluded.some((e) => e.reason === 'raw-transcript')).toBe(true)
  })

  test('refuses empty messages and messages with no surviving sources', () => {
    expect(() => distillFromMessages([], BASE_OPTS)).toThrow(/messages required/)
    expect(() =>
      distillFromMessages(
        [{ id: '', role: 'assistant', content: 'Bearer sk-abcdefghijklmnopqrstuvwxyz012345' }],
        { ...BASE_OPTS, sessionId: undefined },
      ),
    ).toThrow(/no sourceMessages|nothing left|refused/)
  })

  test('enforces size-cap and records size-cap exclusion', () => {
    const huge = 'A meaningful paragraph about knowledge publication. '.repeat(20_000)
    expect(huge.length).toBeGreaterThan(PUBLISH_MARKDOWN_MAX_CHARS)
    const draft = distillFromMessages(
      [
        { id: 'msg_u', role: 'user', content: 'Write everything' },
        { id: 'msg_a', role: 'assistant', content: huge },
      ],
      BASE_OPTS,
    )
    expect(draft.markdown.length).toBeLessThanOrEqual(PUBLISH_MARKDOWN_MAX_CHARS)
    expect(draft.excluded.some((e) => e.reason === 'size-cap')).toBe(true)
    expect(draft.contentHash).toBe(hashMarkdownContent(draft.markdown))
  })

  test('hashExcerpt is stable sha256 hex', () => {
    const a = hashExcerpt('same-text')
    const b = hashExcerpt('same-text')
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('provenance helpers', () => {
  test('buildProvenanceYaml and buildBodyWithProvenance prepend craft front-matter', () => {
    const yaml = buildProvenanceYaml({
      source_session_id: 'sess-1',
      source_run_ids: ['run-9'],
      published_at: '2026-08-07T12:00:00.000Z',
      generated_by: { provider: 'local', model: 'distill-v1' },
      source_blocks: ['siyuan://blocks/abc'],
      content_hash: 'deadbeef',
    })
    expect(yaml).toContain('craft:')
    expect(yaml).toContain('source_session_id: sess-1')
    const body = buildBodyWithProvenance('# Title\n\nHello\n', {
      source_run_ids: [],
      published_at: '2026-08-07T12:00:00.000Z',
      generated_by: { provider: 'p', model: 'm' },
      source_blocks: [],
      content_hash: 'abc',
    })
    expect(body.startsWith('---\ncraft:\n')).toBe(true)
    expect(body).toContain('# Title')
  })
})
