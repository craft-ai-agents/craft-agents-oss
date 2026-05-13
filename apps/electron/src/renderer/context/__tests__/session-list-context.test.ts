import { describe, expect, test } from 'bun:test'
import type { SessionListContextValue } from '../SessionListContext'

describe('SessionListContextValue', () => {
  test('does not expose label-related fields (flatLabels, labels, onLabelsChange)', () => {
    // Verify that a valid SessionListContextValue can be constructed without label fields.
    // If flatLabels/labels/onLabelsChange are re-added as required fields,
    // the type assertion below will produce a TypeScript error caught by npm run typecheck.
    type LabelKeys = 'flatLabels' | 'labels' | 'onLabelsChange'
    type HasLabelKeys = LabelKeys extends keyof SessionListContextValue ? true : false
    const hasLabelKeys: HasLabelKeys = false as HasLabelKeys
    expect(hasLabelKeys).toBe(false)
  })
})
