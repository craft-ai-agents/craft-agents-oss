/**
 * Tests for mcp-app-utils: extractMcpAppWidget, hasMcpAppWidgets, deriveServerId
 */

import { describe, it, expect } from 'bun:test'
import { extractMcpAppWidget, hasMcpAppWidgets, deriveServerId } from '../mcp-app-utils'
import type { ActivityItem } from '../../chat/TurnCard'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Never reset — the module-level widget cache in mcp-app-utils keys on
// activity.id, so each test MUST use a globally unique ID.
let idCounter = 0

function makeActivityItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  const id = `activity-${++idCounter}`
  return {
    id,
    type: 'tool',
    status: 'completed',
    toolName: 'mcp__my-server__render',
    toolUseId: `toolu_${idCounter}`,
    timestamp: Date.now(),
    ...overrides,
  }
}

function makeWidgetContent(meta?: Record<string, unknown>): string {
  return JSON.stringify({
    content: [{ type: 'text', text: 'ok' }],
    _meta: meta ?? {
      'mcp-use/widget': {
        type: 'mcpApps',
        html: '<div>Hello</div>',
        name: 'Test Widget',
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractMcpAppWidget', () => {
  it('extracts widget from valid mcpApps activity', () => {
    const activity = makeActivityItem({
      content: makeWidgetContent(),
    })
    const result = extractMcpAppWidget(activity)
    expect(result).not.toBeNull()
    expect(result!.html).toBe('<div>Hello</div>')
    expect(result!.name).toBe('Test Widget')
  })

  it('extracts widget from appsSdk type', () => {
    const activity = makeActivityItem({
      content: makeWidgetContent({
        'mcp-use/widget': {
          type: 'appsSdk',
          html: '<div>SDK App</div>',
          name: 'SDK Widget',
        },
      }),
    })
    const result = extractMcpAppWidget(activity)
    expect(result).not.toBeNull()
    expect(result!.html).toBe('<div>SDK App</div>')
  })

  it('returns null for non-tool activity', () => {
    const activity = makeActivityItem({
      type: 'thinking',
      content: makeWidgetContent(),
    })
    expect(extractMcpAppWidget(activity)).toBeNull()
  })

  it('returns null when _meta is missing', () => {
    const activity = makeActivityItem({
      content: JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }),
    })
    expect(extractMcpAppWidget(activity)).toBeNull()
  })

  it('returns null for malformed JSON content', () => {
    const activity = makeActivityItem({ content: 'not json {{' })
    expect(extractMcpAppWidget(activity)).toBeNull()
  })

  it('returns null for wrong widget type', () => {
    const activity = makeActivityItem({
      content: makeWidgetContent({
        'mcp-use/widget': { type: 'other', html: '<div/>' },
      }),
    })
    expect(extractMcpAppWidget(activity)).toBeNull()
  })

  it('uses CSP fallback from _meta.ui.csp', () => {
    const activity = makeActivityItem({
      content: JSON.stringify({
        content: [],
        _meta: {
          'mcp-use/widget': { type: 'mcpApps', html: '<div/>' },
          ui: { csp: { connectDomains: ['https://api.example.com'] } },
        },
      }),
    })
    const result = extractMcpAppWidget(activity)
    expect(result).not.toBeNull()
    expect(result!.csp?.connectDomains).toEqual(['https://api.example.com'])
  })

  it('uses props fallback from _meta["mcp-use/props"]', () => {
    const activity = makeActivityItem({
      content: JSON.stringify({
        content: [],
        _meta: {
          'mcp-use/widget': { type: 'mcpApps', html: '<div/>' },
          'mcp-use/props': { theme: 'dark' },
        },
      }),
    })
    const result = extractMcpAppWidget(activity)
    expect(result).not.toBeNull()
    expect(result!.props).toEqual({ theme: 'dark' })
  })

  it('caches positive results (same reference returned)', () => {
    const activity = makeActivityItem({
      content: makeWidgetContent(),
    })
    const first = extractMcpAppWidget(activity)
    const second = extractMcpAppWidget(activity)
    expect(first).toBe(second) // same reference
  })
})

describe('hasMcpAppWidgets', () => {
  it('returns true when at least one widget is present', () => {
    const activities = [
      makeActivityItem({ content: 'plain text' }),
      makeActivityItem({ content: makeWidgetContent() }),
    ]
    expect(hasMcpAppWidgets(activities)).toBe(true)
  })

  it('returns false when no widgets are present', () => {
    const activities = [
      makeActivityItem({ content: 'plain text' }),
      makeActivityItem({ content: JSON.stringify({ foo: 'bar' }) }),
    ]
    expect(hasMcpAppWidgets(activities)).toBe(false)
  })
})

describe('deriveServerId', () => {
  it('extracts server name from MCP tool pattern', () => {
    const activity = makeActivityItem({ toolName: 'mcp__my-server__tool' })
    expect(deriveServerId(activity)).toBe('my-server')
  })

  it('falls back for non-MCP tool names', () => {
    const activity = makeActivityItem({ toolName: 'some-tool' })
    expect(deriveServerId(activity)).toBe('some-tool')
  })

  it('returns "unknown" for empty tool name', () => {
    const activity = makeActivityItem({ toolName: '' })
    expect(deriveServerId(activity)).toBe('unknown')
  })
})
