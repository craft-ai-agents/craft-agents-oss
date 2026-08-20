import { describe, expect, it } from 'bun:test'
import type { BulkUpdateSessionsPatch } from '@craft-agent/shared/protocol/dto'
import { assertValidBulkLabelPatch, resolveBulkLabels } from '@craft-agent/shared/sessions/collection'

describe('bulk label patches', () => {
  it('adds labels without removing target-specific labels', () => {
    const patch: BulkUpdateSessionsPatch = { addLabels: ['new', 'existing'] }

    expect(resolveBulkLabels(['existing', 'target-only'], patch)).toEqual([
      'existing',
      'target-only',
      'new',
    ])
  })

  it('removes only requested labels', () => {
    const patch: BulkUpdateSessionsPatch = { removeLabels: ['remove-me'] }

    expect(resolveBulkLabels(['keep', 'remove-me', 'also-keep'], patch)).toEqual([
      'keep',
      'also-keep',
    ])
  })

  it('replaces labels only when a replacement patch is used', () => {
    const patch: BulkUpdateSessionsPatch = { labels: ['next', 'next', 'final'] }

    expect(resolveBulkLabels(['old'], patch)).toEqual(['next', 'final'])
  })

  it('rejects an ambiguous replacement plus delta patch before any session mutates', () => {
    const patch: BulkUpdateSessionsPatch = { labels: ['replace'], addLabels: ['add'] }

    expect(() => assertValidBulkLabelPatch(patch)).toThrow('bulk_labels_conflict')
  })
})
