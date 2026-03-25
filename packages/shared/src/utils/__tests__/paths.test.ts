import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { getBundledAssetsDir, setBundledAssetsRoot } from '../paths.ts'

describe('getBundledAssetsDir', () => {
  it('resolves electron resources when the bundled assets root is the monorepo root', () => {
    const repoRoot = join(import.meta.dir, '..', '..', '..', '..', '..')
    setBundledAssetsRoot(repoRoot)

    expect(getBundledAssetsDir('.')).toBe(join(repoRoot, 'apps', 'electron', 'resources'))
    expect(getBundledAssetsDir('docs')).toBe(join(repoRoot, 'apps', 'electron', 'resources', 'docs'))
  })
})
