import { describe, expect, it } from 'bun:test'
import {
  ExtensionManifestValidationError,
  parseExtensionManifest,
  tryParseExtensionManifest,
} from '../manifest.ts'

const base = {
  id: 'ext.demo',
  name: 'Demo',
  version: '1.0.0',
  runtime: 'skill-pack' as const,
  permissions: ['ui.command'] as const,
}

describe('parseExtensionManifest (fail-closed)', () => {
  it('accepts a minimal valid manifest', () => {
    const m = parseExtensionManifest({ ...base })
    expect(m.id).toBe('ext.demo')
    expect(m.runtime).toBe('skill-pack')
    expect(m.permissions).toEqual(['ui.command'])
  })

  it('accepts all 8 runtimes', () => {
    const runtimes = [
      'craft-native',
      'craft-sandbox',
      'siyuan-plugin',
      'mcp-source',
      'skill-pack',
      'automation-pack',
      'web-widget',
      'agent-runtime',
    ] as const
    for (const runtime of runtimes) {
      const m = parseExtensionManifest({ ...base, id: `r.${runtime}`, runtime })
      expect(m.runtime).toBe(runtime)
    }
  })

  it('accepts secrets.use:<id> permissions', () => {
    const m = parseExtensionManifest({
      ...base,
      permissions: ['ui.command', 'secrets.use:source_oauth::ws::linear'],
    })
    expect(m.permissions).toContain('secrets.use:source_oauth::ws::linear')
  })

  it('accepts known contributes keys', () => {
    const m = parseExtensionManifest({
      ...base,
      contributes: {
        commands: [{ id: 'cmd.a' }],
        skills: [{ slug: 'x' }],
      },
    })
    expect(m.contributes?.commands).toEqual([{ id: 'cmd.a' }])
    expect(m.contributes?.skills).toEqual([{ slug: 'x' }])
  })

  it('rejects unknown runtime', () => {
    const r = tryParseExtensionManifest({ ...base, runtime: 'evil-runtime' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.includes('runtime'))).toBe(true)
    expect(() => parseExtensionManifest({ ...base, runtime: 'evil-runtime' })).toThrow(
      ExtensionManifestValidationError,
    )
  })

  it('rejects unknown permission', () => {
    const r = tryParseExtensionManifest({
      ...base,
      permissions: ['ui.command', 'root.access'],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => /permission/i.test(i))).toBe(true)
  })

  it('rejects unknown contributes key', () => {
    const r = tryParseExtensionManifest({
      ...base,
      contributes: { evilHooks: [] },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.includes('evilHooks'))).toBe(true)
  })

  it('rejects empty id / name', () => {
    expect(tryParseExtensionManifest({ ...base, id: '' }).ok).toBe(false)
    expect(tryParseExtensionManifest({ ...base, name: '' }).ok).toBe(false)
  })
})
