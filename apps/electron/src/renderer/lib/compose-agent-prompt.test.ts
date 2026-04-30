import { describe, expect, test } from 'bun:test'
import { buildAgentBundleFooter, composeAgentSystemPrompt } from './compose-agent-prompt'
import type { AgentDefinitionDTO, LoadedSkill, LoadedSource } from '../../shared/types'

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
