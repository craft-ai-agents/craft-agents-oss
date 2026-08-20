import { describe, it, expect, mock, beforeEach } from 'bun:test'

// Stub the preferences module so getSystemPrompt never touches disk (same
// pattern as system.test.ts). Per-test co-author flag for stability.
let mockIncludeCoAuthoredBy = true
mock.module('../../config/preferences.ts', () => ({
  getCoAuthorPreference: () => mockIncludeCoAuthoredBy,
  formatPreferencesForPrompt: () => '',
}))

import {
  formatLessonsForPrompt,
  formatSourceRetrieveForPrompt,
  formatWorkspaceMemoryForPrompt,
  getSystemPrompt,
} from '../system'
import type { Lesson } from '../../memory/types.ts'
import type { ProjectPromptContext } from '../../projects/types.ts'

const LESSONS_HEADER =
  '[Learned corrections — user-taught rules. ALWAYS follow these. They override default behavior.]'
const MEMORY_HEADER = '[Workspace memory]'
const SOURCES_HEADER = '[Retrieved source docs]'

function lesson(rule: string, overrides: Partial<Lesson> = {}): Lesson {
  return {
    ts: '2026-08-06T00:00:00.000Z',
    rule,
    category: 'correction',
    scope: 'global',
    source: { trigger: 'explicit' },
    ...overrides,
  }
}

function projectCtx(): ProjectPromptContext {
  return {
    name: 'demo',
    description: 'demo project',
    assetsPath: '/ws/assets',
    assets: [],
    memoryPath: '/ws/memory.md',
    memoryContent: 'Remember the release checklist.',
  }
}

describe('formatLessonsForPrompt', () => {
  it('returns an empty string for no lessons', () => {
    expect(formatLessonsForPrompt([])).toBe('')
  })

  it('renders the override header followed by one "- rule" line per lesson', () => {
    const out = formatLessonsForPrompt([
      lesson('always run frontend checks before calling a change done'),
      lesson('commit after each green test run'),
    ])
    expect(out).toContain(LESSONS_HEADER)
    expect(out).toContain('- always run frontend checks before calling a change done')
    expect(out).toContain('- commit after each green test run')
    // Header comes first, rules follow in order
    const headerIdx = out.indexOf(LESSONS_HEADER)
    expect(headerIdx).toBeGreaterThanOrEqual(0)
    expect(out.indexOf('- always run')).toBeGreaterThan(headerIdx)
  })

  it('renders negative lessons as MUST NOT lines', () => {
    const out = formatLessonsForPrompt([
      lesson('never commit directly to main', { negative: true }),
    ])
    expect(out).toContain('- MUST NOT: never commit directly to main')
    expect(out).not.toContain('- never commit directly to main\n')
  })

  it('preserves caller composition order (global lessons then workspace lessons)', () => {
    const out = formatLessonsForPrompt([
      lesson('global rule one', { scope: 'global' }),
      lesson('workspace rule two', { scope: 'workspace' }),
    ])
    const globalIdx = out.indexOf('- global rule one')
    const workspaceIdx = out.indexOf('- workspace rule two')
    expect(globalIdx).toBeGreaterThanOrEqual(0)
    expect(workspaceIdx).toBeGreaterThan(globalIdx)
  })
})

describe('formatWorkspaceMemoryForPrompt', () => {
  it('returns an empty string when all sections are empty or missing', () => {
    expect(formatWorkspaceMemoryForPrompt({})).toBe('')
    expect(formatWorkspaceMemoryForPrompt({ context: '  ', preferences: '', recentHistory: '\n' })).toBe('')
  })

  it('renders only the provided subsections under the workspace memory header', () => {
    const out = formatWorkspaceMemoryForPrompt({
      context: 'Uses Bun workspaces.',
      recentHistory: '2026-08-06: added memory store',
    })
    expect(out).toContain(MEMORY_HEADER)
    expect(out).toContain('## Context')
    expect(out).toContain('Uses Bun workspaces.')
    expect(out).toContain('## Recent history')
    expect(out).toContain('2026-08-06: added memory store')
    expect(out).not.toContain('## Preferences')
  })

  it('renders a preferences-only memory', () => {
    const out = formatWorkspaceMemoryForPrompt({ preferences: 'Prefer small PRs.' })
    expect(out).toContain(MEMORY_HEADER)
    expect(out).toContain('## Preferences')
    expect(out).toContain('Prefer small PRs.')
    expect(out).not.toContain('## Context')
    expect(out).not.toContain('## Recent history')
  })
})

