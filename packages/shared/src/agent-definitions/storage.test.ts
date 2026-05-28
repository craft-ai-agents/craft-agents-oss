import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseAgentFile,
  serializeAgent,
  isValidAgentSlug,
  readActivatedAgents,
  writeActivatedAgents,
  setAgentActive,
  loadActivatedAgents,
  loadAllGlobalAgents,
  loadGlobalAgent,
  writeGlobalAgent,
  deleteGlobalAgent,
  seedGlobalLibraryIfEmpty,
  ensureRequiredAgents,
  ensureBuiltInAgentSkills,
  ensureBuiltInAgentSkillsForSlug,
  replaceBuiltInAgentPromptPattern,
  replaceBuiltInAgentPromptText,
  removeBuiltInAgentSkills,
} from './storage.ts'
import { STARTER_AGENTS } from './starter-templates.ts'
import { SOCIAL_PUBLISHER_SLUG } from './types.ts'

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'craft-agent-defs-test-'))
}

function tmpGlobalAgentsDir(): string {
  return mkdtempSync(join(tmpdir(), 'craft-agent-defs-global-test-'))
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
visualAgent: true
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
    expect(parsed!.metadata.visualAgent).toBe(true)
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

  test('coerces invalid permissionMode to undefined and returns a warning', () => {
    const md = `---
name: x
description: y
permissionMode: GOD_MODE
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.permissionMode).toBeUndefined()
    expect(parsed!.warnings).toContainEqual({
      field: 'permissionMode',
      code: 'invalid-permission-mode',
      message: 'permissionMode must be one of: safe, ask, allow-all.',
    })
  })

  test('coerces invalid thinkingLevel to undefined and returns a warning', () => {
    const md = `---
name: x
description: y
thinkingLevel: galaxy-brain
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.thinkingLevel).toBeUndefined()
    expect(parsed!.warnings[0]?.field).toBe('thinkingLevel')
    expect(parsed!.warnings[0]?.code).toBe('invalid-thinking-level')
  })

  test('warns when skills and sources have invalid shapes', () => {
    const md = `---
name: x
description: y
skills:
  nested: nope
sources:
  - github
  - 123
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.skills).toBeUndefined()
    expect(parsed!.metadata.sources).toEqual(['github'])
    expect(parsed!.warnings.map((w) => w.field)).toEqual(['skills', 'sources'])
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

  test('parses capability fields (inputs, outputs, tags)', () => {
    const md = `---
name: x
description: y
inputs: A topic and the depth.
outputs: A cited summary.
tags:
  - research
  - summarize
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.inputs).toBe('A topic and the depth.')
    expect(parsed!.metadata.outputs).toBe('A cited summary.')
    expect(parsed!.metadata.tags).toEqual(['research', 'summarize'])
  })

  test('accepts comma-separated tags string', () => {
    const md = `---
name: x
description: y
tags: research, summarize, cite
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.tags).toEqual(['research', 'summarize', 'cite'])
  })

  test('drops malformed tags with a warning', () => {
    const md = `---
name: x
description: y
tags:
  - research
  - "Bad Tag With Spaces"
  - SHOUTING
---
body
`
    const parsed = parseAgentFile(md)
    // SHOUTING normalizes to 'shouting' (valid); the spaces tag is dropped.
    expect(parsed!.metadata.tags).toEqual(['research', 'shouting'])
    expect(parsed!.warnings.some((w) => w.code === 'invalid-tags')).toBe(true)
  })

  test('caps tags at 8', () => {
    const md = `---
name: x
description: y
tags:
  - a
  - b
  - c
  - d
  - e
  - f
  - g
  - h
  - i
  - j
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.tags).toHaveLength(8)
    expect(parsed!.warnings.some((w) => w.code === 'invalid-tags')).toBe(true)
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
        visualAgent: true,
        inputs: 'A topic.',
        outputs: 'A summary.',
        tags: ['research', 'summarize'],
      },
      'You are a test agent.',
    )

    const parsed = parseAgentFile(original)
    expect(parsed!.metadata.name).toBe('Round Trip')
    expect(parsed!.metadata.avatar).toBe('🔄')
    expect(parsed!.metadata.permissionMode).toBe('safe')
    expect(parsed!.metadata.skills).toEqual(['a', 'b'])
    expect(parsed!.metadata.sources).toEqual(['s1'])
    expect(parsed!.metadata.visualAgent).toBe(true)
    expect(parsed!.metadata.inputs).toBe('A topic.')
    expect(parsed!.metadata.outputs).toBe('A summary.')
    expect(parsed!.metadata.tags).toEqual(['research', 'summarize'])
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
    expect(out).not.toContain('visualAgent:')
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
  let workspace: string
  let globalAgentsDir: string

  beforeEach(() => {
    workspace = tmpWorkspace()
    globalAgentsDir = tmpGlobalAgentsDir()
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
    rmSync(globalAgentsDir, { recursive: true, force: true })
  })

  test('writeGlobalAgent writes to the injected global dir and can reload', () => {
    const loaded = writeGlobalAgent(
      {
        slug: 'researcher',
        metadata: {
          name: 'Researcher',
          description: 'Investigates topics.',
          skills: ['web-research'],
        },
        systemPrompt: 'You are a researcher.\nReturn structured findings.',
      },
      { globalAgentsDir },
    )

    expect(loaded.slug).toBe('researcher')
    expect(loaded.path).toBe(join(globalAgentsDir, 'researcher'))
    expect(existsSync(join(globalAgentsDir, 'researcher', 'AGENT.md'))).toBe(true)

    const reloaded = loadGlobalAgent('researcher', { globalAgentsDir })
    expect(reloaded!.metadata.name).toBe('Researcher')
    expect(reloaded!.metadata.skills).toEqual(['web-research'])
    expect(reloaded!.systemPrompt).toContain('structured findings')
  })

  test('loadAllGlobalAgents includes non-fatal parse warnings', () => {
    const dir = join(globalAgentsDir, 'warns')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'AGENT.md'), `---
name: Warns
description: Has bad optional fields.
permissionMode: nope
sources: 42
---
body
`, 'utf-8')

    const agents = loadAllGlobalAgents({ globalAgentsDir })
    expect(agents).toHaveLength(1)
    expect(agents[0]!.parseWarnings?.map((w) => w.field)).toEqual(['permissionMode', 'sources'])
  })

  test('deleteGlobalAgent removes the agent and cleans workspace manifests', () => {
    writeGlobalAgent(
      {
        slug: 'writer',
        metadata: { name: 'Writer', description: 'Writes.' },
        systemPrompt: 'Write.',
      },
      { globalAgentsDir },
    )
    writeActivatedAgents(workspace, ['writer', 'researcher'])

    expect(deleteGlobalAgent('writer', [workspace], { globalAgentsDir })).toBe(true)
    expect(existsSync(join(globalAgentsDir, 'writer'))).toBe(false)
    expect(readActivatedAgents(workspace).active).toEqual(['researcher'])
  })

  test('loadActivatedAgents self-heals stale manifest entries for missing globals', () => {
    writeGlobalAgent(
      {
        slug: 'present',
        metadata: { name: 'Present', description: 'Still exists.' },
        systemPrompt: 'Present.',
      },
      { globalAgentsDir },
    )
    writeActivatedAgents(workspace, ['missing', 'present'])

    const loaded = loadActivatedAgents(workspace, { globalAgentsDir })
    expect(loaded.map((a) => a.slug)).toEqual(['present'])
    expect(readActivatedAgents(workspace).active).toEqual(['present'])
  })

  test('seedGlobalLibraryIfEmpty writes starters once to the injected global dir', () => {
    const starters = [
      {
        slug: 'starter',
        metadata: { name: 'Starter', description: 'Seeded.' },
        systemPrompt: 'Seed.',
      },
    ]

    expect(seedGlobalLibraryIfEmpty(starters, { globalAgentsDir }).seeded).toBe(1)
    expect(loadGlobalAgent('starter', { globalAgentsDir })!.metadata.name).toBe('Starter')

    rmSync(join(globalAgentsDir, 'starter'), { recursive: true, force: true })
    expect(seedGlobalLibraryIfEmpty(starters, { globalAgentsDir }).seeded).toBe(0)
    expect(loadGlobalAgent('starter', { globalAgentsDir })).toBeNull()
  })

  test('ensureRequiredAgents can be tested against the injected global dir', () => {
    const required = [
      {
        slug: 'orchestrator',
        metadata: { name: 'Orchestrator', description: 'Coordinates.' },
        systemPrompt: 'Coordinate.',
      },
    ]

    expect(ensureRequiredAgents(required, { globalAgentsDir }).ensured).toBe(1)
    expect(ensureRequiredAgents(required, { globalAgentsDir }).ensured).toBe(0)
    expect(loadGlobalAgent('orchestrator', { globalAgentsDir })!.metadata.name).toBe('Orchestrator')
  })

  test('starter library includes the social publisher with the Printing Press source', () => {
    const socialPublisher = STARTER_AGENTS.find((agent) => agent.slug === SOCIAL_PUBLISHER_SLUG)

    expect(socialPublisher?.metadata.skills).toEqual(['social-publishing'])
    expect(socialPublisher?.metadata.sources).toEqual(['printing-press-social'])
    expect(socialPublisher?.systemPrompt).toContain('browser_tool')
    expect(socialPublisher?.systemPrompt).toContain('chrome-cdp')
    expect(socialPublisher?.systemPrompt).toContain('not Playwright')
  })

  test('starter library includes the Ads Agent with bundled Google Ads source', () => {
    const adsAgent = STARTER_AGENTS.find((agent) => agent.slug === 'ads-agent')

    expect(adsAgent?.metadata.skills).toContain('google-ads')
    expect(adsAgent?.metadata.skills).toContain('ad-creative')
    expect(adsAgent?.metadata.sources).toContain('google-ads')
    expect(adsAgent?.metadata.sources).toContain('meta-ads')
    expect(adsAgent?.systemPrompt).toContain('node bin/google-ads.mjs')
    expect(adsAgent?.systemPrompt).toContain('explicit user approval')
  })

  test('starter library includes the YouTube Research Agent as read-only', () => {
    const youtubeAgent = STARTER_AGENTS.find((agent) => agent.slug === 'youtube-research-agent')

    expect(youtubeAgent?.metadata.skills).toContain('youtube-research')
    expect(youtubeAgent?.metadata.sources).toContain('youtube-research')
    expect(youtubeAgent?.systemPrompt).toContain('node bin/youtube-research.mjs')
    expect(youtubeAgent?.systemPrompt).toContain('You do not publish')
  })

  test('starter library includes the Hypermotion Agent with bundled motion source', () => {
    const hypermotionAgent = STARTER_AGENTS.find((agent) => agent.slug === 'hypermotion-agent')

    expect(hypermotionAgent).toBeDefined()
    expect(hypermotionAgent?.metadata.visualAgent).toBe(true)
    expect(hypermotionAgent?.metadata.skills).toContain('hyperframes')
    expect(hypermotionAgent?.metadata.skills).toContain('remotion-production')
    expect(hypermotionAgent?.metadata.sources).toContain('hypermotion')
    expect(hypermotionAgent?.systemPrompt).toContain('node bin/hypermotion.mjs doctor')
    expect(hypermotionAgent?.systemPrompt).toContain('showInCanvas')
  })

  test('starter library includes the Update System Agent as read-only maintenance', () => {
    const updateAgent = STARTER_AGENTS.find((agent) => agent.slug === 'update-system-agent')

    expect(updateAgent).toBeDefined()
    expect(updateAgent?.metadata.permissionMode).toBe('safe')
    expect(updateAgent?.metadata.tags).toContain('maintenance')
    expect(updateAgent?.systemPrompt).toContain('update_system_audit.py')
  })

  test('ensureRequiredAgents does not recreate an app-deleted required agent', () => {
    const required = [
      {
        slug: 'orchestrator',
        metadata: { name: 'Orchestrator', description: 'Coordinates.' },
        systemPrompt: 'Coordinate.',
      },
    ]

    ensureRequiredAgents(required, { globalAgentsDir })
    expect(deleteGlobalAgent('orchestrator', [], { globalAgentsDir })).toBe(true)

    expect(ensureRequiredAgents(required, { globalAgentsDir }).ensured).toBe(0)
    expect(loadGlobalAgent('orchestrator', { globalAgentsDir })).toBeNull()

    writeGlobalAgent(required[0]!, { globalAgentsDir })
    expect(loadGlobalAgent('orchestrator', { globalAgentsDir })!.metadata.name).toBe('Orchestrator')
  })

  test('removeBuiltInAgentSkills strips creator skills without touching prompt bodies', () => {
    writeGlobalAgent(
      {
        slug: 'concierge',
        metadata: {
          name: 'Concierge',
          description: 'Routes requests.',
          skills: ['agent-creator', 'custom-skill', 'automation-creator'],
        },
        systemPrompt: 'Custom body stays intact.',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'writer',
        metadata: {
          name: 'Writer',
          description: 'Writes.',
          skills: ['agent-creator'],
        },
        systemPrompt: 'Writer body.',
      },
      { globalAgentsDir },
    )

    expect(removeBuiltInAgentSkills(['agent-creator', 'automation-creator'], { globalAgentsDir }).updated).toBe(1)
    const concierge = loadGlobalAgent('concierge', { globalAgentsDir })!
    expect(concierge.metadata.skills).toEqual(['custom-skill'])
    expect(concierge.systemPrompt).toBe('Custom body stays intact.')
    expect(loadGlobalAgent('writer', { globalAgentsDir })!.metadata.skills).toEqual(['agent-creator'])
  })

  test('can add built-in skills to one built-in agent without touching the other', () => {
    writeGlobalAgent(
      {
        slug: 'concierge',
        metadata: { name: 'Concierge', description: 'Routes requests.', skills: ['agent-creator'] },
        systemPrompt: 'Concierge body.',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'orchestrator',
        metadata: { name: 'Orchestrator', description: 'Plans work.', skills: ['agent-creator'] },
        systemPrompt: 'Orchestrator body.',
      },
      { globalAgentsDir },
    )

    expect(ensureBuiltInAgentSkillsForSlug('concierge', ['runneros-self-edit'], { globalAgentsDir }).updated).toBe(true)
    expect(loadGlobalAgent('concierge', { globalAgentsDir })!.metadata.skills).toEqual(['agent-creator', 'runneros-self-edit'])
    expect(loadGlobalAgent('orchestrator', { globalAgentsDir })!.metadata.skills).toEqual(['agent-creator'])
  })

  test('ensureBuiltInAgentSkills still applies shared skills to both built-ins', () => {
    writeGlobalAgent(
      {
        slug: 'concierge',
        metadata: { name: 'Concierge', description: 'Routes requests.', skills: [] },
        systemPrompt: 'Concierge body.',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'orchestrator',
        metadata: { name: 'Orchestrator', description: 'Plans work.', skills: [] },
        systemPrompt: 'Orchestrator body.',
      },
      { globalAgentsDir },
    )

    expect(ensureBuiltInAgentSkills(['agent-creator'], { globalAgentsDir }).updated).toBe(2)
    expect(loadGlobalAgent('concierge', { globalAgentsDir })!.metadata.skills).toEqual(['agent-creator'])
    expect(loadGlobalAgent('orchestrator', { globalAgentsDir })!.metadata.skills).toEqual(['agent-creator'])
  })

  test('replaceBuiltInAgentPromptText only patches built-in prompt bodies on exact match', () => {
    writeGlobalAgent(
      {
        slug: 'concierge',
        metadata: {
          name: 'Concierge',
          description: 'Routes requests.',
          skills: ['agent-creator'],
        },
        systemPrompt: 'Before\nold shipped paragraph\nAfter',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'writer',
        metadata: { name: 'Writer', description: 'Writes.' },
        systemPrompt: 'old shipped paragraph',
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentPromptText('concierge', 'old shipped paragraph', 'new shipped paragraph', { globalAgentsDir }).updated).toBe(true)
    expect(loadGlobalAgent('concierge', { globalAgentsDir })!.systemPrompt).toBe('Before\nnew shipped paragraph\nAfter')
    expect(replaceBuiltInAgentPromptText('writer', 'old shipped paragraph', 'new shipped paragraph', { globalAgentsDir }).updated).toBe(false)
    expect(loadGlobalAgent('writer', { globalAgentsDir })!.systemPrompt).toBe('old shipped paragraph')
  })

  test('replaceBuiltInAgentPromptPattern patches wrapped stale built-in guidance', () => {
    writeGlobalAgent(
      {
        slug: 'concierge',
        metadata: { name: 'Concierge', description: 'Routes requests.' },
        systemPrompt: 'Intro\nWhen the user wants creator help,\nDo not load creator\nskills unless the user explicitly asks for them.\nOutro',
      },
      { globalAgentsDir },
    )

    const pattern = /When the user wants creator help,[\s\S]*?Do not load creator\s+skills unless the user explicitly asks for them\./
    expect(replaceBuiltInAgentPromptPattern('concierge', pattern, 'Use baked-in creator skills.', { globalAgentsDir }).updated).toBe(true)
    expect(loadGlobalAgent('concierge', { globalAgentsDir })!.systemPrompt).toBe('Intro\nUse baked-in creator skills.\nOutro')
  })
})
