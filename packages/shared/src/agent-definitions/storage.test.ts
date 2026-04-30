import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseAgentFile,
  serializeAgent,
  isValidAgentSlug,
  readActivatedAgents,
  writeActivatedAgents,
  setAgentActive,
} from './storage.ts'

/**
 * The storage module's library functions read from `~/.agents/agents/` —
 * which we don't want to touch from tests. We exercise the *pure* helpers
 * (parse, serialize, slug validation) and the workspace-scoped activation
 * manifest (which uses a path we control). Library-tier reads/writes get
 * their own integration test once the seed-on-first-run flow lands.
 */

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'craft-agent-defs-test-'))
}

describe('isValidAgentSlug', () => {
  test('accepts standard slugs', () => {
    expect(isValidAgentSlug('research')).toBe(true)
    expect(isValidAgentSlug('writer-2')).toBe(true)
    expect(isValidAgentSlug('a')).toBe(true)
    expect(isValidAgentSlug('a1b2c3')).toBe(true)
  })

  test('rejects invalid slugs', () => {
    expect(isValidAgentSlug('')).toBe(false)
    expect(isValidAgentSlug('Research')).toBe(false) // uppercase
    expect(isValidAgentSlug('-leading')).toBe(false)
    expect(isValidAgentSlug('trailing-')).toBe(false)
    expect(isValidAgentSlug('has space')).toBe(false)
    expect(isValidAgentSlug('has.dot')).toBe(false)
    expect(isValidAgentSlug('a'.repeat(65))).toBe(false) // too long
  })
})

describe('parseAgentFile', () => {
  test('parses a fully-populated agent', () => {
    const md = `---
name: Research Agent
description: Digs deep on topics with citations.
avatar: 🔬
llmConnection: anthropic-default
model: claude-opus-4-7
permissionMode: ask
thinkingLevel: high
skills:
  - web-research
  - cite-sources
sources:
  - tavily
greeting: Give me a question, I'll dig.
---
You are a research specialist.
Always cite your sources.
`
    const parsed = parseAgentFile(md)
    expect(parsed).not.toBeNull()
    expect(parsed!.metadata.name).toBe('Research Agent')
    expect(parsed!.metadata.description).toBe('Digs deep on topics with citations.')
    expect(parsed!.metadata.avatar).toBe('🔬')
    expect(parsed!.metadata.llmConnection).toBe('anthropic-default')
    expect(parsed!.metadata.permissionMode).toBe('ask')
    expect(parsed!.metadata.thinkingLevel).toBe('high')
    expect(parsed!.metadata.skills).toEqual(['web-research', 'cite-sources'])
    expect(parsed!.metadata.sources).toEqual(['tavily'])
    expect(parsed!.metadata.greeting).toBe(`Give me a question, I'll dig.`)
    expect(parsed!.systemPrompt).toContain('research specialist')
    expect(parsed!.systemPrompt).toContain('cite your sources')
  })

  test('rejects when name is missing', () => {
    const md = `---
description: missing name
---
body
`
    expect(parseAgentFile(md)).toBeNull()
  })

  test('rejects when description is missing', () => {
    const md = `---
name: Solo
---
body
`
    expect(parseAgentFile(md)).toBeNull()
  })

  test('coerces invalid permissionMode to undefined (not a hard error)', () => {
    const md = `---
name: x
description: y
permissionMode: GOD_MODE
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.permissionMode).toBeUndefined()
  })

  test('handles single-string skill / source as array', () => {
    const md = `---
name: x
description: y
skills: solo-skill
sources: solo-src
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.skills).toEqual(['solo-skill'])
    expect(parsed!.metadata.sources).toEqual(['solo-src'])
  })

  test('returns null on completely malformed YAML rather than throwing', () => {
    const md = `---
this is not: valid yaml: !!!! 😱
  - mixed: indent
   - bad
---
body
`
    // gray-matter is forgiving so this might still parse — the contract is
    // "never throw". Either null or an empty-required-fields rejection is OK.
    const parsed = parseAgentFile(md)
    expect(parsed === null || (!parsed.metadata.name)).toBe(true)
  })
})

