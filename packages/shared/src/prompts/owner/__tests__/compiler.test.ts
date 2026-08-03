import { describe, it, expect, beforeEach } from 'bun:test'
import { PromptCompiler } from '../compiler.ts'
import { validateLayer, validateSnapshot, isPromptSafe } from '../validator.ts'
import type { CompileOptions } from '../types.ts'

describe('PromptCompiler', () => {
  let compiler: PromptCompiler

  beforeEach(() => {
    compiler = new PromptCompiler()
  })

  describe('compile with defaults', () => {
    it('produces a non-empty prompt with all default layers', () => {
      const result = compiler.compile()
      expect(result.snapshot.prompt).toBeTruthy()
      expect(result.snapshot.layers.length).toBe(8)
      expect(result.snapshot.prompt.length).toBeGreaterThan(100)
      expect(result.snapshot.estimatedTokens).toBeGreaterThan(0)
    })

    it('includes the runtime contract layer', () => {
      const result = compiler.compile()
      const runtimeLayer = result.snapshot.layers.find(l => l.id === 'runtime-contract')
      expect(runtimeLayer).toBeTruthy()
      expect(runtimeLayer!.content).toContain('ARCHstudio')
      expect(runtimeLayer!.stability).toBe('stable')
    })

    it('includes the owner identity layer with defaults', () => {
      const result = compiler.compile()
      const ownerLayer = result.snapshot.layers.find(l => l.id === 'owner-identity')
      expect(ownerLayer).toBeTruthy()
      expect(ownerLayer!.content).toContain('Owner')
    })

    it('includes the execution policy layer', () => {
      const result = compiler.compile()
      const policyLayer = result.snapshot.layers.find(l => l.id === 'execution-policy')
      expect(policyLayer).toBeTruthy()
      expect(policyLayer!.content).toContain('owner-auto')
    })
  })

  describe('compile with profile overrides', () => {
    it('injects owner name and tone', () => {
      const options: CompileOptions = {
        ownerProfile: {
          name: 'Skobez',
          aliases: ['Richard'],
          locale: 'en',
          timezone: 'America/New_York',
          tone: 'Direct and technical, never apologetic',
          verbosity: 2,
          bannedPhrases: ["I'm sorry", 'As an AI'],
        },
      }

      const result = compiler.compile(options)
      const ownerLayer = result.snapshot.layers.find(l => l.id === 'owner-identity')
      expect(ownerLayer).toBeTruthy()
      expect(ownerLayer!.content).toContain('Skobez')
      expect(ownerLayer!.content).toContain('America/New_York')
      expect(ownerLayer!.content).toContain("I'm sorry")
      expect(ownerLayer!.content).toContain('Direct and technical, never apologetic')
    })

    it('injects execution policy overrides', () => {
      const options: CompileOptions = {
        executionPolicy: {
          defaultMode: 'explore',
          askOnlyWhen: ['write-file', 'delete-file'],
          allowedRoots: ['D:\\craft-agents-oss'],
        },
      }

      const result = compiler.compile(options)
      const policyLayer = result.snapshot.layers.find(l => l.id === 'execution-policy')
      expect(policyLayer).toBeTruthy()
      expect(policyLayer!.content).toContain('explore')
      expect(policyLayer!.content).toContain('D:\\craft-agents-oss')
    })
  })

  describe('compile with volatile layers', () => {
    it('includes memories in the memory layer', () => {
      const options: CompileOptions = {
        memories: [
          { title: 'Project Structure', content: 'Uses Bun monorepo with workspaces', score: 0.95 },
          { title: 'Coding Convention', content: 'Use TypeScript strict mode', score: 0.82 },
        ],
      }

      const result = compiler.compile(options)
      const memoryLayer = result.snapshot.layers.find(l => l.id === 'memory')
      expect(memoryLayer).toBeTruthy()
      expect(memoryLayer!.content).toContain('Project Structure')
      expect(memoryLayer!.content).toContain('Coding Convention')
    })

    it('includes session state', () => {
      const options: CompileOptions = {
        sessionState: {
          sessionId: 'sess-123',
          permissionMode: 'owner-auto',
          plansFolderPath: '/tmp/plans',
          dataFolderPath: '/tmp/data',
        },
      }

      const result = compiler.compile(options)
      const stateLayer = result.snapshot.layers.find(l => l.id === 'session-state')
      expect(stateLayer).toBeTruthy()
      expect(stateLayer!.content).toContain('sess-123')
      expect(stateLayer!.content).toContain('owner-auto')
    })

    it('includes active capabilities', () => {
      const options: CompileOptions = {
        capabilities: ['Codex (ChatGPT)', 'Ollama Local', 'ComfyUI'],
      }

      const result = compiler.compile(options)
      const capLayer = result.snapshot.layers.find(l => l.id === 'capabilities')
      expect(capLayer).toBeTruthy()
      expect(capLayer!.content).toContain('Codex')
      expect(capLayer!.content).toContain('Ollama Local')
    })

    it('includes active skills', () => {
      const options: CompileOptions = {
        skills: ['Web research via Hermes', 'Git operations'],
      }

      const result = compiler.compile(options)
      const skillsLayer = result.snapshot.layers.find(l => l.id === 'skills')
      expect(skillsLayer).toBeTruthy()
      expect(skillsLayer!.content).toContain('Web research via Hermes')
    })

    it('includes project context with working directory', () => {
      const options: CompileOptions = {
        projectContext: {
          workingDirectory: '/home/user/project',
          contextFiles: [
            { filename: 'AGENTS.md', content: '# Project Context\n\nUse Bun for all scripts.' },
          ],
        },
      }

      const result = compiler.compile(options)
      const projLayer = result.snapshot.layers.find(l => l.id === 'project-context')
      expect(projLayer).toBeTruthy()
      expect(projLayer!.content).toContain('/home/user/project')
      expect(projLayer!.content).toContain('Use Bun for all scripts.')
    })
  })

  describe('layer ordering', () => {
    it('uses the default order when no override given', () => {
      const result = compiler.compile()
      const ids = result.snapshot.layerOrder
      expect(ids[0]).toBe('runtime-contract')
      expect(ids[1]).toBe('owner-identity')
      expect(ids[2]).toBe('execution-policy')
      expect(ids[3]).toBe('project-context')
      expect(ids[4]).toBe('skills')
      expect(ids[5]).toBe('memory')
      expect(ids[6]).toBe('session-state')
      expect(ids[7]).toBe('capabilities')
    })

    it('respects custom layer order', () => {
      const options: CompileOptions = {
        layerOrder: ['runtime-contract', 'execution-policy', 'owner-identity'],
      }

      const result = compiler.compile(options)
      expect(result.snapshot.layerOrder).toEqual(['runtime-contract', 'execution-policy', 'owner-identity'])
      expect(result.snapshot.layers.length).toBe(3)
    })
  })

  describe('caching', () => {
    it('caches stable layers across compilations', () => {
      // First compile — cache miss
      const result1 = compiler.compile({
        ownerProfile: {
          name: 'Skobez',
          aliases: [],
          locale: 'en',
          timezone: 'UTC',
          tone: 'Direct',
          verbosity: 3,
          bannedPhrases: [],
        },
      })

      // Second compile — cache hit
      const result2 = compiler.compile({
        ownerProfile: {
          name: 'Skobez',
          aliases: [],
          locale: 'en',
          timezone: 'UTC',
          tone: 'Direct',
          verbosity: 3,
          bannedPhrases: [],
        },
      })

      // Both should produce identical output
      expect(result1.snapshot.prompt).toBe(result2.snapshot.prompt)
    })

    it('invalidates cache when profile changes', () => {
      const result1 = compiler.compile({
        ownerProfile: {
          name: 'Skobez',
          aliases: [],
          locale: 'en',
          timezone: 'UTC',
          tone: 'Direct',
          verbosity: 3,
          bannedPhrases: [],
        },
      })

      compiler.invalidateAll()

      const result2 = compiler.compile({
        ownerProfile: {
          name: 'Skobez Jr',
          aliases: [],
          locale: 'en',
          timezone: 'UTC',
          tone: 'Warmer',
          verbosity: 4,
          bannedPhrases: [],
        },
      })

      // Second should have different prompt because cache was invalidated
      expect(result2.snapshot.prompt).not.toBe(result1.snapshot.prompt)
    })
  })
})

