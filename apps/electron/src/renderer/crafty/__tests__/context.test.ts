import { describe, expect, it } from 'bun:test'
import type { CraftyProvenance, CraftySelectionResult } from '../../../shared/crafty'
import { contextSummary, sourceAppName } from '../context'

const selected = (text: string, programName = 'Slack'): CraftySelectionResult => ({
  latencyMs: 12,
  selection: { text, method: 'accessibility', rawMethod: 11, posLevel: 3, bounds: null, programName },
})
const nothing: CraftySelectionResult = { latencyMs: 12, selection: null }
const provenance = (fields: Partial<CraftyProvenance>): CraftyProvenance => ({
  pid: 1,
  bundleId: null,
  appName: null,
  windowTitle: null,
  url: null,
  notes: [],
  latencyMs: 80,
  ...fields,
})

describe('sourceAppName', () => {
  it('the app from provenance, else the one selection-hook saw', () => {
    expect(sourceAppName(selected('hi', 'Slack'), provenance({ appName: 'Slack Beta' }))).toBe('Slack Beta')
    expect(sourceAppName(selected('hi', 'Slack'), null)).toBe('Slack')
    expect(sourceAppName(nothing, provenance({ appName: '' }))).toBeNull()
  })
})

describe('contextSummary', () => {
  it('counts the selection and names the app', () => {
    expect(contextSummary(selected('Can we move the review?'), provenance({ appName: 'Slack' })))
      .toEqual({ label: '23 characters from Slack', expandable: true })
    expect(contextSummary(selected('x'.repeat(1234), ''), null)).toEqual({ label: '1,234 characters selected', expandable: true })
    expect(contextSummary(selected('x'), null).label).toBe('1 character from Slack')
  })

  it('without a selection, opens only when the window title or page address goes along', () => {
    expect(contextSummary(nothing, provenance({ appName: 'Safari', url: 'https://example.com' })))
      .toEqual({ label: 'Nothing selected in Safari', expandable: true })
    expect(contextSummary(nothing, provenance({ appName: 'Finder' }))).toEqual({ label: 'Nothing selected in Finder', expandable: false })
    expect(contextSummary(nothing, null)).toEqual({ label: 'Nothing selected', expandable: false })
  })

  it('a failed read opens to show why', () => {
    expect(contextSummary({ latencyMs: 3, selection: null, error: 'AX error -25204' }, null))
      .toEqual({ label: 'Couldn\'t read the selection', expandable: true })
  })
})
