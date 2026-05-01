import { describe, expect, test } from 'bun:test'
import { buildAgentBundleFooter, buildAgentCatalogSection, buildMemorySection, buildWorkspaceContextSection, composeAgentSystemPrompt } from './compose-agent-prompt'
import type { MemoryEntry } from '@craft-agent/shared/memory/types'
import type { AgentDefinitionDTO, ContextDocDTO, LoadedSkill, LoadedSource } from '../../shared/types'

function makeDoc(slug: string, name: string, body: string, overrides: Partial<ContextDocDTO['metadata']> = {}): ContextDocDTO {
  return {
    slug,
    metadata: {
      name,
      routing: { mode: 'broadcast' },
      enabled: true,
      ...overrides,
    },
    body,
    path: `/tmp/ctx/${slug}`,
    workspaceRootPath: '/tmp/ws',
  } as ContextDocDTO
}

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentDefinitionDTO> = {}): AgentDefinitionDTO {
  return {
    slug: 'test-agent',
    metadata: {
      name: 'Test Agent',
      description: 'For tests.',
      ...overrides.metadata,
    },
    systemPrompt: 'You are a test agent.',
    path: '/tmp/fake',
    source: 'global',
    ...overrides,
  } as AgentDefinitionDTO
}

function makeSkill(slug: string, name: string, description: string): LoadedSkill {
  return {
    slug,
    metadata: { name, description },
    content: '',
    path: `/tmp/skills/${slug}`,
    source: 'workspace',
  } as LoadedSkill
}

function makeSource(slug: string, name: string, tagline?: string): LoadedSource {
  return {
    config: {
      id: `id-${slug}`,
      name,
      slug,
      enabled: true,
      provider: slug,
      type: 'mcp',
      ...(tagline ? { tagline } : {}),
    },
    guide: null,
    folderPath: `/tmp/sources/${slug}`,
    workspaceRootPath: '/tmp/ws',
    workspaceId: 'ws-1',
  } as unknown as LoadedSource
}

