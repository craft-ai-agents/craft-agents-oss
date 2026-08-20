import { describe, expect, it } from 'bun:test'
import {
  DOCK_TO_SLOT,
  createSiyuanBazaarProvider,
  defaultBridgeGrantedPermissions,
  detectCompatLevel,
  parseSiYuanPluginManifest,
  pluginJsonToCatalogEntry,
  pluginJsonToExtensionRecord,
  projectBridgeContributions,
  type PluginBridgeListItem,
  type SiYuanBridgeManifest,
} from '../index.ts'

const basePlugin = {
  name: 'demo-plugin',
  version: '1.2.3',
  author: 'alice',
  displayName: { en: 'Demo Plugin', zh_CN: '演示' },
  description: { en: 'A demo', ru: 'Демо' },
}

function craftManifest(
  level: 2 | 3,
  extra?: Partial<NonNullable<SiYuanBridgeManifest['craft']>>,
): SiYuanBridgeManifest {
  return {
    ...basePlugin,
    craft: {
      level,
      contributes: {
        commands: [
          {
            id: 'demo.hello',
            title: 'Hello',
            permissions: ['ui.command'],
          },
        ],
        docks: [{ position: 'LeftTop', title: 'Demo Dock', permissions: ['ui.panel'] }],
        tabs: [{ type: 'demo-tab', title: 'Demo Tab' }],
      },
      ...extra,
    },
  }
}

describe('parseSiYuanPluginManifest', () => {
  it('fail-soft returns null without name/version', () => {
    expect(parseSiYuanPluginManifest(null)).toBeNull()
    expect(parseSiYuanPluginManifest({})).toBeNull()
    expect(parseSiYuanPluginManifest({ name: 'x' })).toBeNull()
    expect(parseSiYuanPluginManifest({ version: '1' })).toBeNull()
  })

  it('parses name+version and optional craft loosely', () => {
    const m = parseSiYuanPluginManifest({
      ...basePlugin,
      craft: { level: 2, contributes: { commands: [{ id: 'a', title: 'A' }] } },
    })
    expect(m).not.toBeNull()
    expect(m!.name).toBe('demo-plugin')
    expect(m!.version).toBe('1.2.3')
    expect(m!.craft?.level).toBe(2)
    expect(m!.craft?.contributes?.commands?.[0]?.id).toBe('a')
  })

  it('drops invalid craft block', () => {
    const m = parseSiYuanPluginManifest({ ...basePlugin, craft: { level: 9 } })
    expect(m).not.toBeNull()
    expect(m!.craft).toBeUndefined()
  })
})

describe('detectCompatLevel', () => {
  it('returns L0 for null/invalid', () => {
    expect(detectCompatLevel(null)).toBe(0)
  })

  it('returns L1 for name+version without craft', () => {
    expect(detectCompatLevel(basePlugin)).toBe(1)
  })

  it('returns L2/L3 from craft.level', () => {
    expect(detectCompatLevel(craftManifest(2))).toBe(2)
    expect(detectCompatLevel(craftManifest(3))).toBe(3)
  })

  it('clamps to L1 when requiresFullChrome', () => {
    expect(detectCompatLevel(craftManifest(3, { requiresFullChrome: true }))).toBe(1)
  })

  it('clamps to L1 when capabilityProbeFailed', () => {
    expect(detectCompatLevel(craftManifest(3), { capabilityProbeFailed: true })).toBe(1)
  })
})

describe('DOCK_TO_SLOT', () => {
  it('maps all six SiYuan dock positions', () => {
    expect(DOCK_TO_SLOT.LeftTop).toBe('navigator-primary')
    expect(DOCK_TO_SLOT.LeftBottom).toBe('navigator-secondary')
    expect(DOCK_TO_SLOT.RightTop).toBe('inspector')
    expect(DOCK_TO_SLOT.RightBottom).toBe('inspector')
    expect(DOCK_TO_SLOT.BottomLeft).toBe('bottom')
    expect(DOCK_TO_SLOT.BottomRight).toBe('bottom')
    expect(Object.keys(DOCK_TO_SLOT)).toHaveLength(6)
  })
})

