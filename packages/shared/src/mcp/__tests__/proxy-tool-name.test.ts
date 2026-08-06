import { describe, it, expect } from 'bun:test'
import { proxyToolName } from '../proxy-tool-name.ts'

describe('proxyToolName (#864)', () => {
  it('passes an already-valid name through unchanged', () => {
    expect(proxyToolName('linear', 'createIssue')).toBe('mcp__linear__createIssue')
  })

  it('sanitizes dots that OpenAI/Codex reject', () => {
    expect(proxyToolName('dingtalk-ai-table', 'pat.batch_plan')).toBe('mcp__dingtalk-ai-table__pat_batch_plan')
    expect(proxyToolName('dingtalk-docs', 'pat.batch_grant')).toBe('mcp__dingtalk-docs__pat_batch_grant')
  })

  it('preserves hyphens and underscores', () => {
    expect(proxyToolName('my-src', 'do_thing-now')).toBe('mcp__my-src__do_thing-now')
  })

  it('only ever emits the OpenAI-allowed [a-zA-Z0-9_-] charset', () => {
    expect(proxyToolName('a.b', 'c.d e/f')).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('is deterministic so build/emit/register/dispatch all agree on the same key', () => {
    const a = proxyToolName('src', 'a.b.c')
    const b = proxyToolName('src', 'a.b.c')
    expect(a).toBe(b)
  })
})
