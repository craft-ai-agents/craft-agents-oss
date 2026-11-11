import { describe, it, expect } from 'bun:test'
import { nextAvailableProxyName, proxyToolName } from '../proxy-tool-name.ts'

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

describe('nextAvailableProxyName (#1002)', () => {
  it('returns the base name when it is free', () => {
    expect(nextAvailableProxyName('mcp__src__pat_batch', new Set())).toBe('mcp__src__pat_batch')
    expect(nextAvailableProxyName('mcp__src__pat_batch', new Set(['mcp__src__other']))).toBe('mcp__src__pat_batch')
  })

  it('suffixes the first collision with __2', () => {
    const taken = new Set(['mcp__src__pat_batch'])
    expect(nextAvailableProxyName('mcp__src__pat_batch', taken)).toBe('mcp__src__pat_batch__2')
  })

  it('skips suffixes that are already taken', () => {
    const taken = new Set(['mcp__src__pat_batch', 'mcp__src__pat_batch__2', 'mcp__src__pat_batch__3'])
    expect(nextAvailableProxyName('mcp__src__pat_batch', taken)).toBe('mcp__src__pat_batch__4')
  })

  it('is deterministic for the same taken set', () => {
    const taken = new Set(['mcp__src__a_b', 'mcp__src__a_b__2'])
    expect(nextAvailableProxyName('mcp__src__a_b', taken)).toBe(nextAvailableProxyName('mcp__src__a_b', taken))
  })
})
