import { describe, expect, it } from 'bun:test'
import {
  CONTRIBUTION_KEYS,
  PLUGIN_CAPABILITY_TYPES,
  PLUGIN_PERMISSIONS,
  isPluginApiVersionSupported,
  isPluginEngineSatisfied,
  isPluginCapabilityType,
  isPluginPermission,
  listManifestCapabilityTypes,
  listManifestContributionIds,
  parsePluginManifest,
} from '../manifest'

describe('plugin manifest schema', () => {
  it('parses a minimal valid manifest', () => {
    const manifest = parsePluginManifest({
      id: 'codex-cli',
      name: 'Codex CLI',
      version: '1.0.0',
      apiVersion: '1.0.0',
      engines: { craftAgents: '^0.8.1' },
      permissions: ['network', 'session.read'],
      contributions: {
        backends: ['codex-cli-backend'],
        sessionActions: ['handoff-to-codex'],
      },
    })

    expect(manifest.id).toBe('codex-cli')
    expect(manifest.permissions).toEqual(['network', 'session.read'])
    expect(listManifestContributionIds(manifest)).toEqual(['codex-cli-backend', 'handoff-to-codex'])
    expect(listManifestCapabilityTypes(manifest)).toEqual(['backend', 'sessionAction'])
  })

  it('parses declarative UI capability metadata', () => {
    const manifest = parsePluginManifest({
      id: 'plugin-ui',
      name: 'Plugin UI',
      version: '1.0.0',
      apiVersion: '1.0.0',
      engines: { craftAgents: '^0.8.1' },
      permissions: ['ui.render'],
      contributions: {
        sessionActions: ['open-plugin-settings'],
        composerActions: ['insert-checklist'],
        chatCardTypes: ['tool-error-card'],
      },
      capabilityMetadata: {
        sessionActions: {
          'open-plugin-settings': {
            title: 'Plugin Settings',
            hook: 'session.actions',
            placement: 'menu',
            invoke: { type: 'navigate', route: 'settings/plugins' },
          },
        },
        composerActions: {
          'insert-checklist': {
            title: 'Insert Checklist',
            hook: 'composer.actions',
            placement: 'toolbar',
            invoke: { type: 'insertText', text: 'Review plugin hooks.', mode: 'append' },
          },
        },
        chatCardTypes: {
          'tool-error-card': {
            title: 'Tool Error Card',
            hook: 'chat.cards',
            tone: 'warning',
            matcher: { role: 'tool', isError: true },
          },
        },
      },
    })

    expect(manifest.capabilityMetadata?.sessionActions?.['open-plugin-settings']?.invoke).toEqual({
      type: 'navigate',
      route: 'settings/plugins',
    })
    expect(manifest.capabilityMetadata?.composerActions?.['insert-checklist']?.placement).toBe('toolbar')
    expect(manifest.capabilityMetadata?.chatCardTypes?.['tool-error-card']?.matcher).toEqual({
      role: 'tool',
      isError: true,
    })
  })

  it('rejects unknown permissions', () => {
    expect(() => parsePluginManifest({
      id: 'bad-plugin',
      name: 'Bad Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      engines: { craftAgents: '^0.8.1' },
      permissions: ['network', 'root.shell'],
      contributions: {},
    })).toThrow()
  })

  it('rejects non-semver-like versions', () => {
    expect(() => parsePluginManifest({
      id: 'bad-version',
      name: 'Bad Version',
      version: 'latest',
      apiVersion: '1.0.0',
      engines: { craftAgents: '^0.8.1' },
      permissions: [],
      contributions: {},
    })).toThrow('version must be semver-like')
  })

  it('exposes stable permission and capability enums', () => {
    expect(PLUGIN_PERMISSIONS.length).toBeGreaterThan(5)
    expect(PLUGIN_CAPABILITY_TYPES.length).toBeGreaterThan(5)
    expect(CONTRIBUTION_KEYS).toContain('backends')
    expect(CONTRIBUTION_KEYS).toContain('mcpAppProviders')
    expect(isPluginPermission('network')).toBe(true)
    expect(isPluginPermission('bogus')).toBe(false)
    expect(isPluginCapabilityType('backend')).toBe(true)
    expect(isPluginCapabilityType('bogus')).toBe(false)
  })

  it('requires plugin API versions to stay within the same major and not exceed the host contract', () => {
    expect(isPluginApiVersionSupported('1.0.0', '1.2.3')).toBe(true)
    expect(isPluginApiVersionSupported('1.2.3', '1.2.3')).toBe(true)
    expect(isPluginApiVersionSupported('1.9.0', '1.2.3')).toBe(false)
    expect(isPluginApiVersionSupported('2.0.0', '1.2.3')).toBe(false)
  })

  it('supports exact and caret engine requirements', () => {
    const ranged = parsePluginManifest({
      id: 'engines-plugin',
      name: 'Engines Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      engines: { craftAgents: '^0.8.1' },
      permissions: [],
      contributions: {},
    })
    const exact = parsePluginManifest({
      id: 'exact-plugin',
      name: 'Exact Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      engines: { craftAgents: '0.8.1' },
      permissions: [],
      contributions: {},
    })

    expect(isPluginEngineSatisfied(ranged, '0.8.1')).toBe(true)
    expect(isPluginEngineSatisfied(ranged, '0.8.2')).toBe(true)
    expect(isPluginEngineSatisfied(ranged, '0.9.0')).toBe(false)
    expect(isPluginEngineSatisfied(ranged, '1.0.0')).toBe(false)
    expect(isPluginEngineSatisfied(exact, '0.8.1')).toBe(true)
    expect(isPluginEngineSatisfied(exact, '0.8.2')).toBe(false)
  })
})
