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
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { qualifySkillName, AGENTS_PLUGIN_NAME } from '../core/index.ts'
import { extractWorkspaceSlug, readPluginName } from '../../utils/workspace.ts'

// ============================================================================
// readPluginName — reads SDK plugin name from .claude-plugin/plugin.json
// ============================================================================

describe('readPluginName', () => {
  const testDir = join(tmpdir(), `plugin-name-test-${Date.now()}`)

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('reads plugin name from .claude-plugin/plugin.json', () => {
    const wsDir = join(testDir, 'ws-with-plugin')
    mkdirSync(join(wsDir, '.claude-plugin'), { recursive: true })
    writeFileSync(join(wsDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'craft-workspace-default', version: '1.0.0' }))
    expect(readPluginName(wsDir)).toBe('craft-workspace-default')
  })

  it('returns null when .claude-plugin/plugin.json does not exist', () => {
    const wsDir = join(testDir, 'ws-no-plugin')
    mkdirSync(wsDir, { recursive: true })
    expect(readPluginName(wsDir)).toBeNull()
  })

  it('returns null when plugin.json has no name field', () => {
    const wsDir = join(testDir, 'ws-no-name')
    mkdirSync(join(wsDir, '.claude-plugin'), { recursive: true })
    writeFileSync(join(wsDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '1.0.0' }))
    expect(readPluginName(wsDir)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    const wsDir = join(testDir, 'ws-bad-json')
    mkdirSync(join(wsDir, '.claude-plugin'), { recursive: true })
    writeFileSync(join(wsDir, '.claude-plugin', 'plugin.json'), 'not json')
    expect(readPluginName(wsDir)).toBeNull()
  })
})

// ============================================================================
// extractWorkspaceSlug — reads plugin name, falls back to basename
// ============================================================================

describe('workspace slug extraction', () => {
  const fallback = 'fallback-id'

  it('reads plugin name from plugin.json when available', () => {
    const testDir2 = join(tmpdir(), `slug-plugin-test-${Date.now()}`)
    const wsDir = join(testDir2, 'bd1675ea-4ba1-96e0-3de4-22c803b11e0d')
    mkdirSync(join(wsDir, '.claude-plugin'), { recursive: true })
    writeFileSync(join(wsDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'craft-workspace-default', version: '1.0.0' }))
    expect(extractWorkspaceSlug(wsDir, fallback)).toBe('craft-workspace-default')
    rmSync(testDir2, { recursive: true, force: true })
  })

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
    expect(extractWorkspaceSlug('C:/Users/foo/workspace', fallback)).toBe('workspace')
  })

  it('handles Windows-style paths with backslashes', () => {
    expect(extractWorkspaceSlug('C:\\Users\\ghalmos\\.craft-agent\\workspaces\\my-workspace', fallback)).toBe('my-workspace')
  })

  it('handles Windows paths with tilde and backslashes', () => {
    expect(extractWorkspaceSlug('~\\.craft-agent\\workspaces\\my-workspace', fallback)).toBe('my-workspace')
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
    qualifySkillName({ skill: 'commit' }, 'my-workspace', undefined, undefined, (msg) => messages.push(msg))
    expect(messages.length).toBe(1)
    expect(messages[0]).toContain('qualified')
    expect(messages[0]).toContain('commit')
    expect(messages[0]).toContain('my-workspace:commit')
  })

  it('does not call debug callback when skill is missing', () => {
    const messages: string[] = []
    qualifySkillName({ skill: undefined }, 'my-workspace', undefined, undefined, (msg) => messages.push(msg))
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

  it('handles empty slug from trailing colon', () => {
    const result = qualifySkillName({ skill: 'workspace:' }, 'my-workspace')
    expect(result.modified).toBe(false)
  })
})

// ============================================================================
// qualifySkillName with filesystem resolution (resolveSkillPlugin path)
// ============================================================================

describe('qualifySkillName with filesystem resolution', () => {
  const testDir = join(tmpdir(), `skill-resolve-test-${Date.now()}`)
  const workspaceRoot = join(testDir, 'my-workspace')
  const projectDir = join(testDir, 'my-project')
  const workspaceSlug = 'my-workspace'

  beforeAll(() => {
    // Create workspace skill: my-workspace/skills/ws-only/SKILL.md
    mkdirSync(join(workspaceRoot, 'skills', 'ws-only'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'skills', 'ws-only', 'SKILL.md'), '---\nname: WS Only\ndescription: test\n---\n')

    // Create workspace skill that also exists in project (for priority test)
    mkdirSync(join(workspaceRoot, 'skills', 'shared-skill'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'skills', 'shared-skill', 'SKILL.md'), '---\nname: WS Shared\ndescription: test\n---\n')

    // Create project skill: my-project/.agents/skills/proj-only/SKILL.md
    mkdirSync(join(projectDir, '.agents', 'skills', 'proj-only'), { recursive: true })
    writeFileSync(join(projectDir, '.agents', 'skills', 'proj-only', 'SKILL.md'), '---\nname: Proj Only\ndescription: test\n---\n')

    // Create project skill that also exists in workspace (for priority test)
    mkdirSync(join(projectDir, '.agents', 'skills', 'shared-skill'), { recursive: true })
    writeFileSync(join(projectDir, '.agents', 'skills', 'shared-skill', 'SKILL.md'), '---\nname: Proj Shared\ndescription: test\n---\n')
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('resolves workspace-only skill to workspace plugin', () => {
    const result = qualifySkillName({ skill: 'ws-only' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my-workspace:ws-only' })
  })

  it('resolves project-only skill to .agents plugin', () => {
    const result = qualifySkillName({ skill: 'proj-only' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: `${AGENTS_PLUGIN_NAME}:proj-only` })
  })

  it('project skill takes priority over workspace skill (same slug)', () => {
    const result = qualifySkillName({ skill: 'shared-skill' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(true)
    // Project has higher priority than workspace — should resolve to .agents:
    expect(result.input).toEqual({ skill: `${AGENTS_PLUGIN_NAME}:shared-skill` })
  })

  it('re-qualifies incorrectly qualified skill (workspace prefix for project skill)', () => {
    // UI might send "my-workspace:proj-only" but proj-only only exists in project tier
    const result = qualifySkillName({ skill: 'my-workspace:proj-only' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: `${AGENTS_PLUGIN_NAME}:proj-only` })
  })

  it('does not modify correctly qualified workspace skill', () => {
    const result = qualifySkillName({ skill: 'my-workspace:ws-only' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(false)
  })

  it('falls back to workspace plugin for unknown skill', () => {
    const result = qualifySkillName({ skill: 'nonexistent' }, workspaceSlug, workspaceRoot, projectDir)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my-workspace:nonexistent' })
  })

  it('resolves without project dir (workspace-only mode)', () => {
    const result = qualifySkillName({ skill: 'ws-only' }, workspaceSlug, workspaceRoot, undefined)
    expect(result.modified).toBe(true)
    expect(result.input).toEqual({ skill: 'my-workspace:ws-only' })
  })
})
