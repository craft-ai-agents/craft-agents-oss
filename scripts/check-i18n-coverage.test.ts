import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { walkSourceTree } from './check-i18n-coverage'

describe('i18n coverage source traversal', () => {
  it('fails closed when a configured source tree cannot be read', () => {
    const missingRoot = join(import.meta.dir, '__missing_i18n_source_tree__')

    expect(() => walkSourceTree(missingRoot)).toThrow('Unable to read configured i18n source tree')
  })
})
