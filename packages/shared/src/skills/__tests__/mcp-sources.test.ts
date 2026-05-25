import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { extractMcpSourceCandidatesFromSkillMetadata } from '../mcp-sources.ts'
import type { SkillMetadata } from '../types.ts'

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'skill-mcp-sources-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('extractMcpSourceCandidatesFromSkillMetadata', () => {
  it('extracts MDP MCP clients into source import candidates', () => {
    const metadata: SkillMetadata = {
      name: 'User Context',
      description: 'Reads user context',
      metadata: {
        builtin_skill_version: '1.2',
        mdp: {
          mcp: {
            clients: {
              'mbank-lego-server': {
                name: 'mbank-lego-server',
                description: 'Lego project management MCP',
                enabled: true,
                transport: 'streamable_http',
                url: 'https://lego.example.com/mcp',
              },
            },
          },
        },
      },
    }

    const candidates = extractMcpSourceCandidatesFromSkillMetadata(metadata, workspaceRoot)

    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.input).toMatchObject({
      name: 'mbank-lego-server',
      provider: 'mbank-lego-server',
      type: 'mcp',
      enabled: true,
      mcp: {
        transport: 'streamable_http',
        url: 'https://lego.example.com/mcp',
      },
    })
    expect(candidates[0]!.description).toBe('Lego project management MCP')
  })

  it('returns no candidates when skill metadata has no MCP clients', () => {
    const candidates = extractMcpSourceCandidatesFromSkillMetadata({
      name: 'Plain Skill',
      description: 'No source metadata',
    }, workspaceRoot)

    expect(candidates).toEqual([])
  })
})