describe('serializeAgent', () => {
  test('round-trips through parse without losing fields', () => {
    const original = serializeAgent(
      {
        name: 'Round Trip',
        description: 'Tests serialization.',
        avatar: '🔄',
        llmConnection: 'anthropic-default',
        permissionMode: 'safe',
        skills: ['a', 'b'],
        sources: ['s1'],
      },
      'You are a test agent.',
    )

    const parsed = parseAgentFile(original)
    expect(parsed!.metadata.name).toBe('Round Trip')
    expect(parsed!.metadata.avatar).toBe('🔄')
    expect(parsed!.metadata.permissionMode).toBe('safe')
    expect(parsed!.metadata.skills).toEqual(['a', 'b'])
    expect(parsed!.metadata.sources).toEqual(['s1'])
    expect(parsed!.systemPrompt).toBe('You are a test agent.')
  })

  test('omits empty arrays and undefined fields from frontmatter', () => {
    const out = serializeAgent(
      { name: 'minimal', description: 'just enough' },
      'system prompt',
    )
    // No empty `skills: []` or `sources: []` in the YAML.
    expect(out).not.toContain('skills:')
    expect(out).not.toContain('sources:')
    expect(out).not.toContain('avatar:')
  })
})

describe('activation manifest', () => {
  let workspace: string

  beforeEach(() => {
    workspace = tmpWorkspace()
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  test('returns empty manifest when file does not exist', () => {
    const manifest = readActivatedAgents(workspace)
    expect(manifest.version).toBe(1)
    expect(manifest.active).toEqual([])
  })

  test('writes and reads back', () => {
    const written = writeActivatedAgents(workspace, ['research', 'writer'])
    expect(written.active).toEqual(['research', 'writer'])
    const read = readActivatedAgents(workspace)
    expect(read.active).toEqual(['research', 'writer'])
  })

  test('dedups + filters invalid slugs on write', () => {
    const written = writeActivatedAgents(workspace, ['research', 'research', 'BAD-SLUG', 'writer'])
    expect(written.active).toEqual(['research', 'writer'])
  })

  test('setAgentActive(true) adds, setAgentActive(false) removes', () => {
    setAgentActive(workspace, 'research', true)
    setAgentActive(workspace, 'writer', true)
    expect(readActivatedAgents(workspace).active).toEqual(['research', 'writer'])

    setAgentActive(workspace, 'research', false)
    expect(readActivatedAgents(workspace).active).toEqual(['writer'])
  })

  test('setAgentActive is idempotent', () => {
    setAgentActive(workspace, 'research', true)
    setAgentActive(workspace, 'research', true)
    expect(readActivatedAgents(workspace).active).toEqual(['research'])

    setAgentActive(workspace, 'research', false)
    setAgentActive(workspace, 'research', false)
    expect(readActivatedAgents(workspace).active).toEqual([])
  })

  test('survives a malformed manifest by returning empty', () => {
    const path = join(workspace, 'activated-agents.json')
    writeFileSync(path, '{not valid json', 'utf-8')
    const manifest = readActivatedAgents(workspace)
    expect(manifest.active).toEqual([])
  })
})

describe('library + activation interplay (using a fake global dir)', () => {
  // For this test we need a configurable global dir. The storage module
  // uses ~/.agents/agents/ unconditionally — so we test by writing real
  // AGENT.md files into a tmp workspace and using parseAgentFile / serializeAgent
  // directly. Full end-to-end with the global dir lives in an integration
  // test next to seed-on-first-run.

  test('serialize → write → parse round-trips a realistic agent', () => {
    const workspace = tmpWorkspace()
    try {
      const dir = join(workspace, 'fake-global', 'researcher')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'AGENT.md')

      const serialized = serializeAgent(
        {
          name: 'Researcher',
          description: 'Investigates topics.',
          skills: ['web-research'],
        },
        'You are a researcher.\nReturn structured findings.',
      )
      writeFileSync(file, serialized, 'utf-8')

      expect(existsSync(file)).toBe(true)
      const re = parseAgentFile(readFileSync(file, 'utf-8'))
      expect(re!.metadata.name).toBe('Researcher')
      expect(re!.metadata.skills).toEqual(['web-research'])
      expect(re!.systemPrompt).toContain('structured findings')
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
