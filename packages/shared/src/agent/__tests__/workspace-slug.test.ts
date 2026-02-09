/**
 * Tests for extractWorkspaceSlug utility and qualifySkillName
 *
 * extractWorkspaceSlug (packages/shared/src/utils/workspace.ts) is used in
 * ClaudeAgent, CodexAgent, and renderer components to derive the workspace
 * slug from rootPath for skill qualification.
 *
 * This file tests:
 * 1. The extractWorkspaceSlug utility directly
 * 2. qualifySkillName which consumes the slug
 */
import { describe, it, expect } from 'bun:test'
import { qualifySkillName } from '../core/index.ts'
import { extractWorkspaceSlug } from '../../utils/workspace.ts'

describe('workspace slug extraction', () => {
  const fallback = 'fallback-id'

  it('extracts slug from normal path', () => {
    expect(extractWorkspaceSlug('/Users/foo/my-workspace', fallback)).toBe('my-workspace')
  })

  it('extracts slug from path with trailing slash', () => {
    expect(extractWorkspaceSlug('/path/workspace/', fallback)).toBe('workspace')
  })

  it('extracts slug from deep path', () => {
    expect(extractWorkspaceSlug('/a/b/c/d/workspace', fallback)).toBe('workspace')
  })

  it('extracts slug from single-component path', () => {
    expect(extractWorkspaceSlug('/workspace', fallback)).toBe('workspace')
  })

  it('returns fallback for root path /', () => {
    // split('/').filter(Boolean) on '/' gives []
    // [].at(-1) is undefined, so fallback is used
    expect(extractWorkspaceSlug('/', fallback)).toBe(fallback)
  })

  it('returns fallback for empty string', () => {
    // split('/').filter(Boolean) on '' gives []
    expect(extractWorkspaceSlug('', fallback)).toBe(fallback)
  })

  it('handles Windows-style paths with forward slashes', () => {
    // In practice the code splits on '/' which works if paths are normalized
    expect(extractWorkspaceSlug('C:/Users/foo/workspace', fallback)).toBe('workspace')
  })

  it('handles hyphenated workspace names', () => {
    expect(extractWorkspaceSlug('/path/to/my-cool-workspace', fallback)).toBe('my-cool-workspace')
  })

  it('handles dotted workspace names', () => {
    expect(extractWorkspaceSlug('/path/to/my.workspace-name', fallback)).toBe('my.workspace-name')
  })

  it('handles workspace names with underscores', () => {
    expect(extractWorkspaceSlug('/path/to/my_workspace', fallback)).toBe('my_workspace')
  })

  it('handles paths with spaces in components', () => {
    expect(extractWorkspaceSlug('/Users/John Smith/My Workspace', fallback)).toBe('My Workspace')
  })

  it('handles multiple trailing slashes', () => {
    // filter(Boolean) removes empty strings from split
    expect(extractWorkspaceSlug('/path/workspace///', fallback)).toBe('workspace')
  })
})

// ============================================================================
// qualifySkillName — uses the workspace slug to prefix skill names
// ============================================================================

describe('qualifySkillName', () => {
  it('qualifies a bare skill name with workspace slug', () => {
    const result = qualifySkillName({ skill: 'commit' }, 'my-workspace')
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my-workspace:commit' })
  })

  it('does not modify already-qualified skill names', () => {
    const result = qualifySkillName({ skill: 'my-workspace:commit' }, 'my-workspace')
    expect(result.modified).toBe(false)
    expect(result.input).toEqual({ skill: 'my-workspace:commit' })
  })

  it('does not modify skill with different workspace prefix', () => {
    const result = qualifySkillName({ skill: 'other-ws:commit' }, 'my-workspace')
    expect(result.modified).toBe(false)
    expect(result.input).toEqual({ skill: 'other-ws:commit' })
  })

  it('handles missing skill field', () => {
    const result = qualifySkillName({ args: 'something' }, 'my-workspace')
    expect(result.modified).toBe(false)
  })

  it('handles undefined skill field', () => {
    const result = qualifySkillName({ skill: undefined }, 'my-workspace')
    expect(result.modified).toBe(false)
  })

  it('preserves other input fields when qualifying', () => {
    const result = qualifySkillName({ skill: 'commit', args: '-m "fix"' }, 'my-workspace')
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my-workspace:commit', args: '-m "fix"' })
  })

  it('calls debug callback when qualifying', () => {
    const messages: string[] = []
    qualifySkillName({ skill: 'commit' }, 'my-workspace', (msg) => messages.push(msg))
    expect(messages.length).toBe(1)
    expect(messages[0]).toContain('qualified')
    expect(messages[0]).toContain('commit')
    expect(messages[0]).toContain('my-workspace:commit')
  })

  it('does not call debug callback when already qualified', () => {
    const messages: string[] = []
    qualifySkillName({ skill: 'ws:commit' }, 'my-workspace', (msg) => messages.push(msg))
    expect(messages.length).toBe(0)
  })

  it('works with dotted workspace slug', () => {
    const result = qualifySkillName({ skill: 'commit' }, 'my.workspace')
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my.workspace:commit' })
  })

  it('works with hyphenated skill names', () => {
    const result = qualifySkillName({ skill: 'review-pr' }, 'workspace')
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'workspace:review-pr' })
  })
})
