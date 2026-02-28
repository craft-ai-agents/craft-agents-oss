import { describe, it, expect } from 'bun:test'

import {
  normalizeBrowserToolName,
  getBrowserToolCommandVerb,
  shouldActivateBrowserOverlay,
} from '../browser-tool-detection'

describe('browser-tool-detection', () => {
  describe('normalizeBrowserToolName', () => {
    it('normalizes direct browser tool names', () => {
      expect(normalizeBrowserToolName('browser_open')).toBe('browser_open')
      expect(normalizeBrowserToolName('browser_snapshot')).toBe('browser_snapshot')
    })

    it('normalizes namespaced browser tool names', () => {
      expect(normalizeBrowserToolName('mcp__session__browser_open')).toBe('browser_open')
      expect(normalizeBrowserToolName('mcp__session__browser_tool')).toBe('browser_tool')
      expect(normalizeBrowserToolName('mcp__workspace__browser_click')).toBe('browser_click')
    })

    it('returns null for non-browser tool names', () => {
      expect(normalizeBrowserToolName('mcp__session__read')).toBeNull()
      expect(normalizeBrowserToolName('write')).toBeNull()
      expect(normalizeBrowserToolName('')).toBeNull()
    })
  })

  describe('getBrowserToolCommandVerb', () => {
    it('extracts normalized command verbs', () => {
      expect(getBrowserToolCommandVerb({ command: 'release' })).toBe('release')
      expect(getBrowserToolCommandVerb({ command: '  SNAPSHOT   ' })).toBe('snapshot')
      expect(getBrowserToolCommandVerb({ command: '--help' })).toBe('--help')
      expect(getBrowserToolCommandVerb({ command: 'navigate https://example.com' })).toBe('navigate')
    })

    it('returns empty string for invalid inputs', () => {
      expect(getBrowserToolCommandVerb({})).toBe('')
      expect(getBrowserToolCommandVerb({ command: 123 })).toBe('')
      expect(getBrowserToolCommandVerb(null)).toBe('')
    })
  })

  describe('shouldActivateBrowserOverlay', () => {
    it('activates for direct browser tools', () => {
      expect(shouldActivateBrowserOverlay('browser_open', {})).toBe(true)
      expect(shouldActivateBrowserOverlay('browser_snapshot', {})).toBe(true)
    })

    it('activates for namespaced browser tools (PI/Claude-compatible)', () => {
      expect(shouldActivateBrowserOverlay('mcp__session__browser_open', {})).toBe(true)
      expect(shouldActivateBrowserOverlay('mcp__session__browser_snapshot', {})).toBe(true)
    })

    it('does not activate for browser_tool help/release commands', () => {
      expect(shouldActivateBrowserOverlay('browser_tool', { command: '--help' })).toBe(false)
      expect(shouldActivateBrowserOverlay('browser_tool', { command: 'help' })).toBe(false)
      expect(shouldActivateBrowserOverlay('mcp__session__browser_tool', { command: 'release' })).toBe(false)
    })

    it('activates for browser_tool actionable commands', () => {
      expect(shouldActivateBrowserOverlay('browser_tool', { command: 'snapshot' })).toBe(true)
      expect(shouldActivateBrowserOverlay('mcp__session__browser_tool', { command: 'navigate https://linear.app' })).toBe(true)
    })

    it('does not activate for non-browser tools', () => {
      expect(shouldActivateBrowserOverlay('mcp__session__read', {})).toBe(false)
      expect(shouldActivateBrowserOverlay('write', {})).toBe(false)
    })
  })
})