describe('projectBridgeContributions', () => {
  it('L0/L1 produce empty shell projections', () => {
    const l1 = projectBridgeContributions(basePlugin)
    expect(l1.level).toBe(1)
    expect(l1.pluginId).toBe('demo-plugin')
    expect(l1.commands).toEqual([])
    expect(l1.panels).toEqual([])
    expect(l1.surfaces).toEqual([])
    expect(l1.diagnostics.some((d) => d.kind === 'skipped-level')).toBe(true)

    const l0 = projectBridgeContributions(null)
    expect(l0.level).toBe(0)
    expect(l0.commands).toEqual([])
  })

  it('L2 projects commands with source siyuan-plugin when permitted', () => {
    const projected = projectBridgeContributions(craftManifest(2), {
      grantedPermissions: ['ui.command', 'ui.panel'],
    })
    expect(projected.level).toBe(2)
    expect(projected.commands).toHaveLength(1)
    expect(projected.commands[0]).toMatchObject({
      id: 'demo.hello',
      source: 'siyuan-plugin',
      pluginId: 'demo-plugin',
    })
    expect(projected.panels).toHaveLength(1)
    expect(projected.panels[0]?.slot).toBe('navigator-primary')
    expect(projected.surfaces).toHaveLength(1)
    expect(projected.surfaces[0]?.kind).toBe('extension')
  })

  it('permission fail-closed skips contributes missing grants', () => {
    const projected = projectBridgeContributions(craftManifest(2), {
      grantedPermissions: [], // explicit empty = user revoke / fail closed
    })
    expect(projected.commands).toEqual([])
    expect(projected.panels).toEqual([])
    expect(projected.diagnostics.filter((d) => d.kind === 'permission-denied').length).toBeGreaterThan(
      0,
    )
    // tabs have no permissions field → still allowed
    expect(projected.surfaces).toHaveLength(1)
  })

  it('omitted grantedPermissions defaults to declared contribute permissions', () => {
    const projected = projectBridgeContributions(craftManifest(2))
    expect(defaultBridgeGrantedPermissions(craftManifest(2)).sort()).toEqual(
      ['ui.command', 'ui.panel'].sort(),
    )
    expect(projected.commands).toHaveLength(1)
    expect(projected.commands[0]).toMatchObject({
      id: 'demo.hello',
      source: 'siyuan-plugin',
    })
    expect(projected.panels).toHaveLength(1)
  })

  it('allows contributes without permissions field', () => {
    const m: SiYuanBridgeManifest = {
      ...basePlugin,
      craft: {
        level: 2,
        contributes: {
          commands: [{ id: 'free.cmd', title: 'Free' }],
        },
      },
    }
    const projected = projectBridgeContributions(m, { grantedPermissions: [] })
    expect(projected.commands).toHaveLength(1)
    expect(projected.commands[0]?.id).toBe('free.cmd')
  })
})

describe('pluginJsonToExtensionRecord', () => {
  it('maps required ExtensionRecord fields', () => {
    const rec = pluginJsonToExtensionRecord(craftManifest(2), 2, true)
    expect(rec.id).toBe('siyuan-plugin:demo-plugin')
    expect(rec.manifest.runtime).toBe('siyuan-plugin')
    expect(rec.category).toBe('knowledge')
    expect(rec.providerId).toBe('siyuan-bazaar')
    expect(rec.status).toBe('enabled')
    expect(rec.readOnly).toBe(false)
    expect(rec.worksIn).toEqual([
      'Knowledge surface',
      'Compatibility mode',
      'Command palette',
      'Status bar',
    ])
    expect(rec.tags).toContain('compat-l2')
    expect(rec.tags).toContain('level:2')
    expect(rec.description).toBe('A demo')
  })

  it('tags requiresFullChrome when craft.requiresFullChrome', () => {
    const m = craftManifest(2, { requiresFullChrome: true })
    // Record builder takes explicit level (caller may clamp separately).
    const rec = pluginJsonToExtensionRecord(m, 1, true)
    expect(rec.tags).toContain('requiresFullChrome')
    expect(pluginJsonToCatalogEntry(m, 1).tags).toContain('requiresFullChrome')
  })

  it('pluginJsonToCatalogEntry attaches optional bazaar install coords', () => {
    const entry = pluginJsonToCatalogEntry(
      {
        name: 'demo-plugin',
        version: '1.2.3',
      },
      1,
      {
        bazaar: {
          packageName: 'demo-plugin',
          repoURL: 'https://github.com/ex/demo',
          repoHash: 'deadbeef',
        },
      },
    )
    expect(entry.bazaar).toEqual({
      packageName: 'demo-plugin',
      repoURL: 'https://github.com/ex/demo',
      repoHash: 'deadbeef',
    })
    expect(entry.providerId).toBe('siyuan-bazaar')
    expect(entry.runtime).toBe('siyuan-plugin')
  })

  it('L3 worksIn includes Panels and Agent tools; disabled status', () => {
    const rec = pluginJsonToExtensionRecord(craftManifest(3), 3, false)
    expect(rec.status).toBe('disabled')
    expect(rec.worksIn).toContain('Panels')
    expect(rec.worksIn).toContain('Agent tools')
    expect(rec.tags).toContain('compat-l3')
  })
})

describe('createSiyuanBazaarProvider', () => {
  it('lists catalog entries from in-memory listFn', async () => {
    const provider = createSiyuanBazaarProvider(() => [craftManifest(2)])
    expect(provider.id).toBe('siyuan-bazaar')
    const entries = await provider.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe('siyuan-plugin:demo-plugin')
    expect(entries[0]?.runtime).toBe('siyuan-plugin')
    expect(entries[0]?.providerId).toBe('siyuan-bazaar')
    expect(entries[0]?.category).toBe('knowledge')
  })

  it('default listFn returns empty', async () => {
    const provider = createSiyuanBazaarProvider()
    expect(await provider.list()).toEqual([])
  })

  it('listItem tags include requiresFullChrome when set', async () => {
    const item: PluginBridgeListItem = {
      id: 'siyuan-plugin:chrome-plugin',
      name: 'chrome-plugin',
      version: '1.0.0',
      enabled: true,
      level: 1,
      requiresFullChrome: true,
    }
    const provider = createSiyuanBazaarProvider(() => [item])
    const entries = await provider.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.tags).toContain('requiresFullChrome')
    expect(entries[0]?.tags).toContain('compat-l1')
  })
})
