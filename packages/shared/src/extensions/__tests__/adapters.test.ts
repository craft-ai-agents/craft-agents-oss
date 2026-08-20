import { describe, expect, it } from 'bun:test'
import type { MarketplaceEntry } from '../../marketplace/catalog.ts'
import type { LoadedSkill } from '../../skills/types.ts'
import type { LoadedSource } from '../../sources/types.ts'
import type { AutomationsConfig } from '../../automations/types.ts'
import {
  marketplaceEntryToCatalogEntry,
  marketplaceEntryToRecord,
  skillToExtensionRecord,
  sourceToExtensionRecord,
  automationsToExtensionRecords,
} from '../adapters/index.ts'

const skillpack: MarketplaceEntry = {
  id: 'demo-skills',
  kind: 'skillpack',
  title: 'Demo Skills',
  descriptionRu: 'Пакет навыков',
  source: { type: 'github', repo: 'acme/demo', ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  skills: ['foo', 'bar'],
  tags: ['demo'],
}

const tool: MarketplaceEntry = {
  id: 'omp-tool',
  kind: 'tool',
  title: 'OMP',
  descriptionRu: 'Agent runtime',
  source: { type: 'github', repo: 'acme/omp', ref: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  toolName: 'omp',
}

describe('marketplace adapter', () => {
  it('maps skillpack → skill-pack / skills', () => {
    const c = marketplaceEntryToCatalogEntry(skillpack)
    expect(c.id).toBe('marketplace:demo-skills')
    expect(c.runtime).toBe('skill-pack')
    expect(c.category).toBe('skills')
    expect(c.providerId).toBe('craft-curated')
    expect(c.marketplaceId).toBe('demo-skills')
    expect(c.permissions).toContain('ui.command')
  })

  it('maps tool → agent-runtime / agent-runtimes', () => {
    const c = marketplaceEntryToCatalogEntry(tool)
    expect(c.runtime).toBe('agent-runtime')
    expect(c.category).toBe('agent-runtimes')
  })

  it('maps context-doc → craft-native / knowledge', () => {
    const entry: MarketplaceEntry = {
      id: 'agents-md',
      kind: 'context-doc',
      title: 'AGENTS',
      descriptionRu: 'doc',
      source: { type: 'github', repo: 'a/b', ref: 'cccccccccccccccccccccccccccccccccccccccc' },
      documents: [{ repoPath: 'AGENTS.md', targetName: 'agents.md' }],
    }
    const c = marketplaceEntryToCatalogEntry(entry)
    expect(c.runtime).toBe('craft-native')
    expect(c.category).toBe('knowledge')
  })

  it('installed lock → enabled record; enabled:false → disabled', () => {
    const locked = marketplaceEntryToRecord(skillpack, {
      lock: {
        id: skillpack.id,
        kind: 'skillpack',
        repo: skillpack.source.repo,
        ref: skillpack.source.ref,
        installedAt: 1,
        status: 'installed',
        targets: ['/tmp/x'],
      },
    })
    expect(locked.status).toBe('enabled')
    const off = marketplaceEntryToRecord(skillpack, {
      lock: locked.manifest ? ({
        id: skillpack.id,
        kind: 'skillpack',
        repo: skillpack.source.repo,
        ref: skillpack.source.ref,
        installedAt: 1,
        status: 'installed',
        targets: ['/tmp/x'],
      }) : null,
      enabled: false,
    })
    expect(off.status).toBe('disabled')
    const available = marketplaceEntryToRecord(skillpack)
    expect(available.status).toBe('available')
  })

  it('lock.ref !== catalog source.ref → update-available', () => {
    const drifted = marketplaceEntryToRecord(skillpack, {
      lock: {
        id: skillpack.id,
        kind: 'skillpack',
        repo: skillpack.source.repo,
        ref: 'cccccccccccccccccccccccccccccccccccccccc',
        installedAt: 1,
        status: 'installed',
        targets: ['/tmp/x'],
      },
    })
    expect(drifted.status).toBe('update-available')
    expect(drifted.marketplaceId).toBe('demo-skills')
  })
})

describe('skills adapter', () => {
  it('projects LoadedSkill to skill-pack record', () => {
    const skill: LoadedSkill = {
      slug: 'review',
      metadata: {
        name: 'Code Review',
        description: 'Review PRs',
        alwaysAllow: ['Read', 'Bash'],
        requiredSources: ['github'],
      },
      content: 'body',
      path: '/tmp/skills/review',
      source: 'workspace',
    }
    const rec = skillToExtensionRecord(skill)
    expect(rec.id).toBe('skill:workspace:review')
    expect(rec.manifest.runtime).toBe('skill-pack')
    expect(rec.category).toBe('skills')
    expect(rec.readOnly).toBe(true)
    expect(rec.manifest.permissions).toContain('shell.execute')
    expect(rec.manifest.permissions).toContain('filesystem.read')
    expect(rec.manifest.dependencies).toEqual(['github'])
    expect(rec.installTarget).toBe('workspace')
  })
})

describe('sources adapter', () => {
  it('projects LoadedSource to mcp-source record', () => {
    const source = {
      config: {
        id: '1',
        name: 'Linear',
        slug: 'linear',
        enabled: true,
        provider: 'linear',
        type: 'mcp' as const,
        isAuthenticated: true,
        connectionStatus: 'connected' as const,
      },
      guide: null,
      folderPath: '/ws/sources/linear',
      workspaceRootPath: '/ws',
      workspaceId: 'ws1',
    } satisfies LoadedSource
    const rec = sourceToExtensionRecord(source)
    expect(rec.id).toBe('source:ws1:linear')
    expect(rec.manifest.runtime).toBe('mcp-source')
    expect(rec.category).toBe('sources')
    expect(rec.readOnly).toBe(true)
    expect(rec.manifest.permissions.some((p) => p.startsWith('secrets.use:'))).toBe(true)
  })
})

describe('automations adapter', () => {
  it('flattens AutomationsConfig into automation-pack records', () => {
    const config: AutomationsConfig = {
      automations: {
        SessionStart: [
          {
            id: 'abc123',
            name: 'Greet',
            enabled: true,
            actions: [{ type: 'prompt', prompt: 'hello' }],
          },
          {
            id: 'def456',
            enabled: false,
            actions: [{ type: 'webhook', url: 'https://example.com/hook' }],
          },
        ],
      },
    }
    const recs = automationsToExtensionRecords(config, 'ws1')
    expect(recs).toHaveLength(2)
    expect(recs[0]!.id).toBe('automation:ws1:SessionStart:abc123')
    expect(recs[0]!.manifest.runtime).toBe('automation-pack')
    expect(recs[0]!.status).toBe('enabled')
    expect(recs[0]!.manifest.permissions).toContain('sessions.create')
    expect(recs[1]!.status).toBe('disabled')
    expect(recs[1]!.manifest.permissions).toContain('network.request')
  })
})
