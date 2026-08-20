import { afterEach, describe, expect, it } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  assertNotesImportPaths,
  getConfigDir,
  setOwnedRootAdapter,
} from '../owned-root-policy.ts'

afterEach(() => {
  setOwnedRootAdapter(null)
})

describe('getConfigDir', () => {
  it('resolves after boot from an injected adapter, not import-time env', () => {
    setOwnedRootAdapter({ resolveConfigDir: () => '/tmp/injected-craft-root' })
    expect(getConfigDir()).toBe('/tmp/injected-craft-root')
  })

  it('does not require CRAFT_CONFIG_DIR as a production fallback when an adapter is injected', () => {
    const previous = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = '/tmp/should-not-win'
    try {
      setOwnedRootAdapter({ resolveConfigDir: () => '/tmp/owned-root' })
      expect(getConfigDir()).toBe('/tmp/owned-root')
    } finally {
      if (previous === undefined) delete process.env.CRAFT_CONFIG_DIR
      else process.env.CRAFT_CONFIG_DIR = previous
    }
  })

  it('restores the default adapter and reads env lazily', () => {
    setOwnedRootAdapter({ resolveConfigDir: () => '/tmp/injected-craft-root' })
    setOwnedRootAdapter(null)
    const previous = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = '/tmp/lazy-config-dir'
    try {
      expect(getConfigDir()).toBe('/tmp/lazy-config-dir')
    } finally {
      if (previous === undefined) delete process.env.CRAFT_CONFIG_DIR
      else process.env.CRAFT_CONFIG_DIR = previous
    }
  })

  it('default owned state is ~/.craft-agent, not ~/ROX', () => {
    setOwnedRootAdapter(null)
    const previous = process.env.CRAFT_CONFIG_DIR
    delete process.env.CRAFT_CONFIG_DIR
    try {
      expect(getConfigDir()).toBe(join(homedir(), '.craft-agent'))
      expect(getConfigDir()).not.toContain('/ROX')
    } finally {
      if (previous === undefined) delete process.env.CRAFT_CONFIG_DIR
      else process.env.CRAFT_CONFIG_DIR = previous
    }
  })
})

describe('assertNotesImportPaths', () => {
  it('rejects relative import roots', () => {
    expect(() => assertNotesImportPaths({ sourceRoot: 'vault' })).toThrow(/absolute path/)
    expect(() => assertNotesImportPaths({ sourceRoot: './vault' })).toThrow(/absolute path/)
  })

  it('rejects a relative destination when provided', () => {
    expect(() =>
      assertNotesImportPaths({ sourceRoot: '/abs/vault', destinationRoot: 'notes' }),
    ).toThrow(/absolute path/)
  })

  it('accepts absolute source and destination', () => {
    expect(() =>
      assertNotesImportPaths({ sourceRoot: '/abs/vault', destinationRoot: '/abs/notes' }),
    ).not.toThrow()
  })
})