describe('validateLayer', () => {
  it('passes a valid layer', () => {
    const result = validateLayer({
      id: 'test-layer',
      name: 'Test Layer',
      version: 1,
      stability: 'stable',
      content: 'This is test content.',
    })
    expect(result.valid).toBe(true)
    expect(result.issues.length).toBe(0)
  })

  it('rejects a layer with missing id', () => {
    const result = validateLayer({
      id: '',
      name: 'Bad',
      version: 1,
      stability: 'stable',
      content: 'content',
    })
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.message.includes('id'))).toBe(true)
  })

  it('detects credential leakage', () => {
    const result = validateLayer({
      id: 'leaky',
      name: 'Leaky',
      version: 1,
      stability: 'stable',
      content: 'My API key is sk-abc123def456ghijklmnopqr123456789012',
    })
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.message.includes('credential'))).toBe(true)
  })

  it('detects empty content', () => {
    const result = validateLayer({
      id: 'empty',
      name: 'Empty',
      version: 1,
      stability: 'stable',
      content: '',
    })
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.message.includes('empty'))).toBe(true)
  })
})

describe('validateSnapshot', () => {
  it('passes a valid snapshot', () => {
    const compiler = new PromptCompiler()
    const { snapshot } = compiler.compile()
    const result = validateSnapshot(snapshot)
    expect(result.valid).toBe(true)
  })

  it('rejects a snapshot with empty layer order', () => {
    const result = validateSnapshot({
      id: 'test',
      compilerVersion: 1,
      layerOrder: [],
      prompt: '',
      estimatedTokens: 0,
      layers: [],
      compiledAt: new Date().toISOString(),
    })
    expect(result.valid).toBe(false)
    expect(result.issues.some(i => i.message.includes('empty'))).toBe(true)
  })
})

describe('isPromptSafe', () => {
  it('returns true for normal prompt text', () => {
    expect(isPromptSafe('Hello world')).toBe(true)
  })

  it('returns false for NUL-containing text', () => {
    expect(isPromptSafe('Hello\x00world')).toBe(false)
  })

  it('returns false for empty text', () => {
    expect(isPromptSafe('')).toBe(false)
  })
})