describe('system prompt memory injection', () => {
  beforeEach(() => {
    mockIncludeCoAuthoredBy = true
  })

  it('injects lessons and workspace memory blocks after the project memory block', () => {
    const lessonsBlock = formatLessonsForPrompt([
      lesson('global rule', { scope: 'global' }),
      lesson('workspace rule', { scope: 'workspace' }),
    ])
    const memoryBlock = formatWorkspaceMemoryForPrompt({ context: 'Workspace context body.' })
    const prompt = getSystemPrompt(
      undefined,
      undefined,
      undefined, // no workspace root
      undefined, // no working directory (skips context-file discovery)
      undefined,
      undefined,
      true,
      projectCtx(),
      { lessonsBlock, memoryBlock },
    )
    // Blocks are present in the final system prompt
    expect(prompt).toContain(LESSONS_HEADER)
    expect(prompt).toContain(MEMORY_HEADER)
    // Ordering: project memory < lessons < workspace memory
    const projectMemoryIdx = prompt.indexOf('<project_memory>')
    expect(projectMemoryIdx).toBeGreaterThanOrEqual(0)
    expect(prompt.indexOf(LESSONS_HEADER)).toBeGreaterThan(projectMemoryIdx)
    expect(prompt.indexOf(MEMORY_HEADER)).toBeGreaterThan(prompt.indexOf(LESSONS_HEADER))
    // Caller composition order (global then workspace) preserved end-to-end
    expect(prompt.indexOf('- global rule')).toBeLessThan(prompt.indexOf('- workspace rule'))
  })

  it('omits the blocks entirely when memoryBlocks is not provided', () => {
    const prompt = getSystemPrompt(
      undefined, undefined, undefined, undefined, undefined, undefined, true,
    )
    expect(prompt).not.toContain(LESSONS_HEADER)
    expect(prompt).not.toContain(MEMORY_HEADER)
  })

  it('appends nothing when the provided blocks are empty strings', () => {
    const prompt = getSystemPrompt(
      undefined, undefined, undefined, undefined, undefined, undefined, true,
      undefined,
      { lessonsBlock: formatLessonsForPrompt([]), memoryBlock: formatWorkspaceMemoryForPrompt({}) },
    )
    expect(prompt).not.toContain(LESSONS_HEADER)
    expect(prompt).not.toContain(MEMORY_HEADER)
  })
})

describe('formatSourceRetrieveForPrompt', () => {
  it('returns empty string for no hits', () => {
    expect(formatSourceRetrieveForPrompt([])).toBe('')
  })

  it('renders header plus path/excerpt sections in caller order', () => {
    const block = formatSourceRetrieveForPrompt([
      { path: 'docs/a.md', excerpt: 'alpha body' },
      { path: 'docs/b.md', excerpt: 'beta body' },
    ])
    expect(block).toContain(SOURCES_HEADER)
    expect(block).toContain('### docs/a.md')
    expect(block).toContain('alpha body')
    expect(block).toContain('### docs/b.md')
    expect(block.indexOf('docs/a.md')).toBeLessThan(block.indexOf('docs/b.md'))
  })

  it('skips hits missing path or excerpt', () => {
    expect(
      formatSourceRetrieveForPrompt([
        { path: '', excerpt: 'x' },
        { path: 'p.md', excerpt: '  ' },
      ]),
    ).toBe('')
  })
})

describe('system prompt sources injection', () => {
  beforeEach(() => {
    mockIncludeCoAuthoredBy = true
  })

  it('injects sourcesBlock after memory blocks', () => {
    const lessonsBlock = formatLessonsForPrompt([lesson('a rule')])
    const memoryBlock = formatWorkspaceMemoryForPrompt({ context: 'ctx' })
    const sourcesBlock = formatSourceRetrieveForPrompt([
      { path: 'local/guide.md', excerpt: 'retrieved guide body' },
    ])
    const prompt = getSystemPrompt(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      projectCtx(),
      { lessonsBlock, memoryBlock, sourcesBlock },
    )
    expect(prompt).toContain(SOURCES_HEADER)
    expect(prompt).toContain('### local/guide.md')
    expect(prompt).toContain('retrieved guide body')
    expect(prompt.indexOf(MEMORY_HEADER)).toBeLessThan(prompt.indexOf(SOURCES_HEADER))
    expect(prompt.indexOf(LESSONS_HEADER)).toBeLessThan(prompt.indexOf(SOURCES_HEADER))
  })

  it('omits sources header when sourcesBlock is absent or empty', () => {
    const bare = getSystemPrompt(
      undefined, undefined, undefined, undefined, undefined, undefined, true,
    )
    expect(bare).not.toContain(SOURCES_HEADER)

    const empty = getSystemPrompt(
      undefined, undefined, undefined, undefined, undefined, undefined, true,
      undefined,
      { sourcesBlock: formatSourceRetrieveForPrompt([]) },
    )
    expect(empty).not.toContain(SOURCES_HEADER)
  })
})
