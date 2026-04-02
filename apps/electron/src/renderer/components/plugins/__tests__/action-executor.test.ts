import { describe, expect, it } from 'bun:test'
import { applyPluginInsertText } from '../action-executor'

describe('applyPluginInsertText', () => {
  it('replaces input when mode is replace', () => {
    expect(applyPluginInsertText('draft text', 'new text', 'replace')).toBe('new text')
  })

  it('appends text when mode is append', () => {
    expect(applyPluginInsertText('draft text', 'new text', 'append')).toBe('draft text new text')
  })

  it('prepends text when mode is prepend', () => {
    expect(applyPluginInsertText('draft text', 'new text', 'prepend')).toBe('new text draft text')
  })
})