function makeMemory(name: string, body: string, type: MemoryEntry['type'] = 'reference'): MemoryEntry {
  return {
    name,
    type,
    created: '2026-05-01T12:00:00.000Z',
    body,
  }
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('composeAgentSystemPrompt', () => {
  test('returns body unchanged when agent has no bundled skills or sources', () => {
    const agent = makeAgent()
    const result = composeAgentSystemPrompt(agent, [], [])
    expect(result).toBe('You are a test agent.')
  })

  test('returns body unchanged when bundles list is set but empty', () => {
    const agent = makeAgent({ metadata: { name: 'X', description: 'Y', skills: [], sources: [] } })
    const result = composeAgentSystemPrompt(agent, [], [])
    expect(result).toBe('You are a test agent.')
  })

  test('appends a skills-only footer when only skills are bundled', () => {
    const agent = makeAgent({
      metadata: {
        name: 'X', description: 'Y',
        skills: ['web-research'],
      },
    })
    const skills = [makeSkill('web-research', 'Web Research', 'Searches the web with citations.')]
    const result = composeAgentSystemPrompt(agent, skills, [])

    expect(result).toContain('You are a test agent.')
    expect(result).toContain('You have these skills bundled with you')
    expect(result).toContain('@web-research')
    expect(result).toContain('Web Research')
    expect(result).toContain('Searches the web with citations.')
    expect(result).not.toContain('You have these tools bundled')
    expect(result).toContain('When planning, check your bundled skills and tools')
  })

  test('appends a sources-only footer when only sources are bundled', () => {
    const agent = makeAgent({
      metadata: {
        name: 'X', description: 'Y',
        sources: ['tavily'],
      },
    })
    const sources = [makeSource('tavily', 'Tavily', 'Web search API with answer summarization.')]
    const result = composeAgentSystemPrompt(agent, [], sources)

    expect(result).toContain('You have these tools bundled with you')
    expect(result).toContain('@tavily')
    expect(result).toContain('Tavily')
    expect(result).toContain('Web search API with answer summarization.')
    expect(result).not.toContain('You have these skills bundled')
  })

  test('appends both sections when both are bundled', () => {
    const agent = makeAgent({
      metadata: {
        name: 'X', description: 'Y',
        skills: ['cite-sources'],
        sources: ['tavily'],
      },
    })
    const skills = [makeSkill('cite-sources', 'Cite Sources', 'Formats citations.')]
    const sources = [makeSource('tavily', 'Tavily', 'Web search.')]
    const result = composeAgentSystemPrompt(agent, skills, sources)

    expect(result).toContain('You have these skills bundled with you')
    expect(result).toContain('@cite-sources')
    expect(result).toContain('You have these tools bundled with you')
    expect(result).toContain('@tavily')
  })

  test('drops bundled slugs that do not resolve in the workspace', () => {
    const agent = makeAgent({
      metadata: {
        name: 'X', description: 'Y',
        skills: ['web-research', 'missing-skill'],
        sources: ['tavily', 'missing-source'],
      },
    })
    const skills = [makeSkill('web-research', 'Web Research', 'Real one.')]
    const sources = [makeSource('tavily', 'Tavily', 'Real one.')]
    const result = composeAgentSystemPrompt(agent, skills, sources)

    expect(result).toContain('@web-research')
    expect(result).toContain('@tavily')
    expect(result).not.toContain('@missing-skill')
    expect(result).not.toContain('@missing-source')
  })

  test('handles a source with no tagline gracefully', () => {
    const agent = makeAgent({
      metadata: { name: 'X', description: 'Y', sources: ['untagged'] },
    })
    const sources = [makeSource('untagged', 'Untagged Source')]
    const result = composeAgentSystemPrompt(agent, [], sources)

    expect(result).toContain('@untagged')
    expect(result).toContain('Untagged Source')
    // No em-dash description segment should appear when there's no tagline,
    // but the bullet shouldn't be empty.
  })

  test('preserves leading whitespace order — body first, then delimiter, then footer', () => {
    const agent = makeAgent({
      systemPrompt: 'Body text.',
      metadata: { name: 'X', description: 'Y', skills: ['s'] },
    })
    const skills = [makeSkill('s', 'S', 'desc')]
    const result = composeAgentSystemPrompt(agent, skills, [])

    const bodyEnd = result.indexOf('Body text.')
    const delim = result.indexOf('---')
    const footerStart = result.indexOf('You have these skills bundled')
    expect(bodyEnd).toBeGreaterThanOrEqual(0)
    expect(delim).toBeGreaterThan(bodyEnd)
    expect(footerStart).toBeGreaterThan(delim)
  })

  test('returns body untouched (no delimiter) when bundles are present but none resolve', () => {
    const agent = makeAgent({
      metadata: { name: 'X', description: 'Y', skills: ['ghost'], sources: ['phantom'] },
    })
    const result = composeAgentSystemPrompt(agent, [], [])
    expect(result).toBe('You are a test agent.')
    expect(result).not.toContain('---')
  })

  test('appends an agent catalog section for Concierge routing', () => {
    const agent = makeAgent()
    const result = composeAgentSystemPrompt(agent, [], [], [], [
      {
        slug: 'researcher',
        name: 'Researcher',
        description: 'Finds cited answers.',
        inputs: 'A topic.',
        outputs: 'A cited brief.',
        tags: ['research', 'cite'],
      },
    ])

    expect(result).toContain('Available agents you can route the user to:')
    expect(result).toContain('@researcher')
    expect(result).toContain('Input: A topic.')
    expect(result).toContain('Output: A cited brief.')
    expect(result).toContain('Tags: research, cite')
  })

  test('renders user and agent memory between workspace context and agent catalog', () => {
    const agent = makeAgent()
    const docs = [makeDoc('vision', 'Vision', 'Workspace facts.')]
    const result = composeAgentSystemPrompt(
      agent,
      [],
      [],
      docs,
      [{ slug: 'researcher', name: 'Researcher' }],
      {
        userMemoryEntries: [makeMemory('Communication', 'Prefers concise status updates.', 'user')],
        agentMemoryEntries: [makeMemory('Review rule', 'Always check generated tests.', 'feedback')],
      },
    )

    expect(result).toContain('USER.md — durable user memory:')
    expect(result).toContain('MEMORY.md — durable memory for this agent:')
    expect(result).toContain('## Communication')
    expect(result).toContain('Prefers concise status updates.')
    expect(result).toContain('## Review rule')

    const workspaceIdx = result.indexOf('Workspace context')
    const userMemoryIdx = result.indexOf('USER.md')
    const agentMemoryIdx = result.indexOf('MEMORY.md')
    const catalogIdx = result.indexOf('Available agents')
    expect(workspaceIdx).toBeLessThan(userMemoryIdx)
    expect(userMemoryIdx).toBeLessThan(agentMemoryIdx)
    expect(agentMemoryIdx).toBeLessThan(catalogIdx)
  })
})

describe('composeAgentSystemPrompt with context docs', () => {
  test('appends a workspace-context section between body and bundle footer', () => {
    const agent = makeAgent({ metadata: { name: 'X', description: 'Y', skills: ['s'] } })
    const skills = [makeSkill('s', 'S', 'desc')]
    const docs = [makeDoc('vision', 'Vision', 'We build agent OS.')]
    const result = composeAgentSystemPrompt(agent, skills, [], docs)

    expect(result).toContain('You are a test agent.')
    expect(result).toContain('Workspace context — read this before starting work:')
    expect(result).toContain('## Vision')
    expect(result).toContain('We build agent OS.')
    expect(result).toContain('You have these skills bundled')

    const bodyIdx = result.indexOf('You are a test agent.')
    const ctxIdx = result.indexOf('Workspace context')
    const footerIdx = result.indexOf('You have these skills bundled')
    expect(bodyIdx).toBeLessThan(ctxIdx)
    expect(ctxIdx).toBeLessThan(footerIdx)
  })

  test('skips disabled docs', () => {
    const agent = makeAgent()
    const docs = [
      makeDoc('on', 'On', 'visible'),
      makeDoc('off', 'Off', 'hidden', { enabled: false }),
    ]
    const result = composeAgentSystemPrompt(agent, [], [], docs)
    expect(result).toContain('visible')
    expect(result).not.toContain('hidden')
  })

  test('skips docs with empty bodies', () => {
    const agent = makeAgent()
    const docs = [makeDoc('blank', 'Blank', '   ')]
    const result = composeAgentSystemPrompt(agent, [], [], docs)
    expect(result).toBe('You are a test agent.')
    expect(result).not.toContain('Workspace context')
  })

  test('renders multiple docs as separate ## sections in given order', () => {
    const agent = makeAgent()
    const docs = [
      makeDoc('vision', 'Vision', 'A'),
      makeDoc('voice', 'Voice', 'B'),
    ]
    const result = composeAgentSystemPrompt(agent, [], [], docs)
    const visionIdx = result.indexOf('## Vision')
    const voiceIdx = result.indexOf('## Voice')
    expect(visionIdx).toBeGreaterThan(0)
    expect(voiceIdx).toBeGreaterThan(visionIdx)
  })

  test('omits the section entirely when no docs supplied', () => {
    const agent = makeAgent()
    const result = composeAgentSystemPrompt(agent, [], [], [])
    expect(result).toBe('You are a test agent.')
    expect(result).not.toContain('Workspace context')
  })

  test('falls back to slug when name is empty', () => {
    const agent = makeAgent()
    const docs = [makeDoc('vision', '', 'body text')]
    const result = composeAgentSystemPrompt(agent, [], [], docs)
    expect(result).toContain('## vision')
  })
})

describe('buildWorkspaceContextSection', () => {
  test('returns empty string for empty list', () => {
    expect(buildWorkspaceContextSection([])).toBe('')
  })

  test('returns empty string when all docs are disabled or blank', () => {
    const docs = [
      makeDoc('a', 'A', '', { enabled: true }),
      makeDoc('b', 'B', 'has body', { enabled: false }),
    ]
    expect(buildWorkspaceContextSection(docs)).toBe('')
  })
})

describe('buildAgentBundleFooter', () => {
  test('returns empty string when nothing to enumerate', () => {
    const agent = makeAgent()
    expect(buildAgentBundleFooter(agent, [], [])).toBe('')
  })

  test('renders bullets in the order declared by the agent (not the workspace order)', () => {
    const agent = makeAgent({
      metadata: { name: 'X', description: 'Y', skills: ['b', 'a', 'c'] },
    })
    const skills = [
      makeSkill('a', 'A', ''),
      makeSkill('b', 'B', ''),
      makeSkill('c', 'C', ''),
    ]
    const footer = buildAgentBundleFooter(agent, skills, [])
    const idxA = footer.indexOf('@a')
    const idxB = footer.indexOf('@b')
    const idxC = footer.indexOf('@c')
    expect(idxB).toBeLessThan(idxA)
    expect(idxA).toBeLessThan(idxC)
  })
})

describe('buildAgentCatalogSection', () => {
  test('returns empty string for no agents', () => {
    expect(buildAgentCatalogSection([])).toBe('')
  })
})

describe('buildMemorySection', () => {
  test('returns empty string when memory has no usable entries', () => {
    expect(buildMemorySection([], [makeMemory('Blank', '   ')])).toBe('')
  })

  test('renders memory entry metadata and body', () => {
    // Use an expiry far in the future so the entry survives filtering
    // regardless of when this test runs.
    const section = buildMemorySection([
      {
        ...makeMemory('Preference', 'Use direct language.', 'user'),
        expires: '2999-12-31',
      },
    ], [])

    expect(section).toContain('USER.md')
    expect(section).toContain('## Preference')
    expect(section).toContain('type: user')
    expect(section).toContain('expires: 2999-12-31')
    expect(section).toContain('Use direct language.')
  })

  test('filters out entries past their expires date', () => {
    const section = buildMemorySection([
      // Stale entry — 2000-01-01 is already past at any plausible runtime.
      { ...makeMemory('Stale', 'Old stuff that should not appear.', 'user'), expires: '2000-01-01' },
      // Fresh entry — survives.
      { ...makeMemory('Current', 'Fresh stuff.', 'user'), expires: '2999-12-31' },
    ], [])

    expect(section).toContain('## Current')
    expect(section).toContain('Fresh stuff.')
    expect(section).not.toContain('## Stale')
    expect(section).not.toContain('Old stuff that should not appear.')
  })

  test('omits the section entirely when every entry is expired', () => {
    expect(
      buildMemorySection(
        [{ ...makeMemory('Stale', 'Body.', 'user'), expires: '2000-01-01' }],
        [],
      ),
    ).toBe('')
  })
})
